package expo.modules.pocketqascreencapture

import android.annotation.SuppressLint
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioRecordingConfiguration
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.os.Process
import android.os.SystemClock
import android.util.Log
import android.view.Surface
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.Executors

/**
 * Screen + microphone into one MP4, replacing MediaRecorder (docs/plans/native-capture-pipeline.md).
 *
 * MediaRecorder's audio track stopped for good after emulator stalls (voice 202.7 s of 391.7 s,
 * 2:48 of 2:57, 2:07 of 3:44, with "AudioRecord reported overrun" floods) and its API reports nothing.
 * Here every stage is ours, so it can't stall silently:
 *  - audio: AudioRecord (MIC, 44.1 kHz mono PCM16) read in 10 ms chunks on a THREAD_PRIORITY_URGENT_AUDIO
 *    thread (as WebRTC's WebRtcAudioRecord does), with a capture buffer of at least 2x the minimum and
 *    ~0.5 s so a scheduling stall is absorbed, not dropped; chunks go through a bounded backlog to an
 *    AAC MediaCodec, timed by [AudioClock] (sample-accurate, re-anchored after a real overrun);
 *  - video: an H.264 MediaCodec in surface-input mode, fed by the MediaProjection virtual display; a
 *    still screen keeps producing frames (KEY_REPEAT_PREVIOUS_FRAME_AFTER). Its frames carry the same
 *    monotonic clock, and rotation never touches the audio path;
 *  - [MuxGate] starts MediaMuxer when both formats are known and keeps each track in increasing time;
 *  - liveness: [lastAudioMs], silencing from an AudioRecordingCallback registered BEFORE capture starts
 *    (sharing-audio-input) plus the active configuration, read errors, and dropped/lost audio, all
 *    reported to the service.
 * Nothing leaves the device: the file is app-private and goes through the usual review.
 */
class CapturePipeline(private val file: File, private val width: Int, private val height: Int, private val onFatal: (String) -> Unit) {
  private class Chunk(val data: ByteArray, val ptsUs: Long)

