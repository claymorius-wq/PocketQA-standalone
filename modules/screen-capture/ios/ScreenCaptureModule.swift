import ExpoModulesCore
import ReplayKit
import UIKit

final class BroadcastOnlyException: Exception, @unchecked Sendable {
  override var code: String { "ERR_UNSUPPORTED" }
  override var reason: String {
    "On iPhone, recordings run as a screen broadcast: start it with showBroadcastPicker, stop it from the red status indicator or Control Centre"
  }
}

final class NotConfiguredException: Exception, @unchecked Sendable {
  override var code: String { "ERR_NOT_CONFIGURED" }
  override var reason: String { "This build has no Pocket QA broadcast extension or App Group (run expo prebuild with withBroadcastExtension)" }
}

/**
 * iPhone side of the JS recorder contract (apps/mobile/src/evidence/recorder.ts;
 * docs/plans/native-screen-voice-recording.md, Design: iOS). Other apps are recorded by the
 * Broadcast Upload Extension (modules/screen-capture/ios-extension), NOT by RPScreenRecorder
 * (in-app only). This module:
 *  - showBroadcastPicker(tag): stores the session tag for the extension, then opens the SYSTEM
 *    broadcast picker for our extension from the tester's tap (Microphone toggle shown). The
 *    tester still has to tap Start Broadcast there; nothing records before that. With a live
 *    broadcast the same picker offers Stop; an empty tag never starts a recording;
 *  - takePendingAsync(tag): that session's finished clips, LISTED in place in the App Group
 *    container until JS deletes the file (after upload or discard), so a remount or a process
 *    restart loses nothing (pqa-qa r1 P2-A). Each carries its voice verdict (videoMs, voiceMs,
 *    voiceComplete), measured by the extension from the finished file (P1);
 *  - takeInterruptedAsync(tag): that session's recordings cut off mid-way (extension killed,
 *    truncated file swept), each counted once;
 *  - isRecording(): the extension's shared state (heartbeat-checked);
 *  - "onStopped" {reason, clip: null}: one per finished broadcast, from the extension's Darwin
 *    notification or, if that arrived while suspended, on becoming active. The clip itself always
 *    comes through takePendingAsync (JS lists on every stop and every return to the front), so it
 *    reaches the session whose tag it carries and nobody else;
 *  - stopAsync/startAsync reject: on iOS only the system stops a broadcast (status pill, Control
 *    Centre, or Stop in the picker);
 *  - discardAsync asks the extension to stop and delete; purgeAsync sweeps truncated and expired
 *    files (finished clips stay for their session); clearAllAsync (sign-out, account deletion)
 *    does both and deletes every clip and notice.
 */
public class ScreenCaptureModule: Module {
  private var lastStopSeq = 0
  private var picker: RPSystemBroadcastPickerView?
  private var activeObserver: NSObjectProtocol?

  private lazy var group: String? = BroadcastShared.appGroup()
  private lazy var state: BroadcastState? = group.flatMap { UserDefaults(suiteName: $0) }.map { BroadcastState(defaults: $0) }
  private lazy var recordings: URL? = group.flatMap { BroadcastShared.recordingsDir(group: $0) }
  private lazy var store: PendingStore? = recordings.map { PendingStore(dir: $0) }
  private var activeFile: URL? {
    guard let name = state?.activeFileName, let dir = recordings else { return nil }
    return dir.appendingPathComponent(name)
  }

  public func definition() -> ModuleDefinition {
    Name("PocketQaScreenCapture")
    Events("onStopped")

    OnCreate {
      // Stops from before this process started are not replayed as events; their clips stay listed.
      lastStopSeq = state?.currentStopSeq ?? 0
      store?.ensureDir()
      store?.sweep(active: activeFile)
      // The d0a857b candidate moved clips into Caches; nothing there is offered any more.
      try? FileManager.default.removeItem(at: FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("pocketqa-recordings"))
      DarwinObserver.observe(BroadcastShared.finishedNotification) { [weak self] in self?.reportStops() }
      activeObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
        self?.reportStops()
      }
    }

