import AVFoundation
import ReplayKit

/**
 * Pocket QA's Broadcast Upload Extension (docs/plans/native-screen-voice-recording.md, Design: iOS).
 * It records OTHER apps: the tester starts it from the system broadcast picker that Pocket QA
 * opens from their tap (preferredExtension = this extension, Microphone toggle shown).
 *
 *  - Video (H.264) plus the MICROPHONE only (`.audioMic`, AAC). App audio is ignored.
 *  - Streamed to disk with AVAssetWriter in `<App Group>/recordings/<uuid>.mp4`. Frames are never
 *    buffered in memory (an extension has a small memory ceiling).
 *  - On a finalised clip it measures the file's voice and video track lengths and writes
 *    `<uuid>.meta` (PendingStore and VoiceCheck, BroadcastShared.swift). The app lists it on return
 *    for local review; nothing is uploaded from here.
 *  - No network code and no camera.
 *  - A broadcast without a fresh Pocket QA session tag (for example one started from Control
 *    Centre) is refused, and so is one without microphone input (no silent video-only clips). In
 *    both cases nothing is kept.
 *  - Caps: 15 minutes or 500 MB (reason "limit"), as on Android.
 *
 * ReplayKit calls the lifecycle and sample methods serially, but the watchdog timer and the app's
 * discard notification arrive on other queues, so all state is guarded by `lock`.
 */
class SampleHandler: RPBroadcastSampleHandler {
  // Recursive: ending the broadcast can call back into broadcastFinished on the same thread.
  private let lock = NSRecursiveLock()
  private var store: PendingStore?
  private var state: BroadcastState?
  private var file: URL?
  private var tag = ""
  private var writer: AVAssetWriter?
  private var videoInput: AVAssetWriterInput?
  private var audioInput: AVAssetWriterInput?
  private var sessionStart: CMTime?
  private var lastVideoTime: CMTime?
  private var mic = MicWatch(startedAtMs: 0)
  private var startedAtMs: Int64 = 0
  private var lastBeatMs: Int64 = 0
  private var lastSizeCheckMs: Int64 = 0
  private var paused = false
  private var finished = false
  private var timer: DispatchSourceTimer?

  private static let maxEdge = 1920

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    lock.lock()
    defer { lock.unlock() }
    guard let group = BroadcastShared.appGroup(), let dir = BroadcastShared.recordingsDir(group: group), let defaults = UserDefaults(suiteName: group) else {
      refuseLocked("Pocket QA couldn't open its recording storage. Reinstall Pocket QA and try again.")
      return
    }
    let state = BroadcastState(defaults: defaults)
    self.state = state
    guard let tag = state.consumeTag() else {
      refuseLocked("Start screen broadcasts from a test session in Pocket QA (tap Start screen broadcast there).")
      return
    }
    let store = PendingStore(dir: dir)
    let file = store.newFile(tag: tag)
    self.store = store
    self.file = file
    self.tag = tag
    startedAtMs = BroadcastShared.nowMs()
    mic = MicWatch(startedAtMs: startedAtMs)
    state.begin(fileName: file.lastPathComponent, tag: tag)
    lastBeatMs = startedAtMs

