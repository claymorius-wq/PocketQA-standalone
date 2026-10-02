package expo.modules.pocketqascreencapture

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
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
import java.util.UUID

/**
 * Foreground service of type mediaProjection (required on Android 14+). It is started
 * with the consent result, calls startForeground() BEFORE getMediaProjection(), creates
 * exactly one virtual display per consent token, and registers MediaProjection.Callback
 * so a stop from the status-bar chip or screen lock still finalizes the clip.
 */
class ScreenCaptureService : Service() {
  private var projection: MediaProjection? = null
  private var display: VirtualDisplay? = null
  private var recorder: MediaRecorder? = null
  private var output: File? = null
  private var startedAt = 0L
  private var stopping = false

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_START -> start(intent)
      ACTION_STOP -> finish("user")
    }
    return START_NOT_STICKY
  }

  private fun start(intent: Intent) {
    val resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
    val data: Intent? = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(EXTRA_DATA, Intent::class.java) else @Suppress("DEPRECATION") intent.getParcelableExtra(EXTRA_DATA)
    if (resultCode != Activity.RESULT_OK || data == null) {
      notifyStopped("error", null)
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
          // Status-bar chip, screen lock, another projection, or process death.
          finish("system")
        }
      }, Handler(Looper.getMainLooper()))

      val (w, h, dpi) = captureSize()
      val dir = File(cacheDir, "recordings").apply { mkdirs() }
      val file = File(dir, "${UUID.randomUUID()}.mp4")
      output = file
      RecorderBridge.currentFile = file
      val rec = if (Build.VERSION.SDK_INT >= 31) MediaRecorder(this) else @Suppress("DEPRECATION") MediaRecorder()
      rec.setVideoSource(MediaRecorder.VideoSource.SURFACE)
      rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
      rec.setVideoEncoder(MediaRecorder.VideoEncoder.H264)
      rec.setVideoSize(w, h)
      rec.setVideoFrameRate(30)
      rec.setVideoEncodingBitRate(4_000_000)
      rec.setOutputFile(file.absolutePath)
      rec.prepare()
      recorder = rec
      // One virtual display per consent token (Android 14+ throws if reused).
      display = mp.createVirtualDisplay("PocketQaCapture", w, h, dpi, DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, rec.surface, null, null)
      rec.start()
      startedAt = SystemClock.elapsedRealtime()
      RecorderBridge.recording = true
    } catch (e: Exception) {
      cleanup()
      output?.delete()
      notifyStopped("error", null)
      stopSelf()
    }
  }

  /** Even dimensions capped at 1280 on the long edge keep encoders happy and files small. */
  private fun captureSize(): Triple<Int, Int, Int> {
    val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
    val bounds = wm.maximumWindowMetrics.bounds
    val dpi = resources.displayMetrics.densityDpi.takeIf { it > 0 } ?: DisplayMetrics.DENSITY_DEFAULT
    val scale = minOf(1.0, 1280.0 / maxOf(bounds.width(), bounds.height()))
    val w = ((bounds.width() * scale).toInt() / 2) * 2
    val h = ((bounds.height() * scale).toInt() / 2) * 2
    return Triple(w, h, dpi)
  }

  private fun finish(reason: String) {
    if (stopping) return
    stopping = true
    var clip: Clip? = null
    val file = output
    try {
      recorder?.stop()
      if (file != null && file.exists() && file.length() > 0) clip = Clip(file, SystemClock.elapsedRealtime() - startedAt)
    } catch (e: RuntimeException) {
      // stop() throws if no frames were captured; nothing usable was recorded.
      file?.delete()
    }
    cleanup()
    notifyStopped(reason, clip)
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

  private fun startForegroundCompat() {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    nm.createNotificationChannel(NotificationChannel(CHANNEL, "Screen recording", NotificationManager.IMPORTANCE_LOW))
    // A Stop action in the notification gives every Android version (including 10–14,
    // which have no status-bar chip) a way to end capture from anywhere.
    val stop = PendingIntent.getService(
      this, 1, Intent(this, ScreenCaptureService::class.java).setAction(ACTION_STOP),
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val n: Notification = Notification.Builder(this, CHANNEL)
      .setContentTitle("Pocket QA is recording your screen")
      .setContentText("You'll review the clip before anything is uploaded.")
      .setSmallIcon(android.R.drawable.presence_video_online)
      .setOngoing(true)
      .addAction(Notification.Action.Builder(null, "Stop recording", stop).build())
      .build()
    if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)
    else startForeground(NOTIFICATION_ID, n)
  }

  override fun onDestroy() {
    if (RecorderBridge.recording) finish("system")
    super.onDestroy()
  }

  companion object {
    const val ACTION_START = "expo.modules.pocketqascreencapture.START"
    const val ACTION_STOP = "expo.modules.pocketqascreencapture.STOP"
    const val EXTRA_RESULT_CODE = "resultCode"
    const val EXTRA_DATA = "data"
    private const val CHANNEL = "pocketqa-recording"
    private const val NOTIFICATION_ID = 4711
  }
}
