// Unit tests for BroadcastShared.swift (Foundation only, so they run on macOS without a simulator):
//   swiftc -o /tmp/pqa-broadcast-tests modules/screen-capture/ios/BroadcastShared.swift modules/screen-capture/ios/Tests/main.swift && /tmp/pqa-broadcast-tests
// Mirrors the Android PendingStoreTest (same on-disk handoff contract).
import Foundation

var failures = 0
var ran = 0
func check(_ cond: @autoclosure () -> Bool, _ msg: String, line: Int = #line) {
  if !cond() { failures += 1; print("  FAIL line \(line): \(msg)") }
}
func test(_ name: String, _ body: () throws -> Void) {
  ran += 1
  do { try body() } catch { failures += 1; print("  FAIL \(name): threw \(error)") }
  print("\(failures == 0 ? "ok" : "..") \(name)")
}

let fm = FileManager.default
func tempDir() -> URL {
  let d = fm.temporaryDirectory.appendingPathComponent("pqa-\(UUID().uuidString)")
  try! fm.createDirectory(at: d, withIntermediateDirectories: true)
  return d
}
var clock: Int64 = 1_000_000
func store(_ dir: URL) -> PendingStore { PendingStore(dir: dir, now: { clock }) }
func recorded(_ s: PendingStore, bytes: Int = 10) -> URL {
  let f = s.newFile()
  try! Data(count: bytes).write(to: f)
  return f
}
func exists(_ u: URL) -> Bool { fm.fileExists(atPath: u.path) }

// MARK: PendingStore

test("a finished clip is moved to the app's cache, handed out once, then owned by JS") {
  clock = 1_000_000
  let dir = tempDir(), cache = tempDir()
  let s = store(dir)
  let f = recorded(s)
  check(s.markComplete(f, durationMs: 7000, tag: "p1", reason: "user"), "marked")
  let taken = s.take(tag: "p1", into: cache)
  check(taken.count == 1, "one clip")
  check(taken.first?.durationMs == 7000, "duration")
  check(taken.first?.reason == "user", "reason")
  check(taken.first?.sizeBytes == 10, "size")
  check(taken.first?.file.deletingLastPathComponent().standardizedFileURL == cache.standardizedFileURL, "moved into cache")
  check(exists(taken.first!.file), "file in cache")
  check(!exists(f), "gone from the group container")
  check(s.take(tag: "p1", into: cache).isEmpty, "never handed out twice")
}

test("another session never sees the clip") {
  let dir = tempDir(), cache = tempDir()
  let s = store(dir)
  _ = s.markComplete(recorded(s), durationMs: 1000, tag: "p1", reason: "user")
  check(s.take(tag: "p2", into: cache).isEmpty, "p2 sees nothing")
  check(s.take(tag: "p1", into: cache).count == 1, "p1 gets it")
}

test("a truncated file (extension killed mid-broadcast) is swept, the active one kept") {
  let dir = tempDir(), cache = tempDir()
  let s = store(dir)
  let truncated = recorded(s), active = recorded(s), done = recorded(s)
  _ = s.markComplete(done, durationMs: 1000, tag: "p1", reason: "user")
  s.sweep(active: active)
  check(!exists(truncated), "truncated deleted")
  check(exists(active), "active kept")
  check(exists(done), "finished kept")
  check(s.take(tag: "p1", into: cache).count == 1, "finished still claimable")
}

test("an empty recording is never offered") {
  let dir = tempDir(), cache = tempDir()
  let s = store(dir)
  let empty = recorded(s, bytes: 0)
  check(!s.markComplete(empty, durationMs: 0, tag: "p1", reason: "user"), "refused")
  check(!exists(empty), "deleted")
  check(s.take(tag: "p1", into: cache).isEmpty, "nothing offered")
}

test("unclaimed clips expire after a day") {
  clock = 1_000_000
  let dir = tempDir(), cache = tempDir()
  let s = store(dir)
  let f = recorded(s)
  _ = s.markComplete(f, durationMs: 1000, tag: "p1", reason: "user")
  clock += PendingStore.ttlMs + 1
  s.sweep(active: nil)
  check(!exists(f), "expired file deleted")
  check(s.take(tag: "p1", into: cache).isEmpty, "nothing offered")
  clock = 1_000_000
}

test("a meta whose video is gone is dropped; stray temp files are swept") {
  let dir = tempDir(), cache = tempDir()
  let s = store(dir)
  let f = recorded(s)
  _ = s.markComplete(f, durationMs: 1000, tag: "p1", reason: "user")
  try fm.removeItem(at: f)
  try Data("x".utf8).write(to: dir.appendingPathComponent("abc.meta.tmp"))
  check(s.take(tag: "p1", into: cache).isEmpty, "nothing offered")
  s.sweep(active: nil)
  check(((try? fm.contentsOfDirectory(atPath: dir.path)) ?? ["?"]).isEmpty, "directory empty")
}

test("a corrupt meta is ignored and swept, never crashes") {
  let dir = tempDir(), cache = tempDir()
  let s = store(dir)
  let f = recorded(s)
  try Data("not json".utf8).write(to: f.deletingPathExtension().appendingPathExtension("meta"))
  check(s.take(tag: "p1", into: cache).isEmpty, "nothing offered")
  s.sweep(active: nil)
  check(!exists(f), "video without a valid meta deleted")
}

