package expo.modules.pocketqascreencapture

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.DisplayMetrics
import android.view.WindowManager
import java.io.File

/**
 * Screen + microphone capture that continues while the tester uses OTHER apps
 * (docs/plans/native-screen-voice-recording.md).
 *
 * A foreground service of types mediaProjection|microphone, started in two steps ([CaptureStart],
 * full E2E P-13): PREPARE, on the tester's tap while Pocket QA is in front, puts it in the foreground
 * with the microphone type only (Android decides at service start whether a microphone FGS may run;
 * with "A single app" the shared app is already in front when the consent result arrives); START,
 * with the consent, adds the mediaProjection type. Every startForeground() is guarded: a refusal ends
 * the attempt cleanly ("error"), never crashes. It calls startForeground() with BOTH types BEFORE getMediaProjection(),
 * creates one virtual display per consent token, and records the screen and the MICROPHONE into ONE
 * app-private MP4 through [CapturePipeline] (our own AudioRecord + MediaCodec + MediaMuxer; MediaRecorder
 * stalled its audio for good on the emulator, docs/plans/native-capture-pipeline.md).
 *
 * Every way a session ends finalises it exactly once, keeps the clip and says why:
 *  - user: in-app Stop or the notification's Stop;
 *  - system: the status-bar chip, screen lock, a revoked projection, or the service being destroyed;
 *  - mic: the microphone was taken away (another app or a call silences us, or it stopped delivering);
 *  - error: an encoder, muxer or capture error;
 *  - limit: the 15-minute or 500 MB cap.
 * Finished clips go to [PendingStore], so the session screen gets them back even if the tester
 * only returns later.
 */
