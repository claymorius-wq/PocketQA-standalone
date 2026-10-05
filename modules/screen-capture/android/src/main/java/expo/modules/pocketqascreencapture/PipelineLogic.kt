package expo.modules.pocketqascreencapture

/**
 * Pure (JVM-testable) parts of the capture pipeline (docs/plans/native-capture-pipeline.md).
 */

/**
 * Presentation times for microphone audio, on the same monotonic clock as the screen frames.
 *
 * Times follow the samples: each chunk advances the clock by exactly its length, so a scheduling
 * stall (the buffered audio then arrives in a burst) shifts nothing. Only when a chunk's samples
 * started later than the clock by more than the whole capture buffer could have held, audio was
 * really dropped (an overrun). The clock then jumps forward to the real time, so the audio
 * continues in sync after a gap instead of drifting or stopping, and the gap is counted.
 * Times never go backwards.
 */
class AudioClock(private val sampleRate: Int, private val bufferUs: Long) {
  private var anchorUs = -1L
  private var framesSinceAnchor = 0L
  private var lastPtsUs = -1L
  var gaps = 0
    private set
  var lostUs = 0L
    private set

  private fun framesUs(frames: Long) = frames * 1_000_000L / sampleRate

  /** Presentation time of a chunk of [frames] whose read returned at [readEndUs] (monotonic). */
  fun next(frames: Int, readEndUs: Long): Long {
    val actualStartUs = readEndUs - framesUs(frames.toLong())
    if (anchorUs < 0) {
      anchorUs = actualStartUs
      framesSinceAnchor = 0
    } else {
      val expectedUs = anchorUs + framesUs(framesSinceAnchor)
      val lagUs = actualStartUs - expectedUs
      if (lagUs > bufferUs) {
        gaps++
        lostUs += lagUs
        anchorUs = actualStartUs
        framesSinceAnchor = 0
      }
    }
    val pts = maxOf(anchorUs + framesUs(framesSinceAnchor), lastPtsUs + 1)
    framesSinceAnchor += frames
    lastPtsUs = pts
    return pts
  }
}

/**
 * PCM chunks waiting for an encoder input buffer. Bounded: if the encoder falls behind, the OLDEST
 * audio is dropped and counted (the clock then re-anchors), so the capture thread never blocks on
 * the encoder and memory stays flat.
 */
class PcmBacklog<T>(private val capacity: Int) {
  private val q = ArrayDeque<T>()
  var dropped = 0
    private set
  val size get() = q.size

  fun add(item: T) {
    if (q.size >= capacity) {
      q.removeFirst()
      dropped++
    }
    q.addLast(item)
  }

  fun peek(): T? = q.firstOrNull()
  fun poll(): T? = q.removeFirstOrNull()
  fun clear() = q.clear()
}

/**
 * Ends a session whose narration is gone, rather than recording on without the voice:
 *  - silenced: Android gives a capturing app silence when another app takes the microphone (one with
 *    its UI on top, a privacy-sensitive source, a call), as reported by isClientSilenced;
 *  - no audio: the audio path stopped delivering chunks (a dead AudioRecord, a stuck thread).
 * Returns "mic" when the session must stop.
 */
class Liveness(private val silencedForMs: Long, private val noAudioForMs: Long) {
  private var startMs = 0L
  private var silencedSinceMs = -1L

  fun started(nowMs: Long) {
    startMs = nowMs
    silencedSinceMs = -1
  }

  fun check(nowMs: Long, lastAudioMs: Long, silenced: Boolean): String? {
    if (silenced) {
      if (silencedSinceMs < 0) silencedSinceMs = nowMs
      if (nowMs - silencedSinceMs >= silencedForMs) return "mic"
    } else {
      silencedSinceMs = -1
    }
    val since = if (lastAudioMs < 0) startMs else lastAudioMs
    return if (nowMs - since >= noAudioForMs) "mic" else null
  }
}

/**
 * Between the two encoders and MediaMuxer. MediaMuxer needs every track added before start(), and
 * each track's samples written in chronological order (MediaMuxer Javadoc), so:
 *  - samples are held (bounded, oldest dropped) until both formats are known, then the muxer starts;
 *  - all times are made relative to the session start ([baseUs], the same monotonic clock for screen
 *    and audio), and nothing before it is written;
 *  - a sample that isn't strictly later than its track's previous one is rejected and counted.
 * Thread-safe: the audio and video threads both write through it.
 */
class MuxGate<F>(private val sink: Sink<F>, private val baseUs: Long, private val maxPending: Int) {
  interface Sink<F> {
    fun addTrack(format: F): Int
    fun start()
    fun write(track: Int, data: ByteArray, ptsUs: Long, flags: Int)
  }

  private class Held(val track: Int, val data: ByteArray, val ptsUs: Long, val flags: Int)

  private val formats = arrayOfNulls<Any>(2)
  private val sinkTrack = IntArray(2) { -1 }
  private val lastPtsUs = LongArray(2) { -1L }
  private val pending = ArrayDeque<Held>()
  var started = false
    private set
  var bytes = 0L
    private set
  var rejected = 0
    private set
  /** Samples written per track (AUDIO, VIDEO). */
  val written = LongArray(2)

  @Synchronized fun format(track: Int, format: F) {
    if (started || formats[track] != null) return
    formats[track] = format
    if (formats[AUDIO] != null && formats[VIDEO] != null) {
      @Suppress("UNCHECKED_CAST")
      for (t in intArrayOf(AUDIO, VIDEO)) sinkTrack[t] = sink.addTrack(formats[t] as F)
      sink.start()
      started = true
      while (pending.isNotEmpty()) pending.removeFirst().let { write(it.track, it.data, it.ptsUs, it.flags) }
    }
  }

  @Synchronized fun sample(track: Int, data: ByteArray, ptsUs: Long, flags: Int) {
    val rel = ptsUs - baseUs
    if (rel < 0 || rel <= lastPtsUs[track]) {
      rejected++
      return
    }
    lastPtsUs[track] = rel
    if (started) {
      write(track, data, rel, flags)
    } else {
      if (pending.size >= maxPending) pending.removeFirst()
      pending.addLast(Held(track, data, rel, flags))
    }
  }

  private fun write(track: Int, data: ByteArray, rel: Long, flags: Int) {
    sink.write(sinkTrack[track], data, rel, flags)
    bytes += data.size
    written[track]++
  }

  companion object {
    const val AUDIO = 0
    const val VIDEO = 1
  }
}
