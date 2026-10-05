package expo.modules.pocketqascreencapture

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val CAPTURE_REQUEST = 4712

class ConsentDeniedException : CodedException("ERR_CONSENT_DENIED", "Screen capture permission was denied", null)
class AlreadyRecordingException : CodedException("ERR_ALREADY_RECORDING", "A recording is already in progress", null)
class NotRecordingException : CodedException("ERR_NOT_RECORDING", "No recording is in progress", null)
class UnsupportedException : CodedException("ERR_UNSUPPORTED", "Screen recording needs Android 10 or newer", null)
class MicDeniedException : CodedException("ERR_MIC_DENIED", "Microphone permission is required: the recording includes your narration", null)

/**
 * JS surface (docs/plans/native-screen-voice-recording.md):
 *  - startAsync(tag) needs RECORD_AUDIO already granted (narration is part of every recording) and
 *    shows the system consent dialog EVERY time (no cached token, no silent start);
 *  - stopAsync() finalises and returns the local clip;
 *  - "onStopped" fires when a session ends any other way (notification Stop, system chip, lock,
 *    microphone loss, error, cap);
 *  - takePendingAsync(tag) hands over finished clips of that session that JS hasn't received yet
 *    (the tester was in another app, or JS reloaded).
 */
class ScreenCaptureModule : Module() {
  private var pendingStart: Promise? = null
  private var pendingTag = ""
  private val store: PendingStore get() = PendingStore(java.io.File(context.cacheDir, "recordings"))
  private val context: Context get() = appContext.reactContext ?: throw IllegalStateException("React context lost")

  override fun definition() = ModuleDefinition {
    Name("PocketQaScreenCapture")
    Events("onStopped")

    OnCreate {
      // Truncated files (the process died mid-recording) and files JS lost track of are deleted;
      // finished, unclaimed clips stay for their session to claim (expiring after a day).
      store.sweep(active = RecorderBridge.currentFile)
      RecorderBridge.onStopped = { reason, clip ->
        sendEvent("onStopped", mapOf("reason" to reason, "clip" to clip?.toMap()))
      }
    }

    Function("isRecording") { RecorderBridge.recording }

    /** Stops an active session (if any) and deletes its file: used when the session screen goes away. */
    AsyncFunction("discardAsync") { promise: Promise ->
      if (!RecorderBridge.recording) {
        promise.resolve(null)
        return@AsyncFunction
      }
      // If stopAsync() is already waiting, settle it too (its clip is being discarded).
      val previous = RecorderBridge.pendingStop
      RecorderBridge.pendingStop = { clip ->
        clip?.let { forget(it.file) }
        previous?.invoke(null)
        promise.resolve(null)
      }
      context.startService(Intent(context, ScreenCaptureService::class.java).setAction(ScreenCaptureService.ACTION_STOP))
    }

    AsyncFunction("startAsync") { tag: String, promise: Promise ->
      if (Build.VERSION.SDK_INT < 29) throw UnsupportedException()
      if (RecorderBridge.recording || pendingStart != null) throw AlreadyRecordingException()
      // No video-only fallback: without the microphone nothing is recorded.
      if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) throw MicDeniedException()
      pendingStart = promise
      pendingTag = tag
      val mpm = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      // Default intent: on Android 14+ the user chooses a single app or the entire screen.
      appContext.throwingActivity.startActivityForResult(mpm.createScreenCaptureIntent(), CAPTURE_REQUEST)
    }

    OnActivityResult { _, (requestCode, resultCode, data) ->
      if (requestCode != CAPTURE_REQUEST) return@OnActivityResult
      val promise = pendingStart ?: return@OnActivityResult
      pendingStart = null
      if (resultCode != Activity.RESULT_OK || data == null) {
        promise.reject(ConsentDeniedException())
        return@OnActivityResult
      }
      val svc = Intent(context, ScreenCaptureService::class.java)
        .setAction(ScreenCaptureService.ACTION_START)
        .putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
        .putExtra(ScreenCaptureService.EXTRA_DATA, data)
        .putExtra(ScreenCaptureService.EXTRA_TAG, pendingTag)
      // Started now, while Pocket QA is in the foreground: a microphone FGS can't start from the background.
      context.startForegroundService(svc)
      promise.resolve(null)
    }

    AsyncFunction("stopAsync") { promise: Promise ->
      if (!RecorderBridge.recording) throw NotRecordingException()
      RecorderBridge.pendingStop = { clip ->
        if (clip != null) promise.resolve(clip.toMap()) else promise.reject(NotRecordingException())
      }
      context.startService(Intent(context, ScreenCaptureService::class.java).setAction(ScreenCaptureService.ACTION_STOP))
    }

    /** Finished clips of this session not yet handed to JS; each is handed over once. */
    AsyncFunction("takePendingAsync") { tag: String ->
      store.take(tag).map { Clip(it.file, it.durationMs).toMap() }
    }

    /** The session screen is gone: delete orphaned and truncated files (finished, unclaimed clips expire on their own). */
    AsyncFunction("purgeAsync") { store.sweep(active = RecorderBridge.currentFile) }

    OnDestroy { RecorderBridge.onStopped = null }
  }

  /** Deletes a discarded clip and its pending entry. */
  private fun forget(file: java.io.File) {
    file.delete()
    java.io.File(file.parentFile, file.nameWithoutExtension + ".meta").delete()
  }
}
