package expo.modules.pocketqascreencapture

import java.io.File

/** Result of one consented recording session. */
data class Clip(val file: File, val durationMs: Long) {
  fun toMap(): Map<String, Any> = mapOf(
    "uri" to "file://${file.absolutePath}",
    "durationMs" to durationMs,
    "sizeBytes" to file.length(),
    "mimeType" to "video/mp4",
  )
}

/**
 * In-process link between the Expo module (JS-facing) and the foreground service that
 * owns the MediaProjection. Only one session exists at a time.
 */
object RecorderBridge {
  @Volatile var recording: Boolean = false
  /** File being written by the active session, if any (never swept). */
  @Volatile var currentFile: File? = null
  /** Called by the service when a session ends for any reason ("user" | "system" | "error"). */
  @Volatile var onStopped: ((reason: String, clip: Clip?) -> Unit)? = null
  /** Set while JS awaits stopAsync(); resolved by the service when the file is finalized. */
  @Volatile var pendingStop: ((Clip?) -> Unit)? = null
}
