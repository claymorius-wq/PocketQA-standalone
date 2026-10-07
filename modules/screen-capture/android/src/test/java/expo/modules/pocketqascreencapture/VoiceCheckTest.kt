package expo.modules.pocketqascreencapture

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

// A finished recording must carry the tester's voice for its whole length
// (docs/plans/native-screen-voice-recording.md; pqa-qa r1 P1). Emulator rotation run 2026-10-05: the
// video ran 391.7 s but the AAC track stopped at 202.7 s, and nothing noticed.
class VoiceCheckTest {
  private fun fixture(name: String) = File(javaClass.classLoader!!.getResource("voice/$name")!!.toURI())

  @Test fun readsTheVideoAndAudioTrackDurationsFromTheFile() {
    val t = Mp4Tracks.read(fixture("complete.mp4"))!!
    assertEquals(6000L, t.videoMs)
    assertTrue("audio ${t.audioMs}", t.audioMs!! in 5900..6100)
  }

  @Test fun readsAFileWhoseIndexIsAtTheFront() {
    val t = Mp4Tracks.read(fixture("complete-faststart.mp4"))!!
    assertEquals(6000L, t.videoMs)
    assertTrue(t.audioMs!! in 5900..6100)
  }

  @Test fun aVoiceThatStopsEarlyIsMeasured() {
    val t = Mp4Tracks.read(fixture("voice-stops-at-2s.mp4"))!!
    assertEquals(6000L, t.videoMs)
    assertTrue("audio ${t.audioMs}", t.audioMs!! in 1900..2100)
  }

  @Test fun noAudioTrackIsReportedAsNoAudio() {
    val t = Mp4Tracks.read(fixture("no-audio.mp4"))!!
    assertEquals(6000L, t.videoMs)
    assertNull(t.audioMs)
  }

  @Test fun anUnreadableFileIsNull() {
    val f = File.createTempFile("pqa", ".mp4").apply { writeBytes(ByteArray(64) { 7 }) }
    assertNull(Mp4Tracks.read(f))
    assertNull(Mp4Tracks.read(File(f.parentFile, "missing-${System.nanoTime()}.mp4")))
  }

  @Test fun theVoiceMustCoverTheVideoWithinOneSecondOrTwoPercent() {
    // Run 5 (emulator, 2026-10-05): video 230.37 s, audio 229.65 s.
    assertTrue(VoiceCheck.covers(videoMs = 230_366, audioMs = 229_645))
    assertTrue(VoiceCheck.covers(videoMs = 10_000, audioMs = 9_001))
    assertFalse(VoiceCheck.covers(videoMs = 10_000, audioMs = 8_900))
    // Long clips: 2% (a 10-minute clip may lose up to 12 s of encoder start-up and tail).
    assertTrue(VoiceCheck.covers(videoMs = 600_000, audioMs = 588_500))
    assertFalse(VoiceCheck.covers(videoMs = 600_000, audioMs = 587_000))
    // The rotation failure.
    assertFalse(VoiceCheck.covers(videoMs = 391_720, audioMs = 202_687))
    assertFalse(VoiceCheck.covers(videoMs = 5_000, audioMs = null))
  }

  @Test fun inspectGivesTheVerdictForAFile() {
    assertTrue(VoiceCheck.inspect(fixture("complete.mp4"))!!.complete)
    val cut = VoiceCheck.inspect(fixture("voice-stops-at-2s.mp4"))!!
    assertFalse(cut.complete)
    assertTrue(cut.voiceMs in 1900..2100)
    assertEquals(6000L, cut.videoMs)
    val silent = VoiceCheck.inspect(fixture("no-audio.mp4"))!!
    assertFalse(silent.complete)
    assertEquals(0L, silent.voiceMs)
  }

  @Test fun audioLostInsideTheClipHasItsOwnTightBound() {
    // pqa-qa pipeline r1 P2-C: the edge tolerance (max 1 s, 2 %) is for encoder start-up and tail;
    // narration missing in the MIDDLE gets no such allowance. More than 1 s lost in total, or any
    // single gap over 0.5 s, means the voice is incomplete, whatever the clip length.
    val ok = VoiceCheck.inspect(fixture("complete.mp4"), lostAudioMs = 400, maxGapMs = 0)!!
    assertTrue(ok.complete)
    assertEquals(400L, ok.lostMs)
    val lost = VoiceCheck.inspect(fixture("complete.mp4"), lostAudioMs = 1_200, maxGapMs = 0)!!
    assertFalse(lost.complete)
    assertEquals(1_200L, lost.lostMs)
    val gap = VoiceCheck.inspect(fixture("complete.mp4"), lostAudioMs = 600, maxGapMs = 600)!!
    assertFalse(gap.complete)
    // On a 10-minute clip, 12 s lost in the middle used to pass the edge rule.
    assertFalse(VoiceCheck.covers(videoMs = 600_000, audioMs = 600_000, lostMs = 12_000, maxGapMs = 0))
    assertTrue(VoiceCheck.covers(videoMs = 600_000, audioMs = 595_000, lostMs = 900, maxGapMs = 400))
  }

  // The real failing clip and the real good clip from the emulator are kept privately (not in Git);
  // when present (-Dpqa.voiceClips=<dir>) they are checked too.
  @Test fun theRealEmulatorClipsWhenAvailable() {
    val dir = System.getProperty("pqa.voiceClips")?.let(::File)
    assumeTrue(dir != null && dir.isDirectory)
    val bad = VoiceCheck.inspect(File(dir, "FAILED-audio-truncated.mp4"))!!
    assertFalse(bad.complete)
    assertTrue("video ${bad.videoMs}", bad.videoMs in 391_000..392_500)
    assertTrue("voice ${bad.voiceMs}", bad.voiceMs in 202_000..203_500)
    val good = VoiceCheck.inspect(File(dir, "uploaded-recording.mp4"))!!
    assertTrue(good.complete)
  }
}
