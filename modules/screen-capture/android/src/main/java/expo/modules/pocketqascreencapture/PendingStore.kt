package expo.modules.pocketqascreencapture

import java.io.File
import java.util.Properties
import java.util.UUID

/**
 * The on-disk handoff between the recording service and the session screen
 * (docs/plans/native-screen-voice-recording.md, Android design 5).
 *
 * A recording is `<id>.mp4`. When the service FINALISES it (MediaRecorder.stop succeeded), it writes
 * `<id>.meta` next to it: duration, the session tag (participation id), the stop reason and the time.
 * The session screen claims its clips with [take], which removes the meta: from then on the file
 * belongs to JS (review, upload or delete). So:
 *  - a clip that finished while the tester was in another app, or before a JS reload, is never lost;
 *  - an MP4 without a meta is either truncated (the process died mid-recording) or one that JS
 *    claimed and lost track of; [sweep] deletes it, so it is never offered or uploaded;
 *  - finished clips nobody claims expire after [TTL_MS].
 * java.util.Properties keeps this pure JVM (unit-tested without Android).
 */
class PendingStore(private val dir: File, private val now: () -> Long = System::currentTimeMillis) {
  data class Entry(val file: File, val durationMs: Long, val tag: String, val reason: String, val createdAt: Long)

  fun newFile(): File {
    dir.mkdirs()
    return File(dir, "${UUID.randomUUID()}.mp4")
  }

  private fun metaOf(video: File) = File(video.parentFile, video.nameWithoutExtension + ".meta")

  /** Records a finished clip; an empty file is deleted instead (nothing usable was captured). */
  fun markComplete(video: File, durationMs: Long, tag: String, reason: String): Boolean {
    if (!video.exists() || video.length() == 0L) {
      video.delete()
      return false
    }
    val p = Properties().apply {
      setProperty("durationMs", durationMs.toString())
      setProperty("tag", tag)
      setProperty("reason", reason)
      setProperty("createdAt", now().toString())
    }
    // Write-then-rename: a crash never leaves a half-written meta that would offer a clip.
    val tmp = File(dir, metaOf(video).name + ".tmp")
    tmp.outputStream().use { p.store(it, null) }
    return tmp.renameTo(metaOf(video))
  }

  private fun read(meta: File): Entry? = try {
    val p = Properties().apply { meta.inputStream().use { load(it) } }
    val video = File(dir, meta.nameWithoutExtension + ".mp4")
    Entry(video, p.getProperty("durationMs").toLong(), p.getProperty("tag"), p.getProperty("reason"), p.getProperty("createdAt").toLong())
  } catch (_: Exception) {
    null
  }

  /** The finished clips of this session, claimed: each is returned once, then JS owns the file. */
  fun take(tag: String): List<Entry> {
    val out = mutableListOf<Entry>()
    dir.listFiles { f -> f.name.endsWith(".meta") }?.forEach { meta ->
      val e = read(meta) ?: return@forEach
      if (e.tag != tag) return@forEach
      meta.delete()
      if (e.file.exists() && e.file.length() > 0) out += e
    }
    return out.sortedBy { it.createdAt }
  }

  /** Deletes truncated/orphaned videos (no meta, not [active]), stray metas, and expired clips. */
  fun sweep(active: File?) {
    val files = dir.listFiles() ?: return
    for (f in files) {
      when {
        f.name.endsWith(".mp4") -> if (f != active && !metaOf(f).exists()) f.delete()
        f.name.endsWith(".meta") -> {
          val e = read(f)
          if (e == null || !e.file.exists() || now() - e.createdAt > TTL_MS) {
            e?.file?.delete()
            f.delete()
          }
        }
        f.name.endsWith(".tmp") -> f.delete()
      }
    }
  }

  companion object {
    const val TTL_MS = 24L * 60 * 60 * 1000
  }
}