class ScreenCaptureService : Service() {
  private var projection: MediaProjection? = null
  private var display: VirtualDisplay? = null
  private var pipeline: CapturePipeline? = null
  private var output: File? = null
  private var tag = ""
  private var startedAt = 0L
  private var stopping = false
  private val liveness = Liveness(silencedForMs = 2_000, noAudioForMs = 3_000)
  private val main = Handler(Looper.getMainLooper())
  private val store by lazy { recordingStore(this) }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_PREPARE -> prepare(intent)
      ACTION_START -> start(intent)
      // Consent declined or abandoned before any capture: leave the foreground and stop.
      ACTION_CANCEL -> if (pipeline == null) endPrepared()
      // A Stop with no session (a stale notification action, a late in-app Stop) must not leave the
      // service running (pqa-qa r1 P3-5).
      ACTION_STOP -> if (pipeline == null) stopSelf() else finish("user")
    }
    return START_NOT_STICKY
  }

  /** Step 1: in the foreground with the microphone type, while Pocket QA is still in front. */
  private fun prepare(intent: Intent) {
    tag = intent.getStringExtra(EXTRA_TAG) ?: ""
    val ok = startForegroundFor(CaptureStart.Phase.PREPARE, notification(preparing = true))
    if (!ok) {
      // startForegroundService's contract still needs a startForeground before stopping.
      startForegroundForFailure(projection = false)
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
    } else {
      // Consent never arrives (the app was killed, the dialog abandoned): don't hold the foreground.
      main.postDelayed(prepareExpiry, PREPARE_EXPIRY_MS)
    }
    RecorderBridge.onPrepared?.invoke(ok)
  }

  private val prepareExpiry = Runnable { if (pipeline == null) endPrepared() }

  private fun endPrepared() {
    main.removeCallbacks(prepareExpiry)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  /** startForeground with this phase's types; false (never a crash) if Android refuses. */
  private fun startForegroundFor(phase: CaptureStart.Phase, n: Notification): Boolean {
    val types = CaptureStart.typesFor(phase, Build.VERSION.SDK_INT)
    return CaptureStart.guarded {
      if (types == null) startForeground(NOTIFICATION_ID, n) else startForeground(NOTIFICATION_ID, n, types)
    }
  }

  /** Step 2: the consent arrived; add the mediaProjection type and capture. */
  private fun start(intent: Intent) {
    main.removeCallbacks(prepareExpiry)
    val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
    val data: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_DATA, Intent::class.java) else @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_DATA)
    tag = intent.getStringExtra(EXTRA_TAG) ?: ""
    // Narration is required: without the microphone permission nothing is recorded (no video-only clip).
    if (resultCode != Activity.RESULT_OK || data == null || checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      // The module checks both before starting us, so this is only a race (consent or the
      // microphone revoked in between). A service started with startForegroundService must still
      // call startForeground before it stops, or Android kills the app (pqa-qa r1 P3-1).
      startForegroundForFailure(projection = resultCode == Activity.RESULT_OK && data != null)
      notifyStopped("error", null)
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return
    }
    if (!startForegroundFor(CaptureStart.Phase.CAPTURE, notification())) {
      // Refused (the platform didn't allow the types now): end cleanly, nothing was captured.
      notifyStopped("error", null)
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
      return
    }
    try {
      val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      val mp = mpm.getMediaProjection(resultCode, data) ?: throw IllegalStateException("no projection")
      projection = mp
      mp.registerCallback(object : MediaProjection.Callback() {
        override fun onStop() {
          // Status-bar chip, screen lock (Android 15 QPR1+), another projection, or revoked consent.
          finish("system")
        }
      }, main)

      val (w, h, dpi) = captureSize()
      val file = store.newFile(tag)
      output = file
      RecorderBridge.currentFile = file
      val p = CapturePipeline(file, w, h) { reason -> main.post { finish(reason) } }
      pipeline = p
      p.prepare()
      // One virtual display per consent token (Android 14+ throws if reused). The display is
      // mirrored at a fixed size, so a rotated screen is letterboxed and recording continues; the
      // microphone path is separate and never sees the rotation.
      display = mp.createVirtualDisplay("PocketQaCapture", w, h, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, p.inputSurface, null, null)
      p.start()
      startedAt = SystemClock.elapsedRealtime()
      liveness.started(startedAt)
      RecorderBridge.recording = true
      main.postDelayed(watch, 1000)
      main.postDelayed(durationCap, MAX_DURATION_MS.toLong())
    } catch (e: Exception) {
      try { display?.release() } catch (_: Exception) {}
      display = null
      try { pipeline?.stop() } catch (_: Exception) {}
      pipeline = null
      cleanup()
      output?.let(store::forget)
      notifyStopped("error", null)
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
    }
  }

  /**
   * Once a second: a microphone silenced for 2 s (another app took it, a call) or delivering nothing
   * for 3 s ends the session (reason "mic"); the clip so far is kept and the tester is told, rather
   * than recording on without their voice. The 500 MB cap is checked here too.
   */
  private val watch: Runnable = object : Runnable {
    override fun run() {
      val p = pipeline ?: return
      if (stopping) return
      val now = SystemClock.elapsedRealtime()
      val reason = liveness.check(now, p.lastAudioMs, p.silenced()) ?: if (p.bytes >= MAX_BYTES) "limit" else null
      if (reason != null) finish(reason) else main.postDelayed(this, 1000)
    }
  }

  private val durationCap = Runnable { finish("limit") }

  /** Even dimensions capped at 1280 on the long edge keep encoders happy and files small. */
  private fun captureSize(): Triple<Int, Int, Int> {
    val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val bounds = wm.maximumWindowMetrics.bounds
    val dpi = resources.displayMetrics.densityDpi.takeIf { it > 0 } ?: DisplayMetrics.DENSITY_DEFAULT
    val (w, h) = CaptureMath.size(bounds.width(), bounds.height(), 1280)
    return Triple(w, h, dpi)
  }

  private fun finish(reason: String) {
    val p = pipeline
    if (stopping || p == null) return
    stopping = true
    main.removeCallbacks(watch)
    main.removeCallbacks(durationCap)
    val file = output
    val durationMs = SystemClock.elapsedRealtime() - startedAt
    // The display stops feeding the encoder first; then both streams end and the file is finalised.
    try { display?.release() } catch (_: Exception) {}
    display = null
    // Draining the encoders and finalising the muxer can take seconds: never on the main thread
    // (pqa-qa pipeline r1 P3). The file stays protected as the active one until it is recorded.
    Thread({
      val written = try { p.stop() } catch (_: Exception) { false }
      // The finished file is measured, then recorded as pending, BEFORE cleanup() stops protecting
      // it as the active file: a concurrent sweep can't take it in between (pqa-qa r1 P3-2). A file
      // with no readable index can't be played and is dropped; a clip whose voice doesn't cover the
      // video (including audio lost inside it) is kept for review but marked, and is never offered
      // as narrated evidence.
      var clip: Clip? = null
      if (file != null) {
        val voice = if (written) VoiceCheck.inspect(file, lostAudioMs = p.lostAudioMs, maxGapMs = p.maxGapMs) else null
        if (voice != null && store.markComplete(file, durationMs, tag, reason, voice)) {
          clip = Clip(file, durationMs, voice.videoMs, voice.voiceMs, voice.complete, voice.lostMs)
        } else {
          store.forget(file)
        }
      }
      main.post {
        cleanup()
        // A recording that couldn't be finalised or kept is an error, whatever stopped it.
        notifyStopped(if (clip == null) "error" else reason, clip)
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
      }
    }, "pqa-capture-finish").start()
  }

  private fun cleanup() {
    RecorderBridge.recording = false
    RecorderBridge.currentFile = null
    pipeline = null
    try { display?.release() } catch (_: Exception) {}
    display = null
    try { projection?.stop() } catch (_: Exception) {}
    projection = null
  }

  private fun notifyStopped(reason: String, clip: Clip?) {
    val pending = RecorderBridge.pendingStop
    RecorderBridge.pendingStop = null
    if (pending != null) pending(clip) else RecorderBridge.onStopped?.invoke(reason, clip)
  }

  /** Satisfies startForegroundService's contract on a failed start with whatever type is still allowed. */
  private fun startForegroundForFailure(projection: Boolean) {
    val types = buildList {
      if (Build.VERSION.SDK_INT >= 30 && projection) add(ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      if (Build.VERSION.SDK_INT >= 29 && projection) add(ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
      if (Build.VERSION.SDK_INT >= 30) add(ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    }
    val n = notification()
    for (t in types) {
      try {
        startForeground(NOTIFICATION_ID, n, t)
        return
      } catch (_: Exception) {
        // Not allowed with this type; try the next.
      }
    }
  }

  private fun notification(preparing: Boolean = false): Notification {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    nm.createNotificationChannel(NotificationChannel(CHANNEL, "Screen recording", NotificationManager.IMPORTANCE_LOW))
    // A Stop action gives every Android version (including 10–14, which have no status-bar chip) a
    // way to end capture from any app; tapping the notification brings Pocket QA back for review.
    val stop = PendingIntent.getService(
      this, 1, Intent(this, ScreenCaptureService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val open = packageManager.getLaunchIntentForPackage(packageName)?.let {
      PendingIntent.getActivity(this, 2, it.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    return Notification.Builder(this, CHANNEL)
      .setContentTitle(if (preparing) "Pocket QA is waiting for screen-share permission" else "Pocket QA is recording your screen and microphone")
      .setContentText(if (preparing) "Nothing is recorded until you allow screen sharing." else "Stop when you're done. You'll review the clip before anything is uploaded.")
      .setSmallIcon(android.R.drawable.presence_video_online)
      .setOngoing(true)
      .apply { if (open != null) setContentIntent(open) }
      .addAction(Notification.Action.Builder(null, "Stop recording", stop).build())
      .build()
  }

  override fun onDestroy() {
    if (RecorderBridge.recording) finish("system")
    main.removeCallbacks(watch)
    main.removeCallbacks(durationCap)
    main.removeCallbacks(prepareExpiry)
    super.onDestroy()
  }

  companion object {
    const val ACTION_PREPARE = "expo.modules.pocketqascreencapture.PREPARE"
    const val ACTION_START = "expo.modules.pocketqascreencapture.START"
    const val ACTION_CANCEL = "expo.modules.pocketqascreencapture.CANCEL"
    const val ACTION_STOP = "expo.modules.pocketqascreencapture.STOP"
    const val EXTRA_RESULT_CODE = "resultCode"
    const val EXTRA_DATA = "data"
    const val EXTRA_TAG = "tag"
    const val MAX_DURATION_MS = 15 * 60 * 1000
    const val MAX_BYTES = 500L * 1024 * 1024
    private const val CHANNEL = "pocketqa-recording"
    private const val NOTIFICATION_ID = 4711
    /** A prepared service with no consent after this long stops itself (the dialog was abandoned). */
    private const val PREPARE_EXPIRY_MS = 120_000L
  }
}
