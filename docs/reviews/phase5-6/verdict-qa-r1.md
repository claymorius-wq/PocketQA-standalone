# Phase 5-6 — independent-qa verdict, round 1

Reviewer: `pqa-qa` (`wX:p2`, claude-opus-5-5, read-only). Captured verbatim by the lead on 2026-10-03.

```text
⏺ VERDICT: CHANGES_REQUIRED

  One P2 blocks the merge: a recording can keep running after the tester leaves the session screen, and the app has no
  way to stop it. Everything else checks out or is P3. I used Read only and modified nothing.

  What checks out
  - Consent every time: each startAsync launches createScreenCaptureIntent, and the consent token is never cached or
    reused.
  - Recording service: startForeground(...MEDIA_PROJECTION) runs before getMediaProjection, with exactly one virtual
    display. onStop routes to finish("system"), and onDestroy also finalizes. There is no audio source and no
    FLAG_SECURE workaround.
  - Cleartext: limited to 127.0.0.1 and localhost.
  - Wallet link: it can't succeed without the server verifying the signature against its own stored SIWS text and
    consuming the nonce. It is devnet only, with no mainnet path, and the "not a payment" wording is used throughout.
  - Secrets: the AVD PIN is passed as an environment variable, not stored, and Maestro output goes to a git-ignored
    folder.
  - Emulator honesty: every claim is labelled as emulator-only, the real-device gates are reported as blocked, and
    screen-lock behaviour is documented rather than asserted.

  Findings

  1. [P2] A recording can outlive the session screen, with no way to stop it in the app, and its clip is orphaned.
     apps/mobile/app/participation/[id].tsx:88, :104-121, :336; ScreenCaptureModule.kt:74;
     ScreenCaptureService.kt:145-150
     - Scenario: The tester starts recording, then navigates away from the screen, submits or withdraws, or the JS
       context reloads.
       - Unmounting removes the onStopped listener but never stops the recorder, so capture continues outside the study
         session.
       - Coming back to the screen shows "Start screen recording", because recording starts as false instead of reading
         isRecording(). Tapping it gives ERR_ALREADY_RECORDING and "Couldn't start recording", and there is no Stop
         button.
       - The notification has no Stop action. On Android 10–14 there is no status-bar chip either, so the tester has no
         reasonable way to stop.
       - When the recording finally stops, the clip goes to a listener that no longer exists. The MP4 stays in
         cache/recordings/ indefinitely, unreviewed and never deleted.
       - Submit isn't blocked while a recording is running, because pendingEvidence doesn't count it.
     - The OS indicators mean this isn't covert. But it is capture beyond the consented session, plus a leak of private
       clip files on the device.
     - Fix:
       - Initialise recording from recorder.isRecording().
       - Disable Submit and Withdraw while recording.
       - On unmount, stop the recorder and delete the resulting file.
       - Add a "Stop" PendingIntent action (ACTION_STOP) to the foreground notification.
       - On startup, sweep cache/recordings/ for files that aren't in the live segment list.
       - Add a Maestro flow: start recording, navigate away, then assert there is no projection and no file left.
  2. [P3] The notification indicator may not be visible on Android 13+. AndroidManifest.xml:5 declares
     POST_NOTIFICATIONS, but the app never requests it at runtime. On a fresh Android 13+ install the
     foreground-service notification can be hidden from the shade. ADR 0003 §7 relies on this notification as the
     visible indicator; the emulator's dumpsys proves the notification was posted, not that it was shown.
     - Fix: Request the permission before the first recording, or remove the claim from the ADR.
  3. [P3] Comments still describe the old MWA design. packages/contracts/src/index.ts:359-371 still says MWA signIn is
     preferred and that the wallet's domain check "always agrees". The flow is now signMessages, where the wallet does
     no domain check; it only displays the text.
     - Fix: Update both comments, and keep the "issue the nonce before the address is known" change as the tracked
       follow-up to move back to sign_in_payload.
  4. [P3] The server's SIWS domain can diverge from the app's identity URI. The server domain can be set with
     POCKETQA_SIWS_DOMAIN (config.ts:69), but the app hardcodes DEFAULT_SIWS_DOMAIN for its MWA identity
     (link.native.ts:23). Overriding the variable makes them disagree.
     - Fix: Drop the override, or pass the server's input.domain into the identity URI.
  5. [P3] The remove-segment flow doesn't check the device. remove-segment only shows that nothing reached the server;
     it never checks that the file was deleted on the device.
     - Fix: Add an adb shell run-as com.reshareai.pocketqa ls cache/recordings check to the evidence.
  6. [P3] A permission denial was routed around; Hamza needs to acknowledge it. candidate.md:92-95: after a read of
     ~/.maestro/tests/ was denied, the lead copied the file with cp and viewed the copy. It was disclosed, the copy was
     deleted, and the workflow was changed so it can't recur. This doesn't affect the code, but it breaks the "a
     denial is the user's decision" rule.
     - Fix: Hamza should explicitly acknowledge it when approving the merge.
  7. [P3] Some of the plan's B1/B2 checks weren't run. FLAG_SECURE screens, recording across a wallet app switch,
     auto-stop on screen lock, and the devnet transfer UI are all untested or not built. This is reported truthfully,
     but those parts of B1/B2 aren't passed.
     - Fix: Keep them as open gates in progress.md until a real device is available.

  Re-review is needed after finding 1 is fixed.

✻ Sautéed for 1m 41s · done 12:52 AM
```
