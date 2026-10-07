// Unit tests for BroadcastShared.swift (Foundation only, so they run on macOS without a simulator;
// AVFoundation is used here only as the reference for the MP4 box parser):
//   swiftc -o /tmp/pqa-broadcast-tests modules/screen-capture/ios/BroadcastShared.swift modules/screen-capture/ios/Tests/main.swift && /tmp/pqa-broadcast-tests
// Mirrors the Android PendingStoreTest and VoiceCheckTest (same on-disk handoff and voice rule);
// Tests/voice/*.mp4 are the lead's synthetic ffmpeg fixtures plus Apple-muxed copies (avconvert
// --preset PresetPassthrough), since the extension's files come from AVAssetWriter.
import AVFoundation
import Foundation

/// Reference durations from AVFoundation (macOS), to cross-check the box parser.
func avDurations(_ url: URL) -> (video: Int64, audio: Int64) {
  let asset = AVURLAsset(url: url)
  let done = DispatchSemaphore(value: 0)
  var out: (Int64, Int64) = (0, 0)
  Task {
    let ms = { (t: [AVAssetTrack]) async -> Int64 in
      guard let r = try? await t.first?.load(.timeRange) else { return 0 }
      return Int64((CMTimeGetSeconds(r.duration) * 1000).rounded())
    }
    out = (await ms((try? await asset.loadTracks(withMediaType: .video)) ?? []), await ms((try? await asset.loadTracks(withMediaType: .audio)) ?? []))
    done.signal()
  }
  done.wait()
  return out
}

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
let FULL = VoiceVerdict(videoMs: 7000, voiceMs: 6900, complete: true)
func store(_ dir: URL) -> PendingStore { PendingStore(dir: dir, now: { clock }) }
func recorded(_ s: PendingStore, bytes: Int = 10, tag: String = "p1") -> URL {
  let f = s.newFile(tag: tag)
  try! Data(count: bytes).write(to: f)
  return f
}
func exists(_ u: URL) -> Bool { fm.fileExists(atPath: u.path) }
func names(_ dir: URL) -> [String] { ((try? fm.contentsOfDirectory(atPath: dir.path)) ?? []).sorted() }

// MARK: PendingStore (mirrors the Android PendingStoreTest, pqa-qa r1 P2-A)

test("a finished clip stays listed for its session until JS deletes the file") {
  clock = 1_000_000
  let dir = tempDir()
  let s = store(dir)
  let f = recorded(s)
  check(s.markComplete(f, durationMs: 7000, tag: "p1", reason: "user", voice: FULL), "marked")
  let listed = s.pending(tag: "p1")
  check(listed.count == 1, "one clip")
  check(listed.first?.file.standardizedFileURL == f.standardizedFileURL, "the file itself, in place")
  check(listed.first?.durationMs == 7000, "duration")
  check(listed.first?.reason == "user", "reason")
  check(listed.first?.sizeBytes == 10, "size")
  // Still listed after a remount or a process restart: nothing is lost until JS deletes the file.
  check(s.pending(tag: "p1").count == 1, "still listed")
  try fm.removeItem(at: f)
  check(s.pending(tag: "p1").isEmpty, "gone once JS deleted it")
}

test("the voice verdict travels with the clip") {
  let dir = tempDir()
  let s = store(dir)
  let ok = recorded(s), cut = recorded(s)
  s.markComplete(ok, durationMs: 7000, tag: "p1", reason: "user", voice: FULL)
  s.markComplete(cut, durationMs: 391_700, tag: "p1", reason: "user", voice: VoiceVerdict(videoMs: 391_720, voiceMs: 202_687, complete: false, lostMs: 1_500))
  let by = Dictionary(uniqueKeysWithValues: s.pending(tag: "p1").map { ($0.file.lastPathComponent, $0) })
  check(by[ok.lastPathComponent]?.voiceComplete == true, "complete")
  check(by[cut.lastPathComponent]?.voiceComplete == false, "incomplete")
  check(by[cut.lastPathComponent]?.voiceMs == 202_687, "voiceMs")
  check(by[cut.lastPathComponent]?.videoMs == 391_720, "videoMs")
  check(by[cut.lastPathComponent]?.voiceLostMs == 1_500, "voiceLostMs persisted")
  check(by[ok.lastPathComponent]?.voiceLostMs == 0, "nothing lost")
}

