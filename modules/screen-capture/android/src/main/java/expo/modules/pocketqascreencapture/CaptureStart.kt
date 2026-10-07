package expo.modules.pocketqascreencapture

/**
 * The order in which a recording starts (pure, unit-tested; full E2E P-13).
 *
 * A microphone foreground service is a while-in-use capability: Android decides whether it may use
 * the microphone when the service is STARTED, and refuses ("the app must be in the eligible state")
 * if Pocket QA is in the background by then. With "A single app" sharing (Android 14+) the system
 * puts the chosen app in front BEFORE Pocket QA receives the consent result, so starting the service
 * from that result crashed the app on a physical Seeker. Hence:
 *  1. prepare: on the tester's tap, while Pocket QA is in front, start the service with the
 *     microphone type only (no capture yet);
 *  2. only when the service confirms it is in the foreground, open the consent dialog;
 *  3. on consent, the already-running service adds the mediaProjection type and starts capturing;
 *     on a declined consent or no answer, the prepared service is stopped.
 * Every step fails with a clean rejection, never a crash.
 */
class CaptureStart(private val ops: Ops) {
  interface Ops {
    fun prepareService()
    fun launchConsent()
    /** Hands the consent to the running service; false if Android refused (nothing was started). */
    fun startCapture(): Boolean
    fun cancelService()
    fun resolve()
    fun reject(code: String)
  }

  enum class Phase { PREPARE, CAPTURE }
  private enum class State { IDLE, PREPARING, CONSENT }

  private var state = State.IDLE
  val idle get() = state == State.IDLE

  /** The tester tapped Record (Pocket QA is in the foreground). */
  fun begin() {
    if (state != State.IDLE) return
    state = State.PREPARING
    ops.prepareService()
  }

  /** The service reports whether it got into the foreground with the microphone type. */
  fun prepared(ok: Boolean) {
    if (state != State.PREPARING) return
    if (ok) {
      state = State.CONSENT
      ops.launchConsent()
    } else {
      state = State.IDLE
      ops.reject(FOREGROUND_REFUSED)
    }
  }

  /** The service never answered (killed, or a lost callback): stop it and give up cleanly. */
  fun timedOut() {
    if (state != State.PREPARING) return
    state = State.IDLE
    ops.cancelService()
    ops.reject(FOREGROUND_REFUSED)
  }

  fun consentResult(granted: Boolean) {
    if (state != State.CONSENT) return
    state = State.IDLE
    if (granted) {
      if (ops.startCapture()) {
        ops.resolve()
      } else {
        ops.cancelService()
        ops.reject(START_FAILED)
      }
    } else {
      ops.cancelService()
      ops.reject(CONSENT_DENIED)
    }
  }

  companion object {
    const val FOREGROUND_REFUSED = "ERR_FOREGROUND_REFUSED"
    const val CONSENT_DENIED = "ERR_CONSENT_DENIED"
    const val START_FAILED = "ERR_START_FAILED"
    // ServiceInfo.FOREGROUND_SERVICE_TYPE_* values (kept here so this class stays plain JVM).
    const val TYPE_MEDIA_PROJECTION = 0x20
    const val TYPE_MICROPHONE = 0x80

    /** The foreground-service types for a phase on this SDK: null = untyped startForeground (pre-29). */
    fun typesFor(phase: Phase, sdk: Int): Int? = when {
      sdk < 29 -> null
      phase == Phase.PREPARE -> if (sdk >= 30) TYPE_MICROPHONE else 0
      else -> if (sdk >= 30) TYPE_MEDIA_PROJECTION or TYPE_MICROPHONE else TYPE_MEDIA_PROJECTION
    }

    /**
     * Runs one startForeground call: false, never a crash, when the platform refuses it
     * (SecurityException for a type not allowed now; ForegroundServiceStartNotAllowedException is an
     * IllegalStateException).
     */
    inline fun guarded(start: () -> Unit): Boolean = try {
      start()
      true
    } catch (_: SecurityException) {
      false
    } catch (_: IllegalStateException) {
      false
    }
  }
}
