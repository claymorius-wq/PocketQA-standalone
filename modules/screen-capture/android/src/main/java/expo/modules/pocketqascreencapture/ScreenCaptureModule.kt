package expo.modules.pocketqascreencapture

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.Looper
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
class ForegroundRefusedException : CodedException(CaptureStart.FOREGROUND_REFUSED, "Android didn't let Pocket QA start recording. Keep Pocket QA open and try again.", null)
class StartFailedException : CodedException(CaptureStart.START_FAILED, "The recording couldn't start. Nothing was recorded.", null)

/** How long the module waits for the service to confirm it is in the foreground before giving up. */
private const val PREPARE_TIMEOUT_MS = 5_000L

/**
 * JS surface (docs/plans/native-screen-voice-recording.md):
 *  - startAsync(tag) needs RECORD_AUDIO already granted (narration is part of every recording) and
 *    shows the system consent dialog EVERY time (no cached token, no silent start). The recording
 *    service is put in the foreground with the microphone type BEFORE that dialog, while Pocket QA
 *    is in front ([CaptureStart], full E2E P-13): with "A single app" Android brings the chosen app
 *    forward before the result arrives, and a microphone service can't start from the background;
 *  - stopAsync() finalises and returns the local clip;
 *  - "onStopped" fires when a session ends any other way (notification Stop, system chip, lock,
 *    microphone loss, error, cap);
 *  - takePendingAsync(tag) lists that session's finished clips whose files still exist (the tester
 *    was in another app, JS reloaded, or the screen was destroyed in the background); each clip
 *    carries its voice verdict (voiceComplete, voiceMs, videoMs);
 *  - takeInterruptedAsync(tag) counts that session's recordings lost to process death, once;
 *  - clearAllAsync() stops and deletes everything (sign-out, account deletion).
 */
class ScreenCaptureModule : Module() {
  private var pendingStart: Promise? = null
  private var pendingTag = ""
  private var consent: Pair<Int, Intent>? = null
  private val main = Handler(Looper.getMainLooper())
  private val timeout = Runnable { starter.timedOut() }
  private val starter: CaptureStart = CaptureStart(object : CaptureStart.Ops {
    override fun prepareService() {
      main.postDelayed(timeout, PREPARE_TIMEOUT_MS)
      RecorderBridge.onPrepared = { ok ->
        main.post {
          main.removeCallbacks(timeout)
          starter.prepared(ok)
        }
      }
      val svc = Intent(context, ScreenCaptureService::class.java).setAction(ScreenCaptureService.ACTION_PREPARE).putExtra(ScreenCaptureService.EXTRA_TAG, pendingTag)
      // Pocket QA is in front (the tester just tapped Record), so a microphone FGS may start now.
      try {
        context.startForegroundService(svc)
      } catch (_: Exception) {
        main.removeCallbacks(timeout)
        starter.prepared(false)
      }
    }

    override fun launchConsent() {
      try {
        val mpm = context.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        // Default intent: on Android 14+ the user chooses a single app or the entire screen.
        appContext.throwingActivity.startActivityForResult(mpm.createScreenCaptureIntent(), CAPTURE_REQUEST)
      } catch (_: Exception) {
        starter.consentResult(granted = false)
      }
    }

    override fun startCapture(): Boolean {
      val (resultCode, data) = consent ?: return false
      consent = null
      // The service is already in the foreground, so this is allowed even if the shared app is now in front.
      val svc = Intent(context, ScreenCaptureService::class.java)
        .setAction(ScreenCaptureService.ACTION_START)
        .putExtra(ScreenCaptureService.EXTRA_RESULT_CODE, resultCode)
        .putExtra(ScreenCaptureService.EXTRA_DATA, data)
        .putExtra(ScreenCaptureService.EXTRA_TAG, pendingTag)
      return try {
        context.startService(svc)
        true
      } catch (_: Exception) {
        false
      }
    }

    override fun cancelService() {
      try {
        context.startService(Intent(context, ScreenCaptureService::class.java).setAction(ScreenCaptureService.ACTION_CANCEL))
      } catch (_: Exception) {
        // Not running (or not startable from here): nothing to cancel.
      }
    }

    override fun resolve() {
      pendingStart?.resolve(null)
      pendingStart = null
    }

    override fun reject(code: String) {
      pendingStart?.reject(
        when (code) {
          CaptureStart.CONSENT_DENIED -> ConsentDeniedException()
          CaptureStart.FOREGROUND_REFUSED -> ForegroundRefusedException()
          else -> StartFailedException()
        },
      )
      pendingStart = null
    }
  })
  private val store: PendingStore get() = recordingStore(context)
  private val context: Context get() = appContext.reactContext ?: throw IllegalStateException("React context lost")

