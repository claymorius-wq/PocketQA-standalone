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
import android.media.MediaRecorder
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
 * A foreground service of types mediaProjection|microphone. It is started right after the in-app
 * consent dialog, while Pocket QA is in the foreground: Android 14+ refuses to create a microphone
 * FGS from the background. It calls startForeground() with BOTH types BEFORE getMediaProjection(),
 * creates one virtual display per consent token, and records MIC (AAC) + SURFACE (H.264) into ONE
 * app-private MP4.
 *
 * Every way a session ends finalises it exactly once, keeps the clip and says why:
 *  - user: in-app Stop or the notification's Stop;
 *  - system: the status-bar chip, screen lock, a revoked projection, or the service being destroyed;
 *  - mic: the microphone was taken away (e.g. a phone call silences us);
 *  - error: a MediaRecorder error;
 *  - limit: the 15-minute or 500 MB cap.
 * Finished clips go to [PendingStore], so the session screen gets them back even if the tester
 * only returns later.
 */
class ScreenCaptureService : Service() {
  private var projection: MediaProjection? = null
  private var display: VirtualDisplay? = null
  private var recorder: MediaRecorder? = null
  private var output: File? = null
  private var tag = ""
  private var startedAt = 0L
  private var stopping = false
  private var silentTicks = 0
  private val main = Handler(Looper.getMainLooper())
  private val store by lazy { recordingStore(this) }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> start(intent)
      // A Stop with no session (a stale notification action, a late in-app Stop) must not leave the
      // service running (pqa-qa r1 P3-5).
      ACTION_STOP -> if (recorder == null) stopSelf() else finish("user")
    }
    return START_NOT_STICKY
  }

  private fun start(intent: Intent) {
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
    startForegroundCompat()
    try {
      val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
      val mp = mpm.getMediaProjection(resultCode, data) ?: throw IllegalStateException("no projection")
      projection = mp
      mp.registerCallback(object : MediaProjection.Callback() {
        override fun onStop() {
          // Status-bar chip, screen lock, another projection, or revoked consent.
          finish("system")
        }
      }, main)

      val (w, h, dpi) = captureSize()
      val file = store.newFile(tag)
      output = file
      RecorderBridge.currentFile = file
      val rec = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(this) else @Suppress("DEPRECATION") MediaRecorder()
      // Order matters: sources, then format, then encoders.
      rec.setAudioSource(MediaRecorder.AudioSource.MIC)
      rec.setVideoSource(MediaRecorder.VideoSource.SURFACE)
      rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      rec.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
      rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
      rec.setAudioSamplingRate(44_100)
      rec.setAudioChannels(1)
      rec.setAudioEncodingBitRate(128_000)
      rec.setVideoSize(w, h)
      rec.setVideoFrameRate(30)
      rec.setVideoEncodingBitRate(4_000_000)
      rec.setMaxDuration(MAX_DURATION_MS)
      rec.setMaxFileSize(MAX_BYTES)
      rec.setOnInfoListener { _, what, _ ->
        if (what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_DURATION_REACHED || what == MediaRecorder.MEDIA_RECORDER_INFO_MAX_FILESIZE_REACHED) main.post { finish("limit") }
      }
      rec.setOnErrorListener { _, _, _ -> main.post { finish("error") } }
      rec.setOutputFile(file.absolutePath)
      rec.prepare()
      recorder = rec
      // One virtual display per consent token (Android 14+ throws if reused). The display is
      // mirrored at a fixed size, so a rotated screen is letterboxed and recording continues.
      display = mp.createVirtualDisplay("PocketQaCapture", w, h, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, rec.surface, null, null)
      rec.start()
      startedAt = SystemClock.elapsedRealtime()
      RecorderBridge.recording = true
      main.postDelayed(micWatch, 1000)
    } catch (e: Exception) {
      cleanup()
      output?.let(store::forget)
      notifyStopped("error", null)
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
    }
  }

  /**
   * The microphone can be taken from us while recording, e.g. by a phone call, which silences our
   * capture. Two silenced seconds in a row end the session (reason "mic"): the clip so far is kept,
   * and the tester is told, rather than recording on without their voice.
   */
  private val micWatch: Runnable = object : Runnable {
    override fun run() {
      val rec = recorder ?: return
      if (stopping) return
      val silenced = Build.VERSION.SDK_INT >= 29 && try {
        rec.activeRecordingConfiguration?.isClientSilenced == true
      } catch (_: Exception) {
        false
      }
      silentTicks = if (silenced) silentTicks + 1 else 0
      if (silentTicks >= 2) finish("mic") else main.postDelayed(this, 1000)
    }
  }

  /** Even dimensions capped at 1280 on the long edge keep encoders happy and files small. */
  private fun captureSize(): Triple<Int, Int, Int> {
    val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val bounds = wm.maximumWindowMetrics.bounds
    val dpi = resources.displayMetrics.densityDpi.takeIf { it > 0 } ?: DisplayMetrics.DENSITY_DEFAULT
    val (w, h) = CaptureMath.size(bounds.width(), bounds.height(), 1280)
    return Triple(w, h, dpi)
  }

  private fun finish(reason: String) {
    if (stopping || recorder == null) return
    stopping = true
    main.removeCallbacks(micWatch)
    val file = output
    val durationMs = SystemClock.elapsedRealtime() - startedAt
    val stopped = try {
      recorder?.stop()
      true
    } catch (e: RuntimeException) {
      // stop() throws if no frames were captured. After a cap the recorder may already have stopped
      // itself, and the file it finalised is then still valid.
      reason == "limit"
    }
    // The finished file is measured, then recorded as pending, BEFORE cleanup() stops protecting it
    // as the active file: a concurrent sweep can't take it in between (pqa-qa r1 P3-2). A file with
    // no readable index can't be played and is dropped; a clip whose voice doesn't cover the video
    // is kept for review but marked, and is never offered as narrated evidence.
    var clip: Clip? = null
    if (file != null) {
      val voice = if (stopped) VoiceCheck.inspect(file) else null
      if (voice != null && store.markComplete(file, durationMs, tag, reason, voice)) {
        clip = Clip(file, durationMs, voice.videoMs, voice.voiceMs, voice.complete)
      } else {
        store.forget(file)
      }
    }
    cleanup()
    // A finalised recording that couldn't be kept (unreadable or empty) is an error, whatever stopped it.
    notifyStopped(if (stopped && clip == null) "error" else reason, clip)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun cleanup() {
    RecorderBridge.recording = false
    RecorderBridge.currentFile = null
    try { recorder?.release() } catch (_: Exception) {}
    recorder = null
    display?.release()
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

  private fun startForegroundCompat() {
    val n = notification()
    when {
      Build.VERSION.SDK_INT >= 30 -> startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      Build.VERSION.SDK_INT >= 29 -> startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
      else -> startForeground(NOTIFICATION_ID, n)
    }
  }

  private fun notification(): Notification {
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
      .setContentTitle("Pocket QA is recording your screen and microphone")
      .setContentText("Stop when you're done. You'll review the clip before anything is uploaded.")
      .setSmallIcon(android.R.drawable.presence_video_online)
      .setOngoing(true)
      .apply { if (open != null) setContentIntent(open) }
      .addAction(Notification.Action.Builder(null, "Stop recording", stop).build())
      .build()
  }

  override fun onDestroy() {
    if (RecorderBridge.recording) finish("system")
    main.removeCallbacks(micWatch)
    super.onDestroy()
  }

  companion object {
    const val ACTION_START = "expo.modules.pocketqascreencapture.START"
    const val ACTION_STOP = "expo.modules.pocketqascreencapture.STOP"
    const val EXTRA_RESULT_CODE = "resultCode"
    const val EXTRA_DATA = "data"
    const val EXTRA_TAG = "tag"
    const val MAX_DURATION_MS = 15 * 60 * 1000
    const val MAX_BYTES = 500L * 1024 * 1024
    private const val CHANNEL = "pocketqa-recording"
    private const val NOTIFICATION_ID = 4711
  }
}