    OnDestroy {
      DarwinObserver.remove(BroadcastShared.finishedNotification)
      if let o = activeObserver { NotificationCenter.default.removeObserver(o) }
    }

    Function("isRecording") { () -> Bool in
      state?.isRecording ?? false
    }

    Function("showBroadcastPicker") { (tag: String) in
      guard let state = state, let extensionId = Bundle.main.object(forInfoDictionaryKey: "PocketQaBroadcastExtension") as? String else {
        throw NotConfiguredException()
      }
      state.requestTag(tag)
      DispatchQueue.main.async { [weak self] in self?.presentPicker(extensionId: extensionId) }
    }

    /// Finished clips of this session that JS hasn't deleted yet (uploaded or discarded).
    AsyncFunction("takePendingAsync") { (tag: String) -> [[String: Any]] in
      (store?.pending(tag: tag) ?? []).map { e in
        [
          "uri": e.file.absoluteString,
          "durationMs": e.durationMs,
          "sizeBytes": e.sizeBytes,
          "mimeType": "video/mp4",
          "videoMs": e.videoMs,
          "voiceMs": e.voiceMs,
          "voiceComplete": e.voiceComplete,
        ]
      }
    }

    /// Recordings of this session lost mid-way, each counted once. The extension can die while
    /// this app keeps running, so sweep first (a live broadcast's file is protected by its heartbeat).
    AsyncFunction("takeInterruptedAsync") { (tag: String) -> Int in
      store?.sweep(active: activeFile)
      return store?.takeInterrupted(tag: tag) ?? 0
    }

    AsyncFunction("startAsync") { (_: String) in
      throw BroadcastOnlyException()
    }

    AsyncFunction("stopAsync") { () -> [String: Any] in
      throw BroadcastOnlyException()
    }

    /// The session screen is closing mid-broadcast: ask the extension to stop and delete its file.
    AsyncFunction("discardAsync") { () in
      discardLive()
    }

    /// The session screen is gone: delete truncated files and expired clips (finished clips stay for their session).
    AsyncFunction("purgeAsync") { () in
      store?.sweep(active: activeFile)
    }

    /// Sign-out and account deletion: stop any broadcast, then delete every clip, notice and pending tag.
    AsyncFunction("clearAllAsync") { () in
      discardLive()
      state?.clearPendingTag()
      store?.clearAll(active: activeFile)
    }
  }

  /// Asks a live broadcast to stop and delete its file, waiting briefly for the extension to end.
  private func discardLive() {
    guard let state = state, state.isRecording else { return }
    BroadcastShared.post(BroadcastShared.discardNotification)
    let deadline = Date().addingTimeInterval(3)
    while state.isRecording, Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
  }

  private func reportStops() {
    guard let stop = state?.takeStop(after: lastStopSeq) else { return }
    lastStopSeq = stop.seq
    sendEvent("onStopped", ["reason": stop.reason, "clip": nil])
  }

  /// Opens the system picker from the tester's tap. RPSystemBroadcastPickerView is a button that
  /// shows the picker when tapped [Apple]; it has no "present" API, so the tap is forwarded to its
  /// button (the widely used approach; to be confirmed on a physical iPhone).
  private func presentPicker(extensionId: String) {
    picker?.removeFromSuperview()
    let view = RPSystemBroadcastPickerView(frame: CGRect(x: 0, y: 0, width: 44, height: 44))
    view.preferredExtension = extensionId
    view.showsMicrophoneButton = true
    view.alpha = 0.01
    view.isUserInteractionEnabled = false
    appContext?.utilities?.currentViewController()?.view.addSubview(view)
    picker = view
    for case let button as UIButton in view.subviews {
      button.sendActions(for: .allTouchEvents)
    }
  }
}
