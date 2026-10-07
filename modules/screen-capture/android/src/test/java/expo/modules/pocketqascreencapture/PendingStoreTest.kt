package expo.modules.pocketqascreencapture

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

// The on-disk handoff between the recording service and the session screen
// (docs/plans/native-screen-voice-recording.md, Android design 5).
class PendingStoreTest {
  private lateinit var dir: File
  private var clock = 1_000_000L
  private lateinit var store: PendingStore

  @Before fun setUp() {
    dir = Files.createTempDirectory("pqa-recordings").toFile()
    clock = 1_000_000L
    store = PendingStore(dir) { clock }
  }

  private val FULL = VoiceCheck.Verdict(videoMs = 7000, voiceMs = 6900, complete = true)

  private fun recorded(bytes: Int = 10, tag: String = "p1"): File = store.newFile(tag).apply { writeBytes(ByteArray(bytes)) }

  @Test fun aFinishedClipStaysListedForItsSessionUntilJsDeletesTheFile() {
    val f = recorded()
    store.markComplete(f, durationMs = 7000, tag = "p1", reason = "system", voice = FULL)
    val listed = store.pending("p1")
    assertEquals(1, listed.size)
    assertEquals(f, listed[0].file)
    assertEquals(7000L, listed[0].durationMs)
    assertEquals("system", listed[0].reason)
    // Still listed after a remount (an activity destroyed while the tester was in another app,
    // pqa-qa r1 P2-A): nothing is lost until JS uploads or discards it, which deletes the file.
    assertEquals(1, store.pending("p1").size)
    f.delete()
    assertTrue(store.pending("p1").isEmpty())
  }

  @Test fun theVoiceVerdictTravelsWithTheClip() {
    val ok = recorded()
    val cut = recorded()
    store.markComplete(ok, 7000, "p1", "user", FULL)
    store.markComplete(cut, 391_700, "p1", "user", VoiceCheck.Verdict(videoMs = 391_720, voiceMs = 202_687, complete = false, lostMs = 1_500))
    val byFile = store.pending("p1").associateBy { it.file }
    assertTrue(byFile.getValue(ok).voiceComplete)
    assertFalse(byFile.getValue(cut).voiceComplete)
    assertEquals(202_687L, byFile.getValue(cut).voiceMs)
    assertEquals(391_720L, byFile.getValue(cut).videoMs)
    assertEquals(1_500L, byFile.getValue(cut).voiceLostMs)
    assertEquals(0L, byFile.getValue(ok).voiceLostMs)
  }

  @Test fun anUnmeasuredClipIsNeverTreatedAsNarrated() {
    val f = recorded()
    store.markComplete(f, 7000, "p1", "user", voice = null)
    val e = store.pending("p1").single()
    assertFalse(e.voiceComplete)
    assertEquals(0L, e.voiceMs)
  }

  @Test fun anotherSessionNeverSeesTheClip() {
    store.markComplete(recorded(), 1000, "p1", "user", FULL)
    // A clip that somehow has no session tag is never listed, not even for an empty tag.
    store.markComplete(recorded(tag = ""), 1000, "", "user", FULL)
    assertTrue(store.pending("p2").isEmpty())
    assertTrue(store.pending("").isEmpty())
    assertEquals(1, store.pending("p1").size)
  }

  @Test fun forgetDeletesTheClipAndItsEntry() {
    val f = recorded()
    store.markComplete(f, 1000, "p1", "user", FULL)
    store.forget(f)
    assertFalse(f.exists())
    assertTrue(store.pending("p1").isEmpty())
    assertTrue(dir.listFiles()!!.isEmpty())
  }

  @Test fun aTruncatedFileFromProcessDeathIsKeptAndItsSessionIsToldOnce() {
    // Hamza's preserve rule (2026-10-07): no recording is ever deleted automatically. A file the
    // process died writing is never offered or uploaded, but its bytes stay on the device.
    val truncated = recorded(tag = "p1")
    val active = recorded(tag = "p1")
    val done = recorded(tag = "p1")
    store.markComplete(done, 1000, "p1", "user", FULL)
    store.sweep(active = active)
    assertTrue(truncated.exists())
    assertTrue(active.exists())
    assertTrue(done.exists())
    assertEquals(1, store.pending("p1").size)
    assertEquals(0, store.takeInterrupted("p2"))
    assertEquals(1, store.takeInterrupted("p1"))
    assertEquals(0, store.takeInterrupted("p1"))
    // A later sweep (the same recording still active) neither deletes it nor reports it again.
    store.sweep(active = active)
    assertTrue(truncated.exists())
    assertEquals(0, store.takeInterrupted("p1"))
  }

