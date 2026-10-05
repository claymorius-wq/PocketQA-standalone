package expo.modules.pocketqascreencapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// The pure parts of the AudioRecord + MediaCodec + MediaMuxer capture pipeline
// (docs/plans/native-capture-pipeline.md). They replace MediaRecorder, whose audio track stopped
// for good after an emulator stall (voice 202.7 s of 391.7 s; 2:48 of 2:57; 2:07 of 3:44).
class PipelineLogicTest {
  // 10 ms of 44.1 kHz mono = 441 frames.
  private val chunk = 441
  private val chunkUs = 10_000L

  @Test fun audioTimestampsFollowTheSamplesNotTheReadJitter() {
    val c = AudioClock(sampleRate = 44_100, bufferUs = 500_000)
    val first = c.next(chunk, readEndUs = 1_010_000)
    assertEquals(1_000_000L, first)
    // A 200 ms scheduling stall: the buffered audio then arrives in a burst. Nothing was lost, so the
    // timestamps keep advancing by exactly the samples read.
    var pts = first
    for (i in 1..20) pts = c.next(chunk, readEndUs = 1_230_000 + i * 100L)
    assertEquals(first + 20 * chunkUs, pts)
    assertEquals(0, c.gaps)
  }

  @Test fun audioLostToAnOverrunMovesTheClockForwardInsteadOfFallingBehindForever() {
    val c = AudioClock(sampleRate = 44_100, bufferUs = 500_000)
    c.next(chunk, readEndUs = 1_010_000)
    // 2 s later than the samples account for: more than the buffer could hold, so audio was dropped.
    val after = c.next(chunk, readEndUs = 3_020_000)
    assertEquals(3_010_000L, after)
    assertEquals(1, c.gaps)
    assertTrue(c.lostUs in 1_990_000L..2_010_000L)
    assertEquals(3_020_000L, c.next(chunk, readEndUs = 3_030_000))
  }

  @Test fun audioTimestampsNeverGoBackwards() {
    val c = AudioClock(sampleRate = 44_100, bufferUs = 500_000)
    val a = c.next(chunk, readEndUs = 5_000_000)
    // A read that reports an earlier wall time (clock jitter) still moves forward by its samples.
    val b = c.next(chunk, readEndUs = 4_000_000)
    assertTrue(b > a)
    assertEquals(a + chunkUs, b)
  }

  @Test fun theBacklogIsBoundedAndDropsTheOldestAudio() {
    val q = PcmBacklog<String>(capacity = 3)
    for (s in listOf("a", "b", "c", "d", "e")) q.add(s)
    assertEquals(2, q.dropped)
    assertEquals("c", q.poll())
    assertEquals("d", q.poll())
    assertEquals("e", q.poll())
    assertNull(q.poll())
  }

  @Test fun livenessStopsWhenTheMicrophoneIsSilencedOrStopsDelivering() {
    val w = Liveness(silencedForMs = 2_000, noAudioForMs = 3_000)
    w.started(0)
    assertNull(w.check(nowMs = 1_000, lastAudioMs = 990, silenced = false))
    // Another app with its UI on top took the microphone: we get silence (sharing-audio-input).
    assertNull(w.check(nowMs = 2_000, lastAudioMs = 1_990, silenced = true))
    assertNull(w.check(nowMs = 3_500, lastAudioMs = 3_490, silenced = true))
    assertEquals("mic", w.check(nowMs = 4_100, lastAudioMs = 4_090, silenced = true))
  }

  @Test fun aSilencedSpellThatEndsIsForgiven() {
    val w = Liveness(silencedForMs = 2_000, noAudioForMs = 3_000)
    w.started(0)
    assertNull(w.check(1_000, 990, silenced = true))
    assertNull(w.check(2_000, 1_990, silenced = false))
    assertNull(w.check(3_500, 3_490, silenced = true))
    assertNull(w.check(5_000, 4_990, silenced = true))
    assertEquals("mic", w.check(5_600, 5_590, silenced = true))
  }

  @Test fun anAudioPathThatStopsDeliveringEndsTheSession() {
    val w = Liveness(silencedForMs = 2_000, noAudioForMs = 3_000)
    w.started(0)
    // Before the first chunk the start-up grace applies.
    assertNull(w.check(nowMs = 2_500, lastAudioMs = -1, silenced = false))
    assertEquals("mic", w.check(nowMs = 3_100, lastAudioMs = -1, silenced = false))
    val v = Liveness(silencedForMs = 2_000, noAudioForMs = 3_000)
    v.started(0)
    assertNull(v.check(5_000, 4_990, false))
    assertNull(v.check(7_900, 4_990, false))
    assertEquals("mic", v.check(8_100, 4_990, false))
  }

  private data class Sample(val track: Int, val ptsUs: Long, val bytes: Int)

  private class FakeSink : MuxGate.Sink<String> {
    val tracks = mutableListOf<String>()
    var started = false
    val written = mutableListOf<Sample>()
    override fun addTrack(format: String): Int {
      tracks += format
      return tracks.size - 1
    }
    override fun start() {
      started = true
    }
    override fun write(track: Int, data: ByteArray, ptsUs: Long, flags: Int) {
      written += Sample(track, ptsUs, data.size)
    }
  }

  @Test fun theMuxerStartsOnlyWhenBothTracksAreKnownAndKeepsEarlierSamples() {
    val sink = FakeSink()
    val g = MuxGate(sink, baseUs = 1_000_000, maxPending = 100)
    g.format(MuxGate.AUDIO, "aac")
    g.sample(MuxGate.AUDIO, ByteArray(10), 1_020_000, 0)
    assertTrue(!sink.started)
    g.format(MuxGate.VIDEO, "avc")
    assertTrue(sink.started)
    g.sample(MuxGate.VIDEO, ByteArray(100), 1_030_000, 1)
    // Times are relative to the session start; the held audio sample was written once started.
    assertEquals(listOf(Sample(0, 20_000, 10), Sample(1, 30_000, 100)), sink.written)
    assertEquals(110L, g.bytes)
  }

  @Test fun eachTrackIsWrittenInStrictlyIncreasingTimeAndNothingBeforeTheStart() {
    val sink = FakeSink()
    val g = MuxGate(sink, baseUs = 1_000_000, maxPending = 100)
    g.format(MuxGate.VIDEO, "avc")
    g.format(MuxGate.AUDIO, "aac")
    g.sample(MuxGate.AUDIO, ByteArray(1), 999_000, 0) // before the session started
    g.sample(MuxGate.AUDIO, ByteArray(1), 1_010_000, 0)
    g.sample(MuxGate.AUDIO, ByteArray(1), 1_010_000, 0) // not increasing
    g.sample(MuxGate.AUDIO, ByteArray(1), 1_005_000, 0) // backwards
    g.sample(MuxGate.AUDIO, ByteArray(1), 1_020_000, 0)
    assertEquals(listOf(10_000L, 20_000L), sink.written.map { it.ptsUs })
    assertEquals(3, g.rejected)
  }

  @Test fun heldSamplesAreBoundedUntilTheMuxerStarts() {
    val sink = FakeSink()
    val g = MuxGate(sink, baseUs = 0, maxPending = 2)
    g.format(MuxGate.AUDIO, "aac")
    g.sample(MuxGate.AUDIO, ByteArray(1), 10, 0)
    g.sample(MuxGate.AUDIO, ByteArray(1), 20, 0)
    g.sample(MuxGate.AUDIO, ByteArray(1), 30, 0)
    g.format(MuxGate.VIDEO, "avc")
    assertEquals(listOf(20L, 30L), sink.written.map { it.ptsUs })
  }
}
