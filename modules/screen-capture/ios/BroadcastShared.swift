import Foundation

// Shared by the app module (PocketQaScreenCapture) AND the Broadcast Upload Extension: the config
// plugin (apps/mobile/plugins/withBroadcastExtension.js) copies this exact file into the extension
// target, so both processes agree on file layout, state keys and notification names.
// Foundation only (no UIKit/ReplayKit): unit-tested on macOS by ios/Tests/main.swift.

enum BroadcastShared {
  /// Extension -> app: a broadcast ended (the reason is in BroadcastState). Darwin notifications carry no payload.
  static let finishedNotification = "com.reshareai.pocketqa.broadcast.finished"
  /// App -> extension: the session screen closed mid-broadcast; stop and delete the recording.
  static let discardNotification = "com.reshareai.pocketqa.broadcast.discard"
  /// Same caps as Android (ScreenCaptureService): 15 minutes or 500 MB, reason "limit".
  static let maxDurationMs: Int64 = 15 * 60 * 1000
  static let maxBytes: Int64 = 500 * 1024 * 1024

  /// The App Group is written into both Info.plists by the config plugin from app.json (one source).
  static func appGroup(_ bundle: Bundle = .main) -> String? {
    bundle.object(forInfoDictionaryKey: "PocketQaAppGroup") as? String
  }

  /// `<group container>/recordings`, where the extension writes and the app collects.
  static func recordingsDir(group: String) -> URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("recordings", isDirectory: true)
  }

  static func nowMs() -> Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

  static func post(_ name: String) {
    CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(), CFNotificationName(name as CFString), nil, nil, true)
  }
}

/// Cross-process Darwin notification observer. The C callback cannot capture context, so handlers
/// live in a static table keyed by name (one handler per name per process).
enum DarwinObserver {
  private static var handlers: [String: () -> Void] = [:]
  private static let lock = NSLock()

  static func observe(_ name: String, _ handler: @escaping () -> Void) {
    lock.lock()
    let first = handlers[name] == nil
    handlers[name] = handler
    lock.unlock()
    guard first else { return }
    CFNotificationCenterAddObserver(
      CFNotificationCenterGetDarwinNotifyCenter(), nil,
      { _, _, cfName, _, _ in
        guard let n = cfName?.rawValue as String? else { return }
        DarwinObserver.lock.lock()
        let h = DarwinObserver.handlers[n]
        DarwinObserver.lock.unlock()
        h?()
      },
      name as CFString, nil, .deliverImmediately)
  }

  static func remove(_ name: String) {
    lock.lock()
    handlers[name] = nil
    lock.unlock()
    CFNotificationCenterRemoveObserver(CFNotificationCenterGetDarwinNotifyCenter(), nil, CFNotificationName(name as CFString), nil)
  }
}

/**
 * The on-disk handoff between the extension and the app, the same contract as Android's
 * PendingStore.kt (docs/plans/native-screen-voice-recording.md):
 *  - a recording is `<uuid>.mp4` in the App Group container; when the extension FINALISES it
 *    (AVAssetWriter.finishWriting completed), it writes `<uuid>.meta` (JSON: durationMs, tag,
 *    reason, createdAt) by write-then-rename, so a crash never leaves a half-written meta;
 *  - the app claims its session's clips with take(tag:into:), which MOVES each video into the app's
 *    own cache directory and then deletes the meta: each clip is handed out once;
 *  - an MP4 without a meta is truncated (the extension was killed, e.g. by its memory limit) and is
 *    deleted by sweep, never offered or uploaded; finished clips nobody claims expire after ttlMs.
 */
final class PendingStore {
  struct Entry {
    let file: URL
    let durationMs: Int64
    let sizeBytes: Int64
    let tag: String
    let reason: String
    let createdAt: Int64
  }

  private struct Meta: Codable {
    let durationMs: Int64
    let tag: String
    let reason: String
    let createdAt: Int64
  }

  static let ttlMs: Int64 = 24 * 60 * 60 * 1000
  private let dir: URL
  private let now: () -> Int64
  private let fm = FileManager.default

  init(dir: URL, now: @escaping () -> Int64 = BroadcastShared.nowMs) {
    self.dir = dir
    self.now = now
  }

  func newFile() -> URL {
    try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir.appendingPathComponent("\(UUID().uuidString).mp4")
  }

