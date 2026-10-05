package expo.modules.pocketqascreencapture

import android.content.Context
import java.io.File

/** Result of one consented recording session, with the voice verdict measured from the file. */
data class Clip(val file: File, val durationMs: Long, val videoMs: Long, val voiceMs: Long, val voiceComplete: Boolean, val voiceLostMs: Long = 0L) {
  fun toMap(): Map<String, Any> = mapOf(
    "uri" to "file://${file.absolutePath}",
    "durationMs" to durationMs,
    "sizeBytes" to file.length(),
    "mimeType" to "video/mp4",
    "videoMs" to videoMs,
    "voiceMs" to voiceMs,
    "voiceComplete" to voiceComplete,
    "voiceLostMs" to voiceLostMs,
  )

  companion object {
    fun of(e: PendingStore.Entry) = Clip(e.file, e.durationMs, e.videoMs, e.voiceMs, e.voiceComplete, e.voiceLostMs)
  }
}

/**
 * App-private, excluded from backups, and (unlike cacheDir) never evicted by the system while a clip
 * waits for review (pqa-qa r1 P3-3). Bounded by the store's 24 h expiry and sign-out clearing.
 */
fun recordingStore(context: Context) = PendingStore(File(context.noBackupFilesDir, "recordings"))

/**
 * In-process link between the Expo module (JS-facing) and the foreground service that
 * owns the MediaProjection. Only one session exists at a time.
 */
object RecorderBridge {
  @Volatile var recording: Boolean = false
  /** File being written by the active session, if any (never swept). */
  @Volatile var currentFile: File? = null
  /** Called by the service when a session ends for any reason ("user" | "system" | "mic" | "error" | "limit"). */
  @Volatile var onStopped: ((reason: String, clip: Clip?) -> Unit)? = null
  /** Set while JS awaits stopAsync(); resolved by the service when the file is finalized. */
  @Volatile var pendingStop: ((Clip?) -> Unit)? = null
}