test("an unmeasured clip is never treated as narrated (missing fields => false)") {
  let dir = tempDir()
  let s = store(dir)
  let f = recorded(s)
  s.markComplete(f, durationMs: 7000, tag: "p1", reason: "user", voice: nil)
  check(s.pending(tag: "p1").first?.voiceComplete == false, "unmeasured")
  check(s.pending(tag: "p1").first?.voiceMs == 0, "no voice")
  // A meta from the d0a857b format (no voice fields) also reads as not verified.
  let g = recorded(s)
  try Data(#"{"durationMs":1000,"tag":"p1","reason":"user","createdAt":1000000}"#.utf8).write(to: g.deletingPathExtension().appendingPathExtension("meta"))
  check(s.pending(tag: "p1").first { $0.file.lastPathComponent == g.lastPathComponent }?.voiceComplete == false, "old meta")
  check(s.pending(tag: "p1").first { $0.file.lastPathComponent == g.lastPathComponent }?.voiceLostMs == 0, "old meta: voiceLostMs 0")
}

test("another session never sees the clip; an empty tag lists nothing") {
  let dir = tempDir()
  let s = store(dir)
  s.markComplete(recorded(s), durationMs: 1000, tag: "p1", reason: "user", voice: FULL)
  check(s.pending(tag: "p2").isEmpty, "p2 sees nothing")
  check(s.pending(tag: "").isEmpty, "empty tag")
  check(s.pending(tag: "p1").count == 1, "p1 gets it")
}

test("forget deletes the clip and everything kept about it") {
  let dir = tempDir()
  let s = store(dir)
  let f = recorded(s)
  s.markComplete(f, durationMs: 1000, tag: "p1", reason: "user", voice: FULL)
  s.forget(f)
  check(names(dir).isEmpty, "directory empty: \(names(dir))")
}

test("a truncated file (extension killed mid-broadcast) is swept and its session is told once") {
  let dir = tempDir()
  let s = store(dir)
  let truncated = recorded(s), active = recorded(s), done = recorded(s)
  s.markComplete(done, durationMs: 1000, tag: "p1", reason: "user", voice: FULL)
  s.sweep(active: active)
  check(!exists(truncated), "truncated deleted")
  check(exists(active), "active kept")
  check(exists(done), "finished kept")
  check(s.pending(tag: "p1").count == 1, "finished still listed")
  check(s.takeInterrupted(tag: "p2") == 0, "other session")
  check(s.takeInterrupted(tag: "p1") == 1, "told")
  check(s.takeInterrupted(tag: "p1") == 0, "once")
}

test("an empty recording is never offered") {
  let dir = tempDir()
  let s = store(dir)
  let empty = recorded(s, bytes: 0)
  check(!s.markComplete(empty, durationMs: 0, tag: "p1", reason: "user", voice: FULL), "refused")
  check(!exists(empty), "deleted")
  check(s.pending(tag: "p1").isEmpty, "nothing offered")
  check(names(dir).isEmpty, "no leftovers: \(names(dir))")
}

test("clips and notices expire after a day") {
  clock = 1_000_000
  let dir = tempDir()
  let s = store(dir)
  let f = recorded(s)
  s.markComplete(f, durationMs: 1000, tag: "p1", reason: "user", voice: FULL)
  _ = recorded(s) // truncated: leaves an "interrupted" notice
  s.sweep(active: nil)
  clock += PendingStore.ttlMs + 1
  s.sweep(active: nil)
  check(!exists(f), "expired file deleted")
  check(s.pending(tag: "p1").isEmpty, "nothing offered")
  check(s.takeInterrupted(tag: "p1") == 0, "notice expired")
  check(names(dir).isEmpty, "directory empty: \(names(dir))")
  clock = 1_000_000
}

test("signing out clears every clip and notice except the file being written") {
  let dir = tempDir()
  let s = store(dir)
  s.markComplete(recorded(s, tag: "p1"), durationMs: 1000, tag: "p1", reason: "user", voice: FULL)
  s.markComplete(recorded(s, tag: "p9"), durationMs: 1000, tag: "p9", reason: "user", voice: FULL)
  _ = recorded(s, tag: "p1")
  s.sweep(active: nil)
  let active = recorded(s, tag: "p2")
  s.clearAll(active: active)
  check(s.pending(tag: "p1").isEmpty && s.pending(tag: "p9").isEmpty, "clips gone")
  check(s.takeInterrupted(tag: "p1") == 0, "notices gone")
  let id = active.deletingPathExtension().lastPathComponent
  check(names(dir) == ["\(id).mp4", "\(id).rec"], "only the active recording: \(names(dir))")
  s.clearAll(active: nil)
  check(names(dir).isEmpty, "all gone")
}

test("a meta whose video is gone is dropped; corrupt metas and temp files are swept") {
  let dir = tempDir()
  let s = store(dir)
  let f = recorded(s)
  s.markComplete(f, durationMs: 1000, tag: "p1", reason: "user", voice: FULL)
  try fm.removeItem(at: f)
  try Data("x".utf8).write(to: dir.appendingPathComponent("abc.meta.tmp"))
  let g = recorded(s)
  try Data("not json".utf8).write(to: g.deletingPathExtension().appendingPathExtension("meta"))
  check(s.pending(tag: "p1").isEmpty, "nothing offered")
  s.sweep(active: nil)
  check(!exists(g), "video with a corrupt meta deleted")
  check(names(dir).filter { !$0.hasSuffix(".lost") }.isEmpty, "only notices may remain: \(names(dir))")
}

test("the recordings directory is excluded from device backups") {
  let dir = tempDir().appendingPathComponent("recordings")
  let s = store(dir)
  _ = recorded(s)
  let v = try dir.resourceValues(forKeys: [.isExcludedFromBackupKey])
  check(v.isExcludedFromBackup == true, "excluded")
}

// MARK: VoiceCheck (pqa-qa r1 P1; same rule and fixtures as Android VoiceCheckTest)

let voiceDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("voice")
func fixture(_ n: String) -> URL { voiceDir.appendingPathComponent(n) }

test("reads video and audio track durations from the file (index at the end or the front, ffmpeg or Apple muxer)") {
  for n in ["complete.mp4", "complete-faststart.mp4", "apple-complete.mp4"] {
    let t = Mp4Tracks.read(fixture(n))
    check(t?.videoMs == 6000, "\(n) video \(String(describing: t))")
    check((5900...6100).contains(t?.audioMs ?? -1), "\(n) audio \(String(describing: t))")
  }
}

test("a voice that stops early is measured") {
  for n in ["voice-stops-at-2s.mp4", "apple-voice-stops-at-2s.mp4"] {
    let t = Mp4Tracks.read(fixture(n))
    check(t?.videoMs == 6000, "\(n) video")
    check((1900...2100).contains(t?.audioMs ?? -1), "\(n) audio \(String(describing: t))")
  }
}

test("no audio track is reported as no audio; an unreadable or missing file is nil") {
  let t = Mp4Tracks.read(fixture("no-audio.mp4"))
  check(t?.videoMs == 6000 && t?.audioMs == nil, "no audio \(String(describing: t))")
  let junk = tempDir().appendingPathComponent("junk.mp4")
  try Data(repeating: 7, count: 64).write(to: junk)
  check(Mp4Tracks.read(junk) == nil, "junk")
  check(Mp4Tracks.read(tempDir().appendingPathComponent("missing.mp4")) == nil, "missing")
  // A truncated recording (no index written) is unreadable, never "complete".
  let cut = tempDir().appendingPathComponent("cut.mp4")
  try Data(try Data(contentsOf: fixture("complete.mp4")).prefix(20_000)).write(to: cut)
  check(VoiceCheck.inspect(cut) == nil, "truncated")
}

test("the voice must cover the video within 1 s or 2 %") {
  check(VoiceCheck.covers(videoMs: 230_366, audioMs: 229_645), "run 5")
  check(VoiceCheck.covers(videoMs: 10_000, audioMs: 9_001), "within 1 s")
  check(!VoiceCheck.covers(videoMs: 10_000, audioMs: 8_900), "beyond 1 s")
  check(VoiceCheck.covers(videoMs: 600_000, audioMs: 588_500), "2 % of 10 min")
  check(!VoiceCheck.covers(videoMs: 600_000, audioMs: 587_000), "beyond 2 %")
  check(!VoiceCheck.covers(videoMs: 391_720, audioMs: 202_687), "the rotation failure")
  check(!VoiceCheck.covers(videoMs: 5_000, audioMs: nil), "no audio")
}

test("audio lost inside the clip has its own tight bound (pqa-qa pipeline r1 P2-C)") {
  // The edge tolerance (max 1 s, 2 %) is for encoder start-up and tail; narration missing in the
  // MIDDLE gets no such allowance: > 1 s lost in total, or any single gap > 0.5 s, is incomplete.
  let ok = VoiceCheck.inspect(fixture("apple-complete.mp4"), lostMs: 400, maxGapMs: 0)
  check(ok?.complete == true && ok?.lostMs == 400, "400 ms lost in small pieces: \(String(describing: ok))")
  let lost = VoiceCheck.inspect(fixture("apple-complete.mp4"), lostMs: 1_200, maxGapMs: 0)
  check(lost?.complete == false && lost?.lostMs == 1_200, "1.2 s lost in total")
  check((4700...4900).contains(lost?.voiceMs ?? -1), "lost audio doesn't count as voice: \(String(describing: lost))")
  let gap = VoiceCheck.inspect(fixture("apple-complete.mp4"), lostMs: 600, maxGapMs: 600)
  check(gap?.complete == false, "one 0.6 s gap")
  check(!VoiceCheck.covers(videoMs: 600_000, audioMs: 600_000, lostMs: 12_000, maxGapMs: 0), "12 s lost mid-clip on 10 min used to pass the edge rule")
  check(VoiceCheck.covers(videoMs: 600_000, audioMs: 595_000, lostMs: 900, maxGapMs: 400), "within both bounds")
  check(!VoiceCheck.covers(videoMs: 600_000, audioMs: 600_000, lostMs: 501, maxGapMs: 501), "gap just over 0.5 s")
}

// MARK: AudioGaps (mic sample-buffer timestamps; the iOS counterpart of Android's AudioClock)

test("contiguous microphone buffers lose nothing; small timestamp jitter is not a gap") {
  var g = AudioGaps()
  var t = 0.0
  for i in 0..<200 {
    let jitter = (i % 3 == 0) ? 4.0 : -3.0
    g.appended(ptsMs: t + jitter, durationMs: 21.3)
    t += 21.3
  }
  check(g.lostMs == 0 && g.maxGapMs == 0, "lost \(g.lostMs) max \(g.maxGapMs)")
}

test("a timestamp gap inside the clip is measured; several add up; the longest is kept") {
  var g = AudioGaps()
  g.appended(ptsMs: 0, durationMs: 20)
  g.appended(ptsMs: 20, durationMs: 20)
  g.appended(ptsMs: 640, durationMs: 20)    // 600 ms missing
  g.appended(ptsMs: 660, durationMs: 20)
  g.appended(ptsMs: 980, durationMs: 20)    // 300 ms missing
  check(g.lostMs == 900, "total \(g.lostMs)")
  check(g.maxGapMs == 600, "max \(g.maxGapMs)")
}

test("a gap shorter than one buffer (and the 50 ms floor) is jitter, not loss") {
  var g = AudioGaps()
  g.appended(ptsMs: 0, durationMs: 85)
  g.appended(ptsMs: 85 + 70, durationMs: 85)   // 70 ms late, buffer is 85 ms
  check(g.lostMs == 0, "jitter \(g.lostMs)")
  g.appended(ptsMs: 240 + 90, durationMs: 85)  // 90 ms late: beyond one buffer
  check(g.lostMs == 90 && g.maxGapMs == 90, "loss \(g.lostMs)")
}

test("a broadcast pause chosen by the tester is not counted as lost voice") {
  var g = AudioGaps()
  g.appended(ptsMs: 0, durationMs: 20)
  g.resumed()
  g.appended(ptsMs: 30_000, durationMs: 20)
  check(g.lostMs == 0 && g.maxGapMs == 0, "pause \(g.lostMs)")
}

test("inspect gives the verdict for a file") {
  check(VoiceCheck.inspect(fixture("apple-complete.mp4"))?.complete == true, "complete")
  let cut = VoiceCheck.inspect(fixture("apple-voice-stops-at-2s.mp4"))
  check(cut?.complete == false && cut?.videoMs == 6000 && (1900...2100).contains(cut?.voiceMs ?? -1), "cut \(String(describing: cut))")
  let silent = VoiceCheck.inspect(fixture("no-audio.mp4"))
  check(silent?.complete == false && silent?.voiceMs == 0, "silent")
}

test("the box parser agrees with AVFoundation on every fixture") {
  for n in ["complete.mp4", "complete-faststart.mp4", "apple-complete.mp4", "voice-stops-at-2s.mp4", "apple-voice-stops-at-2s.mp4", "no-audio.mp4"] {
    let av = avDurations(fixture(n))
    let t = Mp4Tracks.read(fixture(n))
    check(abs((t?.videoMs ?? -1) - av.video) <= 50, "\(n) video \(String(describing: t)) vs \(av)")
    check(abs((t?.audioMs ?? 0) - av.audio) <= 50, "\(n) audio \(String(describing: t)) vs \(av)")
  }
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

test("signing out forgets a pending session tag (the next user's broadcast can't inherit it)") {
  clock = 1_000_000
  let st = BroadcastState(defaults: freshDefaults(), now: { clock })
  st.requestTag("p1")
  st.clearPendingTag()
  check(st.consumeTag() == nil, "cleared")
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