  private func metaOf(_ video: URL) -> URL { video.deletingPathExtension().appendingPathExtension("meta") }
  private func videoOf(_ meta: URL) -> URL { meta.deletingPathExtension().appendingPathExtension("mp4") }
  private func size(_ url: URL) -> Int64 { ((try? fm.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.int64Value ?? 0 }

  /// Records a finished clip; an empty or missing file is deleted instead (nothing usable was captured).
  @discardableResult
  func markComplete(_ video: URL, durationMs: Int64, tag: String, reason: String) -> Bool {
    guard fm.fileExists(atPath: video.path), size(video) > 0 else {
      try? fm.removeItem(at: video)
      return false
    }
    guard let data = try? JSONEncoder().encode(Meta(durationMs: durationMs, tag: tag, reason: reason, createdAt: now())) else { return false }
    let meta = metaOf(video)
    let tmp = dir.appendingPathComponent(meta.lastPathComponent + ".tmp")
    do {
      try data.write(to: tmp)
      try? fm.removeItem(at: meta)
      try fm.moveItem(at: tmp, to: meta)
      return true
    } catch {
      try? fm.removeItem(at: tmp)
      return false
    }
  }

  private func read(_ meta: URL) -> Meta? {
    guard let data = try? Data(contentsOf: meta) else { return nil }
    return try? JSONDecoder().decode(Meta.self, from: data)
  }

  private func listing() -> [URL] {
    (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
  }

  /// This session's finished clips, moved into `dest` (the app's cache): each is returned once.
  func take(tag: String, into dest: URL) -> [Entry] {
    try? fm.createDirectory(at: dest, withIntermediateDirectories: true)
    var out: [Entry] = []
    for meta in listing() where meta.pathExtension == "meta" {
      guard let m = read(meta), m.tag == tag else { continue }
      let video = videoOf(meta)
      guard fm.fileExists(atPath: video.path), size(video) > 0 else {
        try? fm.removeItem(at: meta)
        try? fm.removeItem(at: video)
        continue
      }
      let target = dest.appendingPathComponent(video.lastPathComponent)
      // Move first, then drop the meta: if the move fails the clip stays claimable (or expires).
      guard (try? fm.moveItem(at: video, to: target)) != nil else { continue }
      try? fm.removeItem(at: meta)
      out.append(Entry(file: target, durationMs: m.durationMs, sizeBytes: size(target), tag: m.tag, reason: m.reason, createdAt: m.createdAt))
    }
    return out.sorted { $0.createdAt < $1.createdAt }
  }

  /// Deletes truncated videos (no meta, not `active`), unreadable or orphaned metas, expired clips and temp files.
  func sweep(active: URL?) {
    for f in listing() {
      switch f.pathExtension {
      case "mp4":
        if f.lastPathComponent != active?.lastPathComponent, read(metaOf(f)) == nil { try? fm.removeItem(at: f) }
      case "meta":
        let m = read(f)
        let video = videoOf(f)
        if m == nil || !fm.fileExists(atPath: video.path) || now() - m!.createdAt > Self.ttlMs {
          try? fm.removeItem(at: video)
          try? fm.removeItem(at: f)
        }
      case "tmp":
        try? fm.removeItem(at: f)
      default:
        break
      }
    }
  }

  /// Deletes one recording and its meta (a discarded or refused broadcast).
  func discard(_ video: URL) {
    try? fm.removeItem(at: video)
    try? fm.removeItem(at: metaOf(video))
  }
}

/**
 * Session state shared through the App Group's UserDefaults.
 *  - The app writes `pendingTag` (the participation id) right before it opens the picker from the
 *    tester's tap; the extension CONSUMES it at broadcastStarted and refuses a broadcast without a
 *    fresh one, so a broadcast started from Control Centre (no Pocket QA session) records nothing.
 *  - The extension marks the active file and beats a heartbeat while buffers flow; `isRecording`
 *    and sweep protection rely on it being fresh, so a killed extension never looks live.
 *  - Each end increments `stopSeq` with its reason, so the app reports each stop exactly once,
 *    even if the Darwin notification arrived while it was suspended.
 */
final class BroadcastState {
  static let tagTtlMs: Int64 = 5 * 60 * 1000
  static let heartbeatStaleMs: Int64 = 10 * 1000
  private enum Key {
    static let pendingTag = "pqa.pendingTag"
    static let pendingTagAt = "pqa.pendingTagAt"
    static let activeFile = "pqa.activeFile"
    static let activeTag = "pqa.activeTag"
    static let heartbeatAt = "pqa.heartbeatAt"
    static let stopSeq = "pqa.stopSeq"
    static let stopReason = "pqa.stopReason"
  }

  private let d: UserDefaults
  private let now: () -> Int64

  init(defaults: UserDefaults, now: @escaping () -> Int64 = BroadcastShared.nowMs) {
    d = defaults
    self.now = now
  }

  // App side

  func requestTag(_ tag: String) {
    d.set(tag, forKey: Key.pendingTag)
    d.set(NSNumber(value: now()), forKey: Key.pendingTagAt)
  }

  var isRecording: Bool { activeFileName != nil }

  /// The file the extension is writing, if its heartbeat is fresh (protected from the sweep).
  var activeFileName: String? {
    guard let f = d.string(forKey: Key.activeFile), let at = (d.object(forKey: Key.heartbeatAt) as? NSNumber)?.int64Value else { return nil }
    return now() - at <= Self.heartbeatStaleMs ? f : nil
  }

  var currentStopSeq: Int { d.integer(forKey: Key.stopSeq) }

  /// The latest stop if it is newer than `seq` (the last one this process reported).
  func takeStop(after seq: Int) -> (seq: Int, reason: String)? {
    let s = d.integer(forKey: Key.stopSeq)
    guard s > seq else { return nil }
    return (s, d.string(forKey: Key.stopReason) ?? "user")
  }

  // Extension side

  /// The tag the app set for this broadcast, if fresh; removed so it is never reused.
  func consumeTag() -> String? {
    defer {
      d.removeObject(forKey: Key.pendingTag)
      d.removeObject(forKey: Key.pendingTagAt)
    }
    guard let tag = d.string(forKey: Key.pendingTag), !tag.isEmpty,
          let at = (d.object(forKey: Key.pendingTagAt) as? NSNumber)?.int64Value,
          now() - at <= Self.tagTtlMs, now() >= at else { return nil }
    return tag
  }

  func begin(fileName: String, tag: String) {
    d.set(fileName, forKey: Key.activeFile)
    d.set(tag, forKey: Key.activeTag)
    heartbeat()
  }

  func heartbeat() { d.set(NSNumber(value: now()), forKey: Key.heartbeatAt) }

  func end(reason: String) {
    d.removeObject(forKey: Key.activeFile)
    d.removeObject(forKey: Key.activeTag)
    d.removeObject(forKey: Key.heartbeatAt)
    d.set(reason, forKey: Key.stopReason)
    d.set(d.integer(forKey: Key.stopSeq) + 1, forKey: Key.stopSeq)
  }
}

/**
 * No silent video-only clips (plan, Design: iOS 2). ReplayKit may deliver `.audioMic` buffers of
 * pure digital silence when the microphone isn't capturing [Apple, RPBroadcastSampleHandler], and
 * none at all when the picker's Microphone toggle is off. A real microphone always has a noise
 * floor, so "heard" means a buffer with any non-zero sample.
 *  - Nothing heard within startGraceMs of the start: the broadcast is refused (file deleted).
 *  - Heard, then nothing heard for lostAfterMs (a call took the microphone): it ends with reason
 *    "mic", keeping the clip so far, like Android's silenced-microphone stop.
 * The thresholds are design values; they need confirming on a physical iPhone.
 */
struct MicWatch {
  enum Verdict { case ok, noMicrophone, micLost }
  static let startGraceMs: Int64 = 3000
  static let lostAfterMs: Int64 = 5000

  let startedAtMs: Int64
  private(set) var lastHeardAtMs: Int64?

  init(startedAtMs: Int64) { self.startedAtMs = startedAtMs }

  mutating func micBuffer(atMs: Int64, silent: Bool) {
    // A refusal is final: input that only starts after the grace period doesn't revive the broadcast.
    if lastHeardAtMs == nil, atMs - startedAtMs > Self.startGraceMs { return }
    if !silent { lastHeardAtMs = atMs }
  }

  /// After broadcastPaused/Resumed no buffers flowed by design: restart the clock, keep the history.
  mutating func resumed(atMs: Int64) {
    if lastHeardAtMs != nil { lastHeardAtMs = atMs }
  }

  func verdict(nowMs: Int64) -> Verdict {
    guard let heard = lastHeardAtMs else { return nowMs - startedAtMs > Self.startGraceMs ? .noMicrophone : .ok }
    return nowMs - heard > Self.lostAfterMs ? .micLost : .ok
  }

  static func isDigitalSilence<S: Sequence>(_ bytes: S) -> Bool where S.Element == UInt8 {
    bytes.allSatisfy { $0 == 0 }
  }
}

/// The encoded size (same rule as Android CaptureMath): keep the aspect, cap the long edge, even dimensions.
func captureSize(width: Int, height: Int, maxEdge: Int) -> (width: Int, height: Int) {
  let long = max(width, height)
  guard long > maxEdge else { return (max(width / 2 * 2, 2), max(height / 2 * 2, 2)) }
  // The long edge becomes exactly maxEdge (no floating-point drift); the short edge scales with it.
  let short = Int(Double(min(width, height)) * Double(maxEdge) / Double(long))
  let (w, h) = width >= height ? (maxEdge, short) : (short, maxEdge)
  return (max(w / 2 * 2, 2), max(h / 2 * 2, 2))
}
