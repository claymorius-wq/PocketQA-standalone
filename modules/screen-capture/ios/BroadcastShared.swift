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
 * PendingStore.kt (docs/plans/native-screen-voice-recording.md; pqa-qa r1 P1, P2-A). In
 * `<App Group>/recordings`, per recording `<id>`:
 *  - `<id>.mp4`: written by the extension's AVAssetWriter;
 *  - `<id>.rec`: written at start with the session tag. It outlives the MP4's finalisation only
 *    when the extension died mid-recording (for example its memory limit);
 *  - `<id>.meta`: written when the extension FINALISES the clip (replacing `.rec`): duration, tag,
 *    stop reason, time and the voice verdict measured from the finished file (VoiceCheck);
 *  - `<id>.lost`: left by sweep for a recording that was cut off, so its session can say so once.
 * Every write is write-then-rename, so a crash never leaves a half-written file that is trusted.
 *
 * A finished clip stays LISTED for its session (pending) until its MP4 is deleted: JS deletes it
 * after uploading or discarding, or when the tester leaves the session in the foreground. So a
 * remount or a process restart loses nothing, and only the clip's own session sees it. JS reads and
 * deletes the file in place (expo-file-system scopes App Group directories as read/write).
 * Everything expires after ttlMs; clearAll runs on sign-out and account deletion. The directory is
 * excluded from device backups.
 */
final class PendingStore {
  struct Entry {
    let file: URL
    let durationMs: Int64
    let sizeBytes: Int64
    let tag: String
    let reason: String
    let createdAt: Int64
    let videoMs: Int64
    let voiceMs: Int64
    /// False unless the finished file was measured and its voice covers the video.
    let voiceComplete: Bool
    /// Audio lost inside the clip (gaps between microphone buffers), 0 when unknown.
    let voiceLostMs: Int64
  }

  private struct Meta: Codable {
    let durationMs: Int64
    let tag: String
    let reason: String
    let createdAt: Int64
    // Optional: a meta without them (unmeasured, or an older build) reads as NOT verified.
    let videoMs: Int64?
    let voiceMs: Int64?
    let voiceComplete: Bool?
    let voiceLostMs: Int64?
  }

  /// `.rec` (started) and `.lost` (cut off) notices.
  private struct Note: Codable {
    let tag: String
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

  /// Creates the directory if needed and (re)applies the backup exclusion (cheap; covers older installs).
  func ensureDir() {
    try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
    var d = dir
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? d.setResourceValues(values)
  }

  private func sibling(_ file: URL, _ ext: String) -> URL { dir.appendingPathComponent(id(file) + "." + ext) }
  private func id(_ file: URL) -> String { file.deletingPathExtension().lastPathComponent }
  private func size(_ url: URL) -> Int64 { ((try? fm.attributesOfItem(atPath: url.path))?[.size] as? NSNumber)?.int64Value ?? 0 }

  @discardableResult
  private func write<T: Encodable>(_ value: T, to target: URL) -> Bool {
    let tmp = dir.appendingPathComponent(target.lastPathComponent + ".tmp")
    do {
      try JSONEncoder().encode(value).write(to: tmp)
      try? fm.removeItem(at: target)
      try fm.moveItem(at: tmp, to: target)
      return true
    } catch {
      try? fm.removeItem(at: tmp)
      return false
    }
  }

  private func load<T: Decodable>(_ type: T.Type, _ url: URL) -> T? {
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(type, from: data)
  }

  private func listing() -> [URL] {
    (try? fm.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)) ?? []
  }

  /// A new recording of session `tag` (its `.rec` names the session if the extension dies).
  func newFile(tag: String) -> URL {
    ensureDir()
    let video = dir.appendingPathComponent("\(UUID().uuidString).mp4")
    write(Note(tag: tag, createdAt: now()), to: sibling(video, "rec"))
    return video
  }

  /// Records a finished clip; an empty or missing file is deleted instead (nothing usable was captured).
  @discardableResult
  func markComplete(_ video: URL, durationMs: Int64, tag: String, reason: String, voice: VoiceVerdict?) -> Bool {
    guard fm.fileExists(atPath: video.path), size(video) > 0 else {
      forget(video)
      return false
    }
    let meta = Meta(durationMs: durationMs, tag: tag, reason: reason, createdAt: now(),
                    videoMs: voice?.videoMs ?? durationMs, voiceMs: voice?.voiceMs ?? 0, voiceComplete: voice?.complete == true,
                    voiceLostMs: voice?.lostMs ?? 0)
    let ok = write(meta, to: sibling(video, "meta"))
    try? fm.removeItem(at: sibling(video, "rec"))
    return ok
  }