test("discard deletes a clip and its meta") {
  let dir = tempDir()
  let s = store(dir)
  let f = recorded(s)
  _ = s.markComplete(f, durationMs: 1000, tag: "p1", reason: "user")
  s.discard(f)
  check(((try? fm.contentsOfDirectory(atPath: dir.path)) ?? ["?"]).isEmpty, "both gone")
}

// MARK: BroadcastState (App Group UserDefaults shared by app and extension)

func freshDefaults() -> UserDefaults {
  let name = "pqa-test-\(UUID().uuidString)"
  return UserDefaults(suiteName: name)!
}

test("the extension accepts only a tag the app set moments ago, and only once (no Control Centre starts)") {
  clock = 1_000_000
  let st = BroadcastState(defaults: freshDefaults(), now: { clock })
  check(st.consumeTag() == nil, "no tag: refuse")
  st.requestTag("p1")
  clock += 1000
  check(st.consumeTag() == "p1", "fresh tag accepted")
  check(st.consumeTag() == nil, "consumed")
  st.requestTag("p2")
  clock += BroadcastState.tagTtlMs + 1
  check(st.consumeTag() == nil, "stale tag refused")
}

test("isRecording follows the extension's heartbeat, so a killed extension does not look live") {
  clock = 1_000_000
  let st = BroadcastState(defaults: freshDefaults(), now: { clock })
  check(!st.isRecording, "idle")
  st.begin(fileName: "a.mp4", tag: "p1")
  check(st.isRecording, "recording")
  check(st.activeFileName == "a.mp4", "active file")
  clock += BroadcastState.heartbeatStaleMs - 1
  check(st.isRecording, "still fresh")
  st.heartbeat()
  clock += BroadcastState.heartbeatStaleMs + 1
  check(!st.isRecording, "stale heartbeat: not recording")
  check(st.activeFileName == nil, "stale active file is not protected from the sweep")
}

test("each stop is reported once, with its reason") {
  clock = 1_000_000
  let st = BroadcastState(defaults: freshDefaults(), now: { clock })
  check(st.takeStop(after: 0) == nil, "nothing yet")
  st.begin(fileName: "a.mp4", tag: "p1")
  st.end(reason: "limit")
  check(!st.isRecording, "ended")
  let first = st.takeStop(after: 0)
  check(first?.reason == "limit", "reason")
  check(st.takeStop(after: first!.seq) == nil, "seen once")
  st.end(reason: "user")
  check(st.takeStop(after: first!.seq)?.reason == "user", "next stop")
}

// MARK: MicWatch (no silent video-only clips)

test("no microphone buffers in the first 3 s: refuse (Microphone off in the picker)") {
  var w = MicWatch(startedAtMs: 0)
  check(w.verdict(nowMs: 2900) == .ok, "grace period")
  check(w.verdict(nowMs: 3001) == .noMicrophone, "refused")
  w.micBuffer(atMs: 3100, silent: false)
  check(w.verdict(nowMs: 3200) == .noMicrophone, "a late buffer does not undo the refusal")
}

test("only digital silence in the first 3 s also counts as no microphone") {
  var w = MicWatch(startedAtMs: 0)
  for t in stride(from: 100, through: 3000, by: 100) { w.micBuffer(atMs: Int64(t), silent: true) }
  check(w.verdict(nowMs: 3001) == .noMicrophone, "silence only")
}

test("narration heard: ok; then the microphone goes away mid-session: mic lost") {
  var w = MicWatch(startedAtMs: 0)
  w.micBuffer(atMs: 500, silent: false)
  check(w.verdict(nowMs: 3001) == .ok, "heard")
  w.micBuffer(atMs: 4000, silent: true)
  check(w.verdict(nowMs: 5000) == .ok, "brief digital silence is fine")
  check(w.verdict(nowMs: 500 + MicWatch.lostAfterMs + 1) == .micLost, "no real input for too long")
}

test("a pause (broadcastPaused) does not count as a lost microphone after resuming") {
  var w = MicWatch(startedAtMs: 0)
  w.micBuffer(atMs: 500, silent: false)
  w.resumed(atMs: 60_000)
  check(w.verdict(nowMs: 61_000) == .ok, "grace restarts at resume")
  check(w.verdict(nowMs: 60_000 + MicWatch.lostAfterMs + 1) == .micLost, "but still needs narration")
  var never = MicWatch(startedAtMs: 0)
  never.resumed(atMs: 1000)
  check(never.verdict(nowMs: 1000 + MicWatch.startGraceMs + 1) == .noMicrophone, "never heard: still refused")
}

// MARK: capture size (same rule as Android CaptureMath)

test("capture size keeps the aspect, caps the long edge and uses even dimensions") {
  let a = captureSize(width: 1179, height: 2556, maxEdge: 1920)
  check(a.height == 1920 && a.width == 884, "scaled portrait: \(a)")
  let b = captureSize(width: 750, height: 1334, maxEdge: 1920)
  check(b.width == 750 && b.height == 1334, "small screens untouched: \(b)")
  let c = captureSize(width: 1, height: 1, maxEdge: 1920)
  check(c.width == 2 && c.height == 2, "never below 2: \(c)")
}

test("digital silence detection") {
  check(MicWatch.isDigitalSilence([UInt8](repeating: 0, count: 64)), "zeros")
  var b = [UInt8](repeating: 0, count: 64); b[63] = 1
  check(!MicWatch.isDigitalSilence(b), "any non-zero sample")
  check(MicWatch.isDigitalSilence([]), "empty")
}

print("\(ran) tests, \(failures) failures")
exit(failures == 0 ? 0 : 1)