  override fun definition() = ModuleDefinition {
    Name("PocketQaScreenCapture")
    Events("onStopped")

    OnCreate {
      // Truncated files (the process died mid-recording) and files JS lost track of are deleted;
      // finished, unclaimed clips stay for their session to claim (expiring after a day).
      store.sweep(active = RecorderBridge.currentFile)
      // Builds before 2026-10-05 kept recordings in the evictable cache; nothing there is offered any more.
      java.io.File(context.cacheDir, "recordings").deleteRecursively()
      RecorderBridge.onStopped = { reason, clip ->
        sendEvent("onStopped", mapOf("reason" to reason, "clip" to clip?.toMap()))
      }
    }

    Function("isRecording") { RecorderBridge.recording }

    /** Stops an active session (if any) and deletes its file: used when the session screen goes away. */
    AsyncFunction("discardAsync") { promise: Promise -> discard { promise.resolve(null) } }

    /** Sign-out and account deletion: stop any session and delete every clip and notice. */
    AsyncFunction("clearAllAsync") { promise: Promise ->
      discard {
        store.clearAll(active = RecorderBridge.currentFile)
        promise.resolve(null)
      }
    }

    AsyncFunction("startAsync") { tag: String, promise: Promise ->
      if (Build.VERSION.SDK_INT < 29) throw UnsupportedException()
      if (RecorderBridge.recording || pendingStart != null) throw AlreadyRecordingException()
      // No video-only fallback: without the microphone nothing is recorded.
      if (context.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) throw MicDeniedException()
      pendingStart = promise
      pendingTag = tag
      main.post { starter.begin() }
    }

    OnActivityResult { _, (requestCode, resultCode, data) ->
      if (requestCode != CAPTURE_REQUEST) return@OnActivityResult
      val granted = resultCode == Activity.RESULT_OK && data != null
      if (granted) consent = resultCode to data!!
      main.post { starter.consentResult(granted) }
    }

    AsyncFunction("stopAsync") { promise: Promise ->
      if (!RecorderBridge.recording) throw NotRecordingException()
      RecorderBridge.pendingStop = { clip ->
        if (clip != null) promise.resolve(clip.toMap()) else promise.reject(NotRecordingException())
      }
      context.startService(Intent(context, ScreenCaptureService::class.java).setAction(ScreenCaptureService.ACTION_STOP))
    }

    /** Finished clips of this session that JS hasn't deleted yet (uploaded or discarded). */
    AsyncFunction("takePendingAsync") { tag: String ->
      store.pending(tag).map { Clip.of(it).toMap() }
    }

    AsyncFunction("takeInterruptedAsync") { tag: String -> store.takeInterrupted(tag) }

    /** The session screen is gone: delete truncated files and expired clips (finished clips stay for their session). */
    AsyncFunction("purgeAsync") { store.sweep(active = RecorderBridge.currentFile) }

    OnDestroy {
      RecorderBridge.onStopped = null
      RecorderBridge.onPrepared = null
      main.removeCallbacks(timeout)
    }
  }

  /** Stops an active session (if any) and deletes its file, then calls [done]. */
  private fun discard(done: () -> Unit) {
    if (!RecorderBridge.recording) {
      done()
      return
    }
    // If stopAsync() is already waiting, settle it too (its clip is being discarded).
    val previous = RecorderBridge.pendingStop
    RecorderBridge.pendingStop = { clip ->
      clip?.let { store.forget(it.file) }
      previous?.invoke(null)
      done()
    }
    context.startService(Intent(context, ScreenCaptureService::class.java).setAction(ScreenCaptureService.ACTION_STOP))
  }
}