  private func entry(_ meta: URL) -> Entry? {
    guard let m = load(Meta.self, meta) else { return nil }
    let video = sibling(meta, "mp4")
    return Entry(file: video, durationMs: m.durationMs, sizeBytes: size(video), tag: m.tag, reason: m.reason, createdAt: m.createdAt,
                 videoMs: m.videoMs ?? 0, voiceMs: m.voiceMs ?? 0, voiceComplete: m.voiceComplete == true, voiceLostMs: m.voiceLostMs ?? 0)
  }

  /// The finished clips of this session whose files still exist (an empty tag matches nothing).
  func pending(tag: String) -> [Entry] {
    guard !tag.isEmpty else { return [] }
    return listing().filter { $0.pathExtension == "meta" }
      .compactMap(entry)
      .filter { $0.tag == tag && $0.sizeBytes > 0 }
      .sorted { $0.createdAt < $1.createdAt }
  }

  /// Deletes a clip and everything kept about it.
  func forget(_ video: URL) {
    for f in [video, sibling(video, "meta"), sibling(video, "rec"), sibling(video, "lost")] { try? fm.removeItem(at: f) }
  }

  /// How many recordings of this session were cut off (extension killed); each is reported once.
  func takeInterrupted(tag: String) -> Int {
    var n = 0
    for f in listing() where f.pathExtension == "lost" {
      if load(Note.self, f)?.tag == tag {
        try? fm.removeItem(at: f)
        n += 1
      }
    }
    return n
  }

  /**
   * Deletes truncated recordings (an MP4 with no meta that isn't `active`: the extension died while
   * writing it, so it is never offered or uploaded) and leaves their session a notice; drops stray
   * metas and temp files; expires everything older than ttlMs.
   */
  func sweep(active: URL?) {
    let activeId = active.map(id)
    for f in listing() {
      let ext = f.pathExtension
      if ext == "tmp" {
        try? fm.removeItem(at: f)
        continue
      }
      if id(f) == activeId { continue }
      switch ext {
      case "mp4":
        if load(Meta.self, sibling(f, "meta")) == nil {
          try? fm.removeItem(at: f)
          try? fm.removeItem(at: sibling(f, "meta"))
          let rec = sibling(f, "rec")
          if let note = load(Note.self, rec) { write(Note(tag: note.tag, createdAt: now()), to: sibling(f, "lost")) }
          try? fm.removeItem(at: rec)
        }
      case "rec":
        if !fm.fileExists(atPath: sibling(f, "mp4").path) { try? fm.removeItem(at: f) }
      case "meta":
        let m = load(Meta.self, f)
        if m == nil || !fm.fileExists(atPath: sibling(f, "mp4").path) || now() - m!.createdAt > Self.ttlMs {
          try? fm.removeItem(at: sibling(f, "mp4"))
          try? fm.removeItem(at: f)
        }
      case "lost":
        if let at = load(Note.self, f)?.createdAt, now() - at <= Self.ttlMs { continue }
        try? fm.removeItem(at: f)
      default:
        break
      }
    }
  }

  /// Sign-out and account deletion: every clip and notice goes, except the file being written.
  func clearAll(active: URL?) {
    let activeId = active.map(id)
    for f in listing() where id(f) != activeId { try? fm.removeItem(at: f) }
  }
}

/// The voice verdict measured from a finished file (persisted in the meta).
struct VoiceVerdict {
  let videoMs: Int64
  let voiceMs: Int64
  let complete: Bool
  /// Audio lost inside the clip (AudioGaps), already excluded from voiceMs.
  var lostMs: Int64 = 0
}

/**
 * Does a finished recording carry the tester's voice for its whole length? (pqa-qa r1 P1; the same
 * rule as Android VoiceCheck.kt). An encoder can keep writing video after the audio stalled, so each
 * finalised file is measured from its own index: the audio track must cover the video within
 * max(1 s, 2 %) at the edges (encoder start-up and tail), AND audio lost INSIDE the clip must stay
 * within maxLostMs in total with no single gap over maxGapMs, whatever the clip length (pqa-qa
 * pipeline r1 P2-C: 12 s missing mid-way through a 10-minute clip used to pass). A clip that fails is still offered for review, marked "voice incomplete", and JS
 * won't keep or upload it as narrated evidence.
 */
