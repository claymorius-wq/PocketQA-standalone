package expo.modules.pocketqascreencapture

import java.io.File
import java.util.Properties
import java.util.UUID

/**
 * The on-disk handoff between the recording service and the session screen
 * (docs/plans/native-screen-voice-recording.md, Android design 5).
 *
 * Per recording `<id>`:
 *  - `<id>.mp4`: the file MediaRecorder writes;
 *  - `<id>.rec`: written at start with the session tag (participation id). It outlives the MP4 only
 *    when the process died mid-recording;
 *  - `<id>.meta`: written when the service FINALISES the clip (replacing `.rec`): duration, tag, stop
 *    reason, time, and the voice verdict measured from the finished file ([VoiceCheck]);
 *  - `<id>.lost`: left by [sweep] for a recording the process died in, so its session can say so once.
 *
 * A finished clip stays listed for its session ([pending]) until its MP4 is deleted: JS deletes it
 * after uploading or discarding, and deletes everything unsent when the tester leaves the session in
 * the foreground. So a session screen destroyed while the tester is in another app (low memory,
 * "Don't keep activities") loses nothing; pqa-qa r1 P2-A. Only the clip's own session sees it.
 * Everything expires after [TTL_MS], and [clearAll] runs on sign-out and account deletion.
 * java.util.Properties keeps this pure JVM (unit-tested without Android).
 */
class PendingStore(private val dir: File, private val now: () -> Long = System::currentTimeMillis) {
  data class Entry(
    val file: File,
    val durationMs: Long,
    val tag: String,
    val reason: String,
    val createdAt: Long,
    val videoMs: Long,
    val voiceMs: Long,
    /** False unless the finished file was measured and its voice covers the video. */
    val voiceComplete: Boolean,
  )

  private fun sibling(video: File, ext: String) = File(dir, video.nameWithoutExtension + ext)

  fun newFile(tag: String): File {
    dir.mkdirs()
    val video = File(dir, "${UUID.randomUUID()}.mp4")
    write(sibling(video, ".rec"), Properties().apply {
      setProperty("tag", tag)
      setProperty("createdAt", now().toString())
    })
    return video
  }

  /** Write-then-rename: a crash never leaves a half-written file that would be trusted. */
  private fun write(target: File, p: Properties): Boolean {
    val tmp = File(dir, target.name + ".tmp")
    tmp.outputStream().use { p.store(it, null) }
    return tmp.renameTo(target)
  }

  private fun load(f: File): Properties? = try {
    Properties().apply { f.inputStream().use { load(it) } }
  } catch (_: Exception) {
    null
  }

  /** Records a finished clip; an empty file is deleted instead (nothing usable was captured). */
  fun markComplete(video: File, durationMs: Long, tag: String, reason: String, voice: VoiceCheck.Verdict?): Boolean {
    if (!video.exists() || video.length() == 0L) {
      forget(video)
      return false
    }
    val p = Properties().apply {
      setProperty("durationMs", durationMs.toString())
      setProperty("tag", tag)
      setProperty("reason", reason)
      setProperty("createdAt", now().toString())
      setProperty("videoMs", (voice?.videoMs ?: durationMs).toString())
      setProperty("voiceMs", (voice?.voiceMs ?: 0L).toString())
      setProperty("voiceComplete", (voice?.complete == true).toString())
    }
    val ok = write(sibling(video, ".meta"), p)
    sibling(video, ".rec").delete()
    return ok
  }

  private fun read(meta: File): Entry? {
    val p = load(meta) ?: return null
    return try {
      Entry(
        file = File(dir, meta.nameWithoutExtension + ".mp4"),
        durationMs = p.getProperty("durationMs").toLong(),
        tag = p.getProperty("tag"),
        reason = p.getProperty("reason"),
        createdAt = p.getProperty("createdAt").toLong(),
        videoMs = p.getProperty("videoMs")?.toLongOrNull() ?: 0L,
        voiceMs = p.getProperty("voiceMs")?.toLongOrNull() ?: 0L,
        voiceComplete = p.getProperty("voiceComplete") == "true",
      )
    } catch (_: Exception) {
      null
    }
  }

  /** The finished clips of this session whose files still exist (an empty tag matches nothing). */
  fun pending(tag: String): List<Entry> {
    if (tag.isEmpty()) return emptyList()
    return (dir.listFiles { f -> f.name.endsWith(".meta") } ?: emptyArray())
      .mapNotNull(::read)
      .filter { it.tag == tag && it.file.exists() && it.file.length() > 0 }
      .sortedBy { it.createdAt }
  }

  /** Deletes a clip and everything kept about it. */
  fun forget(video: File) {
    video.delete()
    for (ext in listOf(".meta", ".rec", ".lost")) sibling(video, ext).delete()
  }

  /** How many recordings of this session were cut off by the process dying; each is reported once. */
  fun takeInterrupted(tag: String): Int {
    var n = 0
    dir.listFiles { f -> f.name.endsWith(".lost") }?.forEach { f ->
      if (load(f)?.getProperty("tag") == tag) {
        f.delete()
        n++
      }
    }
    return n
  }

  /**
   * Deletes truncated recordings (an MP4 with no meta that isn't [active]: the process died while
   * writing it, so it is never offered or uploaded) and leaves their session a notice; drops stray
   * metas and temp files; expires everything older than [TTL_MS].
   */
  fun sweep(active: File?) {
    val files = dir.listFiles() ?: return
    val activeId = active?.nameWithoutExtension
    for (f in files) {
      val id = f.nameWithoutExtension
      when {
        f.name.endsWith(".tmp") -> f.delete()
        id == activeId -> Unit
        f.name.endsWith(".mp4") -> if (!sibling(f, ".meta").exists()) {
          f.delete()
          val rec = sibling(f, ".rec")
          load(rec)?.getProperty("tag")?.let { tag ->
            write(sibling(f, ".lost"), Properties().apply {
              setProperty("tag", tag)
              setProperty("createdAt", now().toString())
            })
          }
          rec.delete()
        }
        f.name.endsWith(".rec") -> if (!sibling(f, ".mp4").exists()) f.delete()
        f.name.endsWith(".meta") -> {
          val e = read(f)
          if (e == null || !e.file.exists() || now() - e.createdAt > TTL_MS) {
            e?.file?.delete()
            f.delete()
          }
        }
        f.name.endsWith(".lost") -> {
          val at = load(f)?.getProperty("createdAt")?.toLongOrNull()
          if (at == null || now() - at > TTL_MS) f.delete()
        }
      }
    }
  }

  /** Sign-out and account deletion: every clip and notice goes, except the file being written. */
  fun clearAll(active: File?) {
    val activeId = active?.nameWithoutExtension
    dir.listFiles()?.forEach { if (it.nameWithoutExtension != activeId) it.delete() }
  }

  companion object {
    const val TTL_MS = 24L * 60 * 60 * 1000
  }
}