  // pqa-qa B2 r1 B2-1: the finalise path never deletes a recording. A clip that can't be finalised
  // (a failed stop, an unreadable file: no voice verdict) or recorded (its meta can't be written,
  // e.g. disk full) stays on the device, unlisted, and its session is told once.
  @Test fun aClipThatFailedToStopOrCantBeReadIsKeptAndReportedOnce() {
    val f = recorded(tag = "p1")
    assertFalse(store.settle(f, durationMs = 7000, tag = "p1", reason = "user", voice = null))
    assertTrue(f.exists())
    assertTrue(store.pending("p1").isEmpty())
    assertEquals(1, store.takeInterrupted("p1"))
    store.sweep(active = null)
    assertTrue(f.exists())
    assertEquals(0, store.takeInterrupted("p1"))
  }

  @Test fun aClipWhoseMetaCantBeWrittenIsKeptAndReportedOnce() {
    val f = recorded(tag = "p1")
    // The meta's target is a non-empty directory, so the write-then-rename fails (as on a full disk).
    File(dir, f.nameWithoutExtension + ".meta").apply { mkdirs(); File(this, "x").writeText("x") }
    assertFalse(store.settle(f, durationMs = 7000, tag = "p1", reason = "user", voice = FULL))
    assertTrue(f.exists())
    assertEquals(1, store.takeInterrupted("p1"))
    store.sweep(active = null)
    assertTrue(f.exists())
    assertEquals(0, store.takeInterrupted("p1"))
  }

  @Test fun aFinalisedClipIsSettledAsPending() {
    val f = recorded(tag = "p1")
    assertTrue(store.settle(f, durationMs = 7000, tag = "p1", reason = "user", voice = FULL))
    assertEquals(listOf(f), store.pending("p1").map { it.file })
    assertEquals(0, store.takeInterrupted("p1"))
  }

  @Test fun anEmptyFailedRecordingLeavesNothing() {
    // Nothing was captured (a start that failed before any frame): no file, no notice.
    val f = recorded(bytes = 0, tag = "p1")
    assertFalse(store.settle(f, durationMs = 0, tag = "p1", reason = "error", voice = null))
    assertFalse(f.exists())
    assertEquals(0, store.takeInterrupted("p1"))
  }

  @Test fun anEmptyRecordingIsNeverOffered() {
    val empty = recorded(bytes = 0)
    assertFalse(store.markComplete(empty, 0, "p1", "user", FULL))
    assertTrue(store.pending("p1").isEmpty())
    assertFalse(empty.exists())
  }

  @Test fun finishedClipsNeverExpire() {
    // Hamza's preserve rule (2026-10-07): no age-based expiry; a clip stays listed until the tester
    // uploads it, removes it (with a confirm), or signs out (with a confirm).
    val f = recorded()
    store.markComplete(f, 1000, "p1", "user", FULL)
    store.sweep(active = null)
    clock += 30L * 24 * 60 * 60 * 1000
    store.sweep(active = null)
    assertTrue(f.exists())
    assertEquals(listOf(f), store.pending("p1").map { it.file })
  }

  @Test fun onlyInterruptedNoticesExpireAfterADay() {
    recorded(tag = "p1") // truncated: leaves an "interrupted" notice
    store.sweep(active = null)
    clock += PendingStore.NOTICE_TTL_MS + 1
    store.sweep(active = null)
    assertEquals(0, store.takeInterrupted("p1"))
  }

  @Test fun tempFilesOfTheActiveRecordingAreKeptAndOthersDropped() {
    val active = recorded(tag = "p1")
    val activeTmp = File(dir, active.nameWithoutExtension + ".meta.tmp").apply { writeText("x") }
    val orphanTmp = File(dir, "orphan.rec.tmp").apply { writeText("x") }
    store.sweep(active = active)
    assertTrue(activeTmp.exists())
    assertFalse(orphanTmp.exists())
  }

  @Test fun anUnreadableMetadataFileNeverCostsTheClip() {
    val f = recorded()
    store.markComplete(f, 1000, "p1", "user", FULL)
    File(dir, f.nameWithoutExtension + ".meta").writeBytes(byteArrayOf(0, 1, 2))
    store.sweep(active = null)
    store.sweep(active = null)
    assertTrue(f.exists())
  }

  @Test fun signingOutClearsEveryClipAndNotice() {
    store.markComplete(recorded(tag = "p1"), 1000, "p1", "user", FULL)
    store.markComplete(recorded(tag = "p9"), 1000, "p9", "user", FULL)
    recorded(tag = "p1")
    store.sweep(active = null)
    val active = recorded(tag = "p2")
    store.clearAll(active = active)
    assertTrue(store.pending("p1").isEmpty())
    assertTrue(store.pending("p9").isEmpty())
    assertEquals(0, store.takeInterrupted("p1"))
    assertEquals(listOf(active.name, active.nameWithoutExtension + ".rec").sorted(), dir.listFiles()!!.map { it.name }.sorted())
    store.clearAll(active = null)
    assertTrue(dir.listFiles()!!.isEmpty())
  }

  @Test fun aMetadataFileWithoutItsVideoIsDropped() {
    val f = recorded()
    store.markComplete(f, 1000, "p1", "user", FULL)
    f.delete()
    assertTrue(store.pending("p1").isEmpty())
    store.sweep(active = null)
    assertTrue(dir.listFiles()!!.isEmpty())
  }
}