enum VoiceCheck {
  static let maxLostMs: Int64 = 1000
  static let maxGapMs: Int64 = 500

  static func covers(videoMs: Int64, audioMs: Int64?, lostMs: Int64 = 0, maxGapMs: Int64 = 0) -> Bool {
    guard let audioMs = audioMs, lostMs <= Self.maxLostMs, maxGapMs <= Self.maxGapMs else { return false }
    return videoMs - audioMs <= max(1000, videoMs * 2 / 100)
  }

  /// Nil when the file isn't a readable MP4 with a video track (a truncated file has no index).
  /// `lostMs`/`maxGapMs` come from AudioGaps: the track can span the clip with audio missing inside it.
  static func inspect(_ file: URL, lostMs: Int64 = 0, maxGapMs: Int64 = 0) -> VoiceVerdict? {
    guard let t = Mp4Tracks.read(file) else { return nil }
    let voice = t.audioMs.map { max(0, $0 - lostMs) } ?? 0
    return VoiceVerdict(videoMs: t.videoMs, voiceMs: voice, complete: covers(videoMs: t.videoMs, audioMs: t.audioMs, lostMs: lostMs, maxGapMs: maxGapMs), lostMs: lostMs)
  }
}

/**
 * Track durations from an MP4's own index (moov/trak: hdlr handler type; the tkhd presented duration
 * in the mvhd timescale, else mdhd), ported from Android's Mp4Tracks. Pure Foundation (no AVFoundation async loading in the
 * extension); only the moov box is read, capped well under the extension's memory ceiling.
 */
enum Mp4Tracks {
  struct Tracks: Equatable {
    let videoMs: Int64
    let audioMs: Int64?
  }

  private static let maxMoov: UInt64 = 16 * 1024 * 1024

  static func read(_ file: URL) -> Tracks? {
    guard let h = try? FileHandle(forReadingFrom: file) else { return nil }
    defer { try? h.close() }
    guard let moov = moov(h) else { return nil }
    return tracks(moov)
  }

  private static func be32(_ d: Data, _ at: Int) -> UInt64 {
    d[d.startIndex + at ..< d.startIndex + at + 4].reduce(0) { $0 << 8 | UInt64($1) }
  }

  private static func be64(_ d: Data, _ at: Int) -> UInt64 {
    d[d.startIndex + at ..< d.startIndex + at + 8].reduce(0) { $0 << 8 | UInt64($1) }
  }

  private static func type(_ d: Data, _ at: Int) -> String {
    String(decoding: d[d.startIndex + at ..< d.startIndex + at + 4], as: UTF8.self)
  }

  private static func moov(_ h: FileHandle) -> Data? {
    guard let len = try? h.seekToEnd() else { return nil }
    var pos: UInt64 = 0
    while pos + 8 <= len {
      guard (try? h.seek(toOffset: pos)) != nil, let head = try? h.read(upToCount: 16), head.count >= 8 else { return nil }
      var size = be32(head, 0)
      let t = type(head, 4)
      var header: UInt64 = 8
      if size == 1 {
        guard head.count >= 16 else { return nil }
        size = be64(head, 8)
        header = 16
      } else if size == 0 {
        size = len - pos
      }
      if size < header || pos + size > len { return nil }
      if t == "moov" {
        let body = size - header
        guard body <= maxMoov, (try? h.seek(toOffset: pos + header)) != nil, let data = try? h.read(upToCount: Int(body)), data.count == Int(body) else { return nil }
        return data
      }
      pos += size
    }
    return nil
  }

  /// Child boxes of `d` as (type, payload) pairs.
  private static func children(_ d: Data) -> [(String, Data)] {
    var out: [(String, Data)] = []
    var at = 0
    while d.count - at >= 8 {
      var size = Int(be32(d, at))
      let t = type(d, at + 4)
      var header = 8
      if size == 1 {
        guard d.count - at >= 16 else { break }
        size = Int(be64(d, at + 8))
        header = 16
      } else if size == 0 {
        size = d.count - at
      }
      if size < header || at + size > d.count { break }
      out.append((t, d.subdata(in: d.startIndex + at + header ..< d.startIndex + at + size)))
      at += size
    }
    return out
  }

