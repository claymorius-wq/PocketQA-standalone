package expo.modules.pocketqascreencapture

import android.app.Activity
import android.content.Context
import android.content.Intent
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

/**
 * JS surface: startAsync() shows the system consent dialog EVERY time (no cached token,
 * no silent start); stopAsync() finalizes and returns the local clip; "onStopped" fires
 * when the system ends the session (status-bar chip, screen lock).
 */
class ScreenCaptureModule : Module() {
  private var pendingStart: Promise? = null
  private val context: Context get() = appContext.reactContext ?: throw IllegalStateException("React context lost")

  override fun definition() = ModuleDefinition {
    Name("PocketQaScreenCapture")
    Events("onStopped")

    OnCreate {
      // Segments live only in JS memory, so any clip on disk from a previous JS context
      // (reload, crash, process restart) can never be reviewed: delete it.
      sweepOrphans()
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
        clip?.file?.delete()
        previous?.invoke(null)
        promise.resolve(null)
      }
      context.startService(Intent(context, ScreenCaptureService::class.java).setAction(ScreenCaptureService.ACTION_STOP))
    }

    AsyncFunction("startAsync") { promise: Promise ->
      if (Build.VERSION.SDK_INT < 29) throw UnsupportedException()
      if (RecorderBridge.recording || pendingStart != null) throw AlreadyRecordingException()
      pendingStart = promise
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

    /** Deletes every recording on disk except an active session's: the session screen is gone. */
    AsyncFunction("purgeAsync") { sweepOrphans() }

    OnDestroy { RecorderBridge.onStopped = null }
  }

  private fun sweepOrphans() {
    val dir = java.io.File(context.cacheDir, "recordings")
    val keep = RecorderBridge.currentFile
    dir.listFiles()?.forEach { f -> if (f != keep) f.delete() }
  }
}
