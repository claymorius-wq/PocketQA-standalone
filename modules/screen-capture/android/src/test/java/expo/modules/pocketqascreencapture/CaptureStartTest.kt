package expo.modules.pocketqascreencapture

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// Full E2E P-13 (Seeker, Android 16): with "A single app" the system puts the chosen app in front
// BEFORE Pocket QA gets the consent result, so a microphone foreground service started from that
// result is refused ("must be in the eligible state ... foreground only permission") and the app
// crashed. The service must be in the foreground with the microphone type BEFORE the consent dialog
// opens, and every start must fail cleanly instead of crashing.
class CaptureStartTest {
  private class FakeOps(private val captureStarts: Boolean = true) : CaptureStart.Ops {
    val calls = mutableListOf<String>()
    override fun prepareService() { calls += "prepare" }
    override fun launchConsent() { calls += "consent" }
    override fun startCapture(): Boolean { calls += "capture"; return captureStarts }
    override fun cancelService() { calls += "cancel" }
    override fun resolve() { calls += "resolve" }
    override fun reject(code: String) { calls += "reject:$code" }
  }

  @Test fun theMicrophoneServiceIsForegroundBeforeTheConsentDialogOpens() {
    val ops = FakeOps()
    val s = CaptureStart(ops)
    s.begin()
    assertEquals(listOf("prepare"), ops.calls) // no dialog yet: the app is still in front
    s.prepared(ok = true)
    assertEquals(listOf("prepare", "consent"), ops.calls)
    s.consentResult(granted = true)
    assertEquals(listOf("prepare", "consent", "capture", "resolve"), ops.calls)
    assertTrue(s.idle)
  }

  @Test fun aRefusedPrepareRejectsCleanlyAndNeverOpensTheDialog() {
    val ops = FakeOps()
    val s = CaptureStart(ops)
    s.begin()
    s.prepared(ok = false)
    assertEquals(listOf("prepare", "reject:ERR_FOREGROUND_REFUSED"), ops.calls)
    assertTrue(s.idle)
  }

  @Test fun aDeclinedConsentStopsThePreparedService() {
    val ops = FakeOps()
    val s = CaptureStart(ops)
    s.begin()
    s.prepared(ok = true)
    s.consentResult(granted = false)
    assertEquals(listOf("prepare", "consent", "cancel", "reject:ERR_CONSENT_DENIED"), ops.calls)
    assertTrue(s.idle)
  }

  @Test fun aPrepareThatNeverAnswersTimesOutAndCleansUp() {
    val ops = FakeOps()
    val s = CaptureStart(ops)
    s.begin()
    s.timedOut()
    assertEquals(listOf("prepare", "cancel", "reject:ERR_FOREGROUND_REFUSED"), ops.calls)
    // A late answer after the timeout changes nothing.
    s.prepared(ok = true)
    s.consentResult(granted = true)
    assertEquals(listOf("prepare", "cancel", "reject:ERR_FOREGROUND_REFUSED"), ops.calls)
  }

  @Test fun aCaptureThatCannotStartRejectsInsteadOfResolving() {
    val ops = FakeOps(captureStarts = false)
    val s = CaptureStart(ops)
    s.begin()
    s.prepared(ok = true)
    s.consentResult(granted = true)
    assertEquals(listOf("prepare", "consent", "capture", "cancel", "reject:ERR_START_FAILED"), ops.calls)
    assertTrue(s.idle)
  }

  @Test fun eventsOutOfOrderAreIgnored() {
    val ops = FakeOps()
    val s = CaptureStart(ops)
    s.consentResult(granted = true) // no start in flight
    s.prepared(ok = true)
    assertTrue(ops.calls.isEmpty())
    s.begin()
    s.consentResult(granted = true) // the dialog was never opened
    assertEquals(listOf("prepare"), ops.calls)
    assertFalse(s.idle)
  }

  @Test fun foregroundTypesPerPhase() {
    val mic = CaptureStart.TYPE_MICROPHONE
    val mp = CaptureStart.TYPE_MEDIA_PROJECTION
    assertEquals(0x80, mic)
    assertEquals(0x20, mp)
    // Android 11+: the microphone alone while waiting for consent, then both.
    assertEquals(mic, CaptureStart.typesFor(CaptureStart.Phase.PREPARE, sdk = 36))
    assertEquals(mp or mic, CaptureStart.typesFor(CaptureStart.Phase.CAPTURE, sdk = 36))
    // Android 10 has no microphone type (and no while-in-use rule): untyped, then mediaProjection.
    assertEquals(0, CaptureStart.typesFor(CaptureStart.Phase.PREPARE, sdk = 29))
    assertEquals(mp, CaptureStart.typesFor(CaptureStart.Phase.CAPTURE, sdk = 29))
    assertNull(CaptureStart.typesFor(CaptureStart.Phase.CAPTURE, sdk = 28))
  }

  @Test fun aRefusedForegroundStartIsReportedNotThrown() {
    assertTrue(CaptureStart.guarded { })
    assertFalse(CaptureStart.guarded { throw SecurityException("Starting FGS with type microphone ... eligible state") })
    // ForegroundServiceStartNotAllowedException is an IllegalStateException.
    assertFalse(CaptureStart.guarded { throw IllegalStateException("not allowed") })
  }
}
