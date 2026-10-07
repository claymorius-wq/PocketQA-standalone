package expo.modules.pocketqascreencapture

import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer

/**
 * Does a finished recording carry the tester's voice for its whole length?
 *
 * MediaRecorder can keep writing video after its audio track has stalled (emulator rotation run,
 * 2026-10-05: video 391.7 s, AAC 202.7 s), and nothing in its API reports that. So every finalised
 * file is measured: the audio track must cover the video within max(1 s, 2 %) (encoder start-up and
 * tail; pqa-qa r1 P1). A clip that fails is still shown for review, marked "voice incomplete", and
 * can't be kept or uploaded as narrated evidence.
 */
object VoiceCheck {
  data class Verdict(val videoMs: Long, val voiceMs: Long, val complete: Boolean, val lostMs: Long = 0L)

  /** Narration missing in the middle (pqa-qa pipeline r1 P2-C) has its own bound, not the edge one. */
  const val MAX_LOST_MS = 1_000L
  const val MAX_GAP_MS = 500L

  /**
   * The audio track must cover the video within max(1 s, 2 %) at the edges (encoder start-up and
   * tail), AND audio lost inside the clip must stay within [MAX_LOST_MS] in total with no single gap
   * over [MAX_GAP_MS], whatever the clip length.
   */
  fun covers(videoMs: Long, audioMs: Long?, lostMs: Long = 0L, maxGapMs: Long = 0L): Boolean {
    if (audioMs == null) return false
    if (lostMs > MAX_LOST_MS || maxGapMs > MAX_GAP_MS) return false
    val tolerance = maxOf(1_000L, videoMs * 2 / 100)
    return videoMs - audioMs <= tolerance
  }

  /**
   * Null when the file isn't a readable MP4 with a video track. [lostAudioMs] is audio the capture
   * dropped inside the track (an overrun leaves a timestamp gap the muxer stretches over), so it
   * counts against the voice even though the track spans the clip.
   */
  fun inspect(file: File, lostAudioMs: Long = 0L, maxGapMs: Long = 0L): Verdict? {
    val t = Mp4Tracks.read(file) ?: return null
    val voice = t.audioMs?.let { maxOf(0L, it - lostAudioMs) }
    return Verdict(t.videoMs, voice ?: 0L, covers(t.videoMs, t.audioMs, lostAudioMs, maxGapMs), lostAudioMs)
  }
}

/**
 * Track durations from an MP4's own index (moov/trak/mdia: hdlr handler type, mdhd timescale and
 * duration). Pure JVM, so it is unit-tested on real files. MediaRecorder writes the index at the end;
 * other muxers may put it first; both are handled.
 */
object Mp4Tracks {
  data class Tracks(val videoMs: Long, val audioMs: Long?)

  private const val MAX_MOOV = 64L * 1024 * 1024

  fun read(file: File): Tracks? = try {
    if (!file.isFile) null else RandomAccessFile(file, "r").use { raf -> moov(raf)?.let(::tracks) }
  } catch (_: Exception) {
    null
  }

  private fun moov(raf: RandomAccessFile): ByteBuffer? {
    var pos = 0L
    val len = raf.length()
    while (pos + 8 <= len) {
      raf.seek(pos)
      var size = raf.readInt().toLong() and 0xffffffffL
      val type = ByteArray(4).also { raf.readFully(it) }.toString(Charsets.ISO_8859_1)
      var header = 8L
      if (size == 1L) {
        size = raf.readLong()
        header = 16L
      } else if (size == 0L) {
        size = len - pos
      }
      if (size < header || pos + size > len) return null
      if (type == "moov") {
        val body = size - header
        if (body > MAX_MOOV) return null
        val bytes = ByteArray(body.toInt())
        raf.seek(pos + header)
        raf.readFully(bytes)
        return ByteBuffer.wrap(bytes)
      }
      pos += size
    }
    return null
  }

  /** Child boxes of [buf] (position to limit) as (type, payload) pairs. */
  private fun children(buf: ByteBuffer): List<Pair<String, ByteBuffer>> {
    val out = mutableListOf<Pair<String, ByteBuffer>>()
    val b = buf.duplicate()
    while (b.remaining() >= 8) {
      val start = b.position()
      var size = b.int.toLong() and 0xffffffffL
      val type = ByteArray(4).also { b.get(it) }.toString(Charsets.ISO_8859_1)
      var header = 8
      if (size == 1L) {
        size = b.long
        header = 16
      } else if (size == 0L) {
        size = (b.limit() - start).toLong()
      }
      if (size < header || start + size > b.limit()) break
      val payload = b.duplicate().apply {
        position(start + header)
        limit((start + size).toInt())
      }.slice()
      out += type to payload
      b.position((start + size).toInt())
    }
    return out
  }

  private fun tracks(moov: ByteBuffer): Tracks? {
    var video: Long? = null
    var audio: Long? = null
    for ((type, trak) in children(moov)) {
      if (type != "trak") continue
      val mdia = children(trak).firstOrNull { it.first == "mdia" }?.second ?: continue
      val boxes = children(mdia)
      val handler = boxes.firstOrNull { it.first == "hdlr" }?.second?.let { h ->
        if (h.remaining() < 12) null else ByteArray(4).also { h.duplicate().apply { position(8) }.get(it) }.toString(Charsets.ISO_8859_1)
      } ?: continue
      val ms = boxes.firstOrNull { it.first == "mdhd" }?.second?.let(::durationMs) ?: continue
      when (handler) {
        "vide" -> video = maxOf(video ?: 0L, ms)
        "soun" -> audio = maxOf(audio ?: 0L, ms)
      }
    }
    return video?.let { Tracks(it, audio) }
  }

  private fun durationMs(mdhd: ByteBuffer): Long? {
    val b = mdhd.duplicate()
    val version = b.get().toInt()
    b.position(4)
    val (timescale, duration) = if (version == 1) {
      b.position(4 + 16)
      (b.int.toLong() and 0xffffffffL) to b.long
    } else {
      b.position(4 + 8)
      (b.int.toLong() and 0xffffffffL) to (b.int.toLong() and 0xffffffffL)
    }
    if (timescale <= 0L || duration < 0L) return null
    return duration * 1000 / timescale
  }
}