  /** Monotonic µs; the virtual display stamps its frames on the same clock (System.nanoTime). */
  private val baseUs = System.nanoTime() / 1000
  private val muxer = MediaMuxer(file.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
  private val gate = MuxGate(object : MuxGate.Sink<MediaFormat> {
    override fun addTrack(format: MediaFormat) = muxer.addTrack(format)
    override fun start() = muxer.start()
    override fun write(track: Int, data: ByteArray, ptsUs: Long, flags: Int) {
      val info = MediaCodec.BufferInfo().apply { set(0, data.size, ptsUs, flags) }
      muxer.writeSampleData(track, ByteBuffer.wrap(data), info)
    }
  }, baseUs, maxPending = 2_000)
  private lateinit var video: MediaCodec
  private lateinit var audio: MediaCodec
  private lateinit var record: AudioRecord
  private lateinit var clock: AudioClock
  private val backlog = PcmBacklog<Chunk>(capacity = 100) // 1 s of audio waiting for the encoder
  private val callbacks = Executors.newSingleThreadExecutor()
  private var audioThread: Thread? = null
  private var videoThread: Thread? = null
  @Volatile private var running = false
  @Volatile private var silencedByCallback = false
  @Volatile private var lastAudioPtsUs = 0L

  /** The surface the virtual display renders into. */
  lateinit var inputSurface: Surface
    private set
  /** SystemClock.elapsedRealtime() of the last audio chunk read, or -1 before the first. */
  @Volatile var lastAudioMs = -1L
    private set
  val bytes get() = gate.bytes
  /** Audio lost to overruns or a backlog the encoder couldn't keep up with. */
  val lostAudioMs get() = clock.lostUs / 1000 + backlog.dropped * CHUNK_MS

  @SuppressLint("MissingPermission") // RECORD_AUDIO is checked by the module and the service first
  fun prepare() {
    val vf = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
      setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
      setInteger(MediaFormat.KEY_BIT_RATE, 4_000_000)
      setInteger(MediaFormat.KEY_FRAME_RATE, 30)
      setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 1)
      setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 100_000)
    }
    video = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_VIDEO_AVC)
    video.configure(vf, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
    inputSurface = video.createInputSurface()

    val af = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, SAMPLE_RATE, 1).apply {
      setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
      setInteger(MediaFormat.KEY_BIT_RATE, 128_000)
      setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, CHUNK_BYTES * 4)
    }
    audio = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
    audio.configure(af, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)

    val min = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    check(min > 0) { "AudioRecord.getMinBufferSize failed: $min" }
    val bufferBytes = maxOf(2 * min, SAMPLE_RATE * 2 / 2) // >= 2x minimum and >= 0.5 s
    clock = AudioClock(SAMPLE_RATE, bufferUs = bufferBytes / 2 * 1_000_000L / SAMPLE_RATE)
    record = AudioRecord.Builder()
      .setAudioSource(MediaRecorder.AudioSource.MIC)
      .setAudioFormat(AudioFormat.Builder().setSampleRate(SAMPLE_RATE).setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
      .setBufferSizeInBytes(bufferBytes)
      .build()
    check(record.state == AudioRecord.STATE_INITIALIZED) { "AudioRecord not initialised" }
    // Must be registered before capture starts; called when this client's capture configuration
    // changes, e.g. another app took the microphone and we now get silence.
    record.registerAudioRecordingCallback(callbacks, object : AudioManager.AudioRecordingCallback() {
      override fun onRecordingConfigChanged(configs: List<AudioRecordingConfiguration>) {
        silencedByCallback = record.activeRecordingConfiguration?.isClientSilenced == true
      }
    })
  }

  fun start() {
    running = true
    video.start()
    audio.start()
    record.startRecording()
    check(record.recordingState == AudioRecord.RECORDSTATE_RECORDING) { "microphone did not start" }
    videoThread = Thread(::runVideo, "pqa-capture-video").apply { start() }
    audioThread = Thread(::runAudio, "pqa-capture-audio").apply { start() }
  }

  /** Silenced by the capture policy, by the callback or by the current configuration. */
  fun silenced(): Boolean = silencedByCallback || try {
    record.activeRecordingConfiguration?.isClientSilenced == true
  } catch (_: Exception) {
    false
  }

  private fun runAudio() {
    Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
    val info = MediaCodec.BufferInfo()
    try {
      while (running) {
        val buf = ByteArray(CHUNK_BYTES)
        val n = record.read(buf, 0, CHUNK_BYTES)
        if (n < 0) {
          // ERROR_INVALID_OPERATION, ERROR_BAD_VALUE, ERROR_DEAD_OBJECT, ERROR: the microphone is gone.
          if (running) onFatal("mic")
          break
        }
        if (n == 0) continue
        lastAudioMs = SystemClock.elapsedRealtime()
        val pts = clock.next(n / 2, System.nanoTime() / 1000)
        lastAudioPtsUs = pts
        backlog.add(Chunk(if (n == CHUNK_BYTES) buf else buf.copyOf(n), pts))
        feedAudio()
        drainAudio(info, untilEos = false)
      }
    } catch (e: Exception) {
      if (running) onFatal("error")
    }
    try {
      record.stop()
    } catch (_: Exception) {
    }
    try {
      feedAudio()
      endAudio()
      drainAudio(info, untilEos = true)
    } catch (_: Exception) {
    }
  }

  private fun feedAudio() {
    while (true) {
      val c = backlog.peek() ?: return
      val i = audio.dequeueInputBuffer(0)
      if (i < 0) return
      audio.getInputBuffer(i)!!.apply { clear(); put(c.data) }
      audio.queueInputBuffer(i, 0, c.data.size, c.ptsUs, 0)
      backlog.poll()
    }
  }

  private fun endAudio() {
    repeat(50) {
      val i = audio.dequeueInputBuffer(10_000)
      if (i >= 0) {
        audio.queueInputBuffer(i, 0, 0, lastAudioPtsUs + CHUNK_MS * 1000, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
        return
      }
    }
  }

  private fun drainAudio(info: MediaCodec.BufferInfo, untilEos: Boolean) {
    var idle = 0
    while (true) {
      val i = audio.dequeueOutputBuffer(info, if (untilEos) 10_000 else 0)
      when {
        i == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!untilEos || ++idle > 200) return
        i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> gate.format(MuxGate.AUDIO, audio.outputFormat)
        i >= 0 -> {
          if (deliver(audio, i, info, MuxGate.AUDIO)) return
        }
      }
    }
  }

  private fun runVideo() {
    val info = MediaCodec.BufferInfo()
    var idleAfterStop = 0
    try {
      while (true) {
        val i = video.dequeueOutputBuffer(info, 10_000)
        when {
          i == MediaCodec.INFO_TRY_AGAIN_LATER -> if (!running && ++idleAfterStop > 200) return
          i == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> gate.format(MuxGate.VIDEO, video.outputFormat)
          i >= 0 -> if (deliver(video, i, info, MuxGate.VIDEO)) return
        }
      }
    } catch (e: Exception) {
      if (running) onFatal("error")
    }
  }

  /** Hands one encoded buffer to the gate; true at end of stream. */
  private fun deliver(codec: MediaCodec, index: Int, info: MediaCodec.BufferInfo, track: Int): Boolean {
    val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG == 0 && info.size > 0) {
      val out = codec.getOutputBuffer(index)!!
      val data = ByteArray(info.size)
      out.position(info.offset)
      out.get(data, 0, info.size)
      gate.sample(track, data, info.presentationTimeUs, info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM.inv())
    }
    codec.releaseOutputBuffer(index, false)
    return eos
  }

  /**
   * Ends both streams, waits for the encoders to drain and finalises the file. Call after the virtual
   * display is released. True if a playable file was written (both tracks started).
   */
  fun stop(): Boolean {
    running = false
    try {
      video.signalEndOfInputStream()
    } catch (_: Exception) {
    }
    audioThread?.join(JOIN_MS)
    videoThread?.join(JOIN_MS)
    for (release in listOf({ video.stop() }, { video.release() }, { audio.stop() }, { audio.release() }, { record.release() }, { inputSurface.release() })) {
      try {
        release()
      } catch (_: Exception) {
      }
    }
    callbacks.shutdown()
    val ok = try {
      if (gate.started && gate.written[MuxGate.AUDIO] > 0 && gate.written[MuxGate.VIDEO] > 0) {
        muxer.stop()
        true
      } else {
        false
      }
    } catch (_: Exception) {
      false
    }
    try {
      muxer.release()
    } catch (_: Exception) {
    }
    // One line of evidence per session (no content): how the audio path held up.
    Log.i(TAG, "stop ok=$ok audioGaps=${clock.gaps} audioLostMs=${clock.lostUs / 1000} backlogDropped=${backlog.dropped} " +
      "written audio=${gate.written[MuxGate.AUDIO]} video=${gate.written[MuxGate.VIDEO]} rejected=${gate.rejected} bytes=${gate.bytes}")
    return ok
  }

  companion object {
    const val SAMPLE_RATE = 44_100
    const val CHUNK_MS = 10L
    /** 10 ms of 16-bit mono. */
    const val CHUNK_BYTES = SAMPLE_RATE / 100 * 2
    private const val JOIN_MS = 3_000L
    private const val TAG = "PqaCapture"
  }
}