    // The app asks for a discard when its session screen closes mid-broadcast.
    DarwinObserver.observe(BroadcastShared.discardNotification) { [weak self] in
      guard let self = self else { return }
      self.lock.lock()
      defer { self.lock.unlock() }
      self.finishLocked(reason: "user", keep: false, message: "Recording discarded: you left the Pocket QA test session.")
    }
    // Watchdog: the microphone check and the duration cap must run even when no buffers arrive.
    let t = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "com.reshareai.pocketqa.broadcast.watchdog"))
    t.schedule(deadline: .now() + .milliseconds(500), repeating: .milliseconds(500))
    t.setEventHandler { [weak self] in self?.watchdog() }
    t.resume()
    timer = t
  }

  override func broadcastPaused() {
    lock.lock()
    paused = true
    lock.unlock()
  }

  override func broadcastResumed() {
    lock.lock()
    paused = false
    mic.resumed(atMs: BroadcastShared.nowMs())
    lock.unlock()
  }

  /// The tester stopped it (red status pill or Control Centre): keep the clip for review.
  override func broadcastFinished() {
    lock.lock()
    defer { lock.unlock() }
    finishLocked(reason: "user", keep: true, message: nil)
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    lock.lock()
    defer { lock.unlock() }
    guard !finished, file != nil, CMSampleBufferDataIsReady(sampleBuffer) else { return }
    let now = BroadcastShared.nowMs()
    if now - lastSizeCheckMs >= 1000 {
      lastSizeCheckMs = now
      if let f = file, fileSize(f) >= BroadcastShared.maxBytes {
        finishLocked(reason: "limit", keep: true, message: "Pocket QA recording reached its size limit. Open Pocket QA to review your clip.")
        return
      }
    }
    let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    switch sampleBufferType {
    case .video:
      guard let pixels = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
      if writer == nil {
        guard startWriterLocked(pixels: pixels, at: pts) else {
          finishLocked(reason: "error", keep: false, message: "Pocket QA couldn't start recording. Nothing was saved.")
          return
        }
      }
      if let input = videoInput, input.isReadyForMoreMediaData, input.append(sampleBuffer) { lastVideoTime = pts }
    case .audioMic:
      mic.micBuffer(atMs: now, silent: Self.isSilent(sampleBuffer))
      if let start = sessionStart, CMTimeCompare(pts, start) >= 0, let input = audioInput, input.isReadyForMoreMediaData {
        input.append(sampleBuffer)
      }
    case .audioApp:
      // Never recorded: the clip carries only the tester's own narration.
      break
    @unknown default:
      break
    }
    if writer?.status == .failed {
      finishLocked(reason: "error", keep: false, message: "Pocket QA recording failed. Nothing was saved.")
    }
  }

  private func watchdog() {
    lock.lock()
    defer { lock.unlock() }
    guard !finished, file != nil else { return }
    let now = BroadcastShared.nowMs()
    // The heartbeat comes from this timer, not from buffers: none flow while paused, and the app
    // must never mistake a live (paused) recording for a truncated one and sweep it.
    if now - lastBeatMs >= 1000 {
      state?.heartbeat()
      lastBeatMs = now
    }
    guard !paused else { return }
    switch mic.verdict(nowMs: now) {
    case .noMicrophone:
      finishLocked(reason: "error", keep: false, message: "Turn on Microphone in the broadcast picker and start again: Pocket QA recordings need your narration. Nothing was saved.")
      return
    case .micLost:
      finishLocked(reason: "mic", keep: true, message: "Your microphone stopped, so Pocket QA ended the recording. Open Pocket QA to review the clip so far.")
      return
    case .ok:
      break
    }
    if now - startedAtMs >= BroadcastShared.maxDurationMs {
      finishLocked(reason: "limit", keep: true, message: "Pocket QA recording reached the 15-minute limit. Open Pocket QA to review your clip.")
    }
  }

  private func startWriterLocked(pixels: CVPixelBuffer, at pts: CMTime) -> Bool {
    guard let file = file, let w = try? AVAssetWriter(outputURL: file, fileType: .mp4) else { return false }
    let size = captureSize(width: CVPixelBufferGetWidth(pixels), height: CVPixelBufferGetHeight(pixels), maxEdge: Self.maxEdge)
    let video = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: size.width,
      AVVideoHeightKey: size.height,
      AVVideoScalingModeKey: AVVideoScalingModeResizeAspect,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 4_000_000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoMaxKeyFrameIntervalDurationKey: 2,
      ],
    ])
    video.expectsMediaDataInRealTime = true
    let audio = AVAssetWriterInput(mediaType: .audio, outputSettings: [
      AVFormatIDKey: kAudioFormatMPEG4AAC,
      AVSampleRateKey: 44_100,
      AVNumberOfChannelsKey: 1,
      AVEncoderBitRateKey: 128_000,
    ])
    audio.expectsMediaDataInRealTime = true
    guard w.canAdd(video), w.canAdd(audio) else { return false }
    w.add(video)
    w.add(audio)
    guard w.startWriting() else { return false }
    w.startSession(atSourceTime: pts)
    writer = w
    videoInput = video
    audioInput = audio
    sessionStart = pts
    return true
  }

  /// Ends the broadcast once. `keep` finalises the MP4 and publishes it to the app (meta written);
  /// otherwise the file is deleted. `message` ends the broadcast from here (the system shows it).
  private func finishLocked(reason: String, keep: Bool, message: String?) {
    guard !finished else { return }
    finished = true
    timer?.cancel()
    timer = nil
    DarwinObserver.remove(BroadcastShared.discardNotification)

    var kept = false
    if let w = writer, let file = file, let store = store {
      if keep, w.status == .writing, lastVideoTime != nil {
        videoInput?.markAsFinished()
        audioInput?.markAsFinished()
        // broadcastFinished must not return before the file is complete: the process may be torn down.
        let done = DispatchSemaphore(value: 0)
        w.finishWriting { done.signal() }
        _ = done.wait(timeout: .now() + 15)
        if w.status == .completed {
          let durationMs = Int64((CMTimeGetSeconds(CMTimeSubtract(lastVideoTime!, sessionStart!)) * 1000).rounded())
          // Measured from the finished file's own index (pqa-qa r1 P1): a clip whose voice doesn't
          // cover the video is still offered, marked incomplete; an unreadable file is dropped.
          if let voice = VoiceCheck.inspect(file) {
            kept = store.markComplete(file, durationMs: max(durationMs, 0), tag: tag, reason: reason, voice: voice)
          }
        }
      } else if w.status == .writing {
        w.cancelWriting()
      }
      if !kept { store.forget(file) }
    } else if let file = file {
      store?.forget(file)
    }
    // A clip that couldn't be finalised is reported as an error, never as a usable recording.
    state?.end(reason: kept || !keep ? reason : "error")
    BroadcastShared.post(BroadcastShared.finishedNotification)
    if let message = message { endBroadcast(message, code: 1) }
  }

  /// Refused before anything was recorded (no session tag, no storage).
  private func refuseLocked(_ message: String) {
    finished = true
    endBroadcast(message, code: 2)
  }

  /// Ends the broadcast from the extension (the system shows `message`), outside our lock.
  private func endBroadcast(_ message: String, code: Int) {
    let error = NSError(domain: "com.reshareai.pocketqa.broadcast", code: code, userInfo: [NSLocalizedDescriptionKey: message])
    DispatchQueue.main.async { self.finishBroadcastWithError(error) }
  }

  private func fileSize(_ url: URL) -> Int64 {
    ((try? FileManager.default.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.int64Value ?? 0
  }

  /// True when the buffer's samples are all exactly zero (no microphone input, see MicWatch).
  private static func isSilent(_ sampleBuffer: CMSampleBuffer) -> Bool {
    guard let block = CMSampleBufferGetDataBuffer(sampleBuffer) else { return true }
    var length = 0
    var pointer: UnsafeMutablePointer<CChar>?
    guard CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: &length, totalLengthOut: nil, dataPointerOut: &pointer) == kCMBlockBufferNoErr,
          let p = pointer, length > 0 else { return true }
    return MicWatch.isDigitalSilence(UnsafeRawBufferPointer(start: p, count: length))
  }
}