  private static func tracks(_ moov: Data) -> Tracks? {
    let boxes = children(moov)
    let movieTimescale = boxes.first(where: { $0.0 == "mvhd" }).flatMap { timescale(mvhd: $0.1) }
    var video: Int64?
    var audio: Int64?
    for (t, trak) in boxes where t == "trak" {
      let parts = children(trak)
      guard let mdia = parts.first(where: { $0.0 == "mdia" })?.1 else { continue }
      let media = children(mdia)
      guard let hdlr = media.first(where: { $0.0 == "hdlr" })?.1, hdlr.count >= 12 else { continue }
      // The PRESENTED length (tkhd, movie timescale) honours edit lists: AVAssetWriter trims AAC
      // priming and the last frame's tail that way (mdhd reads 6.2 s video / 6.023 s audio for a
      // 6.0 s clip). Without a usable tkhd, the media duration (mdhd) is used.
      let presented = parts.first(where: { $0.0 == "tkhd" }).flatMap { tkhd in movieTimescale.flatMap { durationMs(tkhd: tkhd.1, timescale: $0) } }
      guard let ms = presented ?? media.first(where: { $0.0 == "mdhd" }).flatMap({ durationMs($0.1) }) else { continue }
      switch type(hdlr, 8) {
      case "vide": video = max(video ?? 0, ms)
      case "soun": audio = max(audio ?? 0, ms)
      default: break
      }
    }
    return video.map { Tracks(videoMs: $0, audioMs: audio) }
  }

  private static func timescale(mvhd: Data) -> UInt64? {
    guard let version = mvhd.first else { return nil }
    let at = version == 1 ? 20 : 12
    guard mvhd.count >= at + 4 else { return nil }
    let ts = be32(mvhd, at)
    return ts > 0 ? ts : nil
  }

  private static func durationMs(tkhd: Data, timescale: UInt64) -> Int64? {
    guard let version = tkhd.first else { return nil }
    let duration: UInt64
    if version == 1 {
      guard tkhd.count >= 36 else { return nil }
      duration = be64(tkhd, 28)
    } else {
      guard tkhd.count >= 24 else { return nil }
      duration = be32(tkhd, 20)
    }
    // 0 (fragmented files) and all-ones ("unknown") are not usable lengths.
    guard duration > 0, duration != UInt64(UInt32.max), duration != UInt64.max, duration < UInt64(Int64.max) / 1000 else { return nil }
    return Int64(duration * 1000 / timescale)
  }

  private static func durationMs(_ mdhd: Data) -> Int64? {
    guard mdhd.count >= 4 else { return nil }
    let version = mdhd[mdhd.startIndex]
    let (timescale, duration): (UInt64, UInt64)
    if version == 1 {
      guard mdhd.count >= 32 else { return nil }
      (timescale, duration) = (be32(mdhd, 20), be64(mdhd, 24))
    } else {
      guard mdhd.count >= 20 else { return nil }
      (timescale, duration) = (be32(mdhd, 12), be32(mdhd, 16))
    }
    guard timescale > 0, duration < UInt64(Int64.max) / 1000 else { return nil }
    return Int64(duration * 1000 / timescale)
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

  /// Sign-out: a tag the previous user set for a broadcast never started must not carry over.
  func clearPendingTag() {
    d.removeObject(forKey: Key.pendingTag)
    d.removeObject(forKey: Key.pendingTagAt)
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

/**
 * Microphone audio lost INSIDE the clip, from the timestamps of the `.audioMic` buffers actually
 * appended to the file (the iOS counterpart of Android's AudioClock; pqa-qa pipeline r1 P2-C).
 * ReplayKit can drop buffers when the extension falls behind, and the writer skips buffers when its
 * input isn't ready: either way the file's audio track still spans the clip, with a hole in it.
 * A buffer starting later than the previous one ended by more than its own length (floor 50 ms) is
 * a gap; smaller offsets are timestamp jitter, compared buffer to buffer so they never accumulate.
 * A pause the tester chose (broadcastPaused/Resumed) is not lost voice.
 */
struct AudioGaps {
  static let minGapMs = 50.0
  private var lastEndMs: Double?
  private(set) var lostMs: Int64 = 0
  private(set) var maxGapMs: Int64 = 0

  mutating func appended(ptsMs: Double, durationMs: Double) {
    if let end = lastEndMs {
      let gap = ptsMs - end
      if gap > max(durationMs, Self.minGapMs) {
        let ms = Int64(gap.rounded())
        lostMs += ms
        maxGapMs = max(maxGapMs, ms)
      }
    }
    lastEndMs = max(lastEndMs ?? -.infinity, ptsMs + durationMs)
  }

  mutating func resumed() { lastEndMs = nil }
}
