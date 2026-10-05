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
 *    tester still has to tap Start Broadcast there; nothing records before that;
 *  - takePendingAsync(tag): moves that session's finished clips from the App Group container into
 *    this app's cache, each handed out once;
 *  - isRecording(): the extension's shared state (heartbeat-checked);
 *  - "onStopped" {reason, clip: null}: one per finished broadcast, from the extension's Darwin
 *    notification or, if that arrived while suspended, on becoming active. The clip itself always
 *    comes through takePendingAsync (JS claims on every stop and on every return to the front),
 *    so it reaches the session whose tag it carries and nobody else;
 *  - stopAsync/startAsync reject: on iOS only the system stops a broadcast (status pill, Control Centre);
 *  - discardAsync asks the extension to stop and delete; purgeAsync deletes truncated, orphaned and
 *    handed-out files.
 */
public class ScreenCaptureModule: Module {
  private var lastStopSeq = 0
  private var picker: RPSystemBroadcastPickerView?
  private var activeObserver: NSObjectProtocol?

  private lazy var group: String? = BroadcastShared.appGroup()
  private lazy var state: BroadcastState? = group.flatMap { UserDefaults(suiteName: $0) }.map { BroadcastState(defaults: $0) }
  private lazy var store: PendingStore? = group.flatMap { BroadcastShared.recordingsDir(group: $0) }.map { PendingStore(dir: $0) }
  /// Handed-out clips live here until JS uploads or deletes them.
  private var handoffDir: URL {
    FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("pocketqa-recordings", isDirectory: true)
  }
  private var activeFile: URL? {
    guard let name = state?.activeFileName, let dir = group.flatMap({ BroadcastShared.recordingsDir(group: $0) }) else { return nil }
    return dir.appendingPathComponent(name)
  }

  public func definition() -> ModuleDefinition {
    Name("PocketQaScreenCapture")
    Events("onStopped")

    OnCreate {
      // Stops from before this process started are not replayed as events; their clips are still claimable.
      lastStopSeq = state?.currentStopSeq ?? 0
      store?.sweep(active: activeFile)
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

    AsyncFunction("takePendingAsync") { (tag: String) -> [[String: Any]] in
      (store?.take(tag: tag, into: handoffDir) ?? []).map { e in
        ["uri": e.file.absoluteString, "durationMs": e.durationMs, "sizeBytes": e.sizeBytes, "mimeType": "video/mp4"]
      }
    }

    AsyncFunction("startAsync") { (_: String) in
      throw BroadcastOnlyException()
    }

    AsyncFunction("stopAsync") { () -> [String: Any] in
      throw BroadcastOnlyException()
    }

    /// The session screen is closing mid-broadcast: ask the extension to stop and delete its file.
    AsyncFunction("discardAsync") { () in
      guard let state = state, state.isRecording else { return }
      BroadcastShared.post(BroadcastShared.discardNotification)
      // Wait briefly for the extension to end (it deletes the file itself); the sweep covers the rest.
      let deadline = Date().addingTimeInterval(3)
      while state.isRecording, Date() < deadline { Thread.sleep(forTimeInterval: 0.1) }
    }

    /// The session screen is gone: delete truncated/orphaned files and every handed-out copy.
    AsyncFunction("purgeAsync") { () in
      store?.sweep(active: activeFile)
      try? FileManager.default.removeItem(at: handoffDir)
    }
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
