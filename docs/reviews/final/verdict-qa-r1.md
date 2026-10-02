# Phase 8 — final independent QA, round 1

Reviewer: `pqa-qa` (`wX:p2`, claude-opus-5-5, read-only). Captured verbatim by the lead on 2026-10-03. Reviewed `main` at f9950c6.

```text
⏺ VERDICT: CHANGES_REQUIRED

  One P2 blocks calling the local MVP accepted. The checker that blocks earnings and payment wording doesn't catch
  "paid" or "payout", so a builder's approve note can tell a tester they were paid. Everything else passes locally or
  is honestly labelled as blocked or not built. I used Read only and modified nothing. I didn't check the git history
  of f9950c6, because I can't run git commands.

  Threat model (plan §6)

  Threat: IDOR on evidence or media
  Control in place?: Yes. Non-owners get 404 (apps/api/src/access.ts). Playback tokens are bound to the requester, last

  300 s, are re-checked against an active, authorised holder on every use, and are revoked on logout and deletion.
  Test or evidence that exists: apps/api/test/authz.matrix.test.ts, evidence.test.ts, review-fixes.test.ts. The plan's
  name api/evidence.authz.test.ts doesn't exist; coverage lives in these files.
  Residual risk: The token in /media/:token is a 5-minute bearer, redacted in logs. The web preview keeps the session
  in
  sessionStorage; it is local only.
  ────────────────────────────────────────
  Threat: Removed private segment leaks
  Control in place?: Yes. On device, uploadQueue, the live re-check in uploadKept, removeSegment, and discard/purge on
  unmount. On the server, evidence is frozen after submit and the freeze is re-checked inside the write transaction.
  Test or evidence that exists: apps/mobile/__tests__/upload-queue.test.ts (matches the plan name);
  apps/api/test/lifecycle.test.ts "freezes notes and evidence after submission" (instead of
  api/evidence.state.test.ts); e2e/review-loop.spec.ts; Maestro remove-segment.yaml, leave-while-recording.yaml.
  Residual risk: Deleting the clip on the device is proven only by code paths. The release APK isn't debuggable, so the

  cache folder can't be listed.
  ────────────────────────────────────────
  Threat: Nonce replay or substitution
  Control in place?: Yes. Nonces are single-use, bound to the user and address, and expire. The server requires the
  signed bytes to equal its own rebuilt SIWS text, and burns the nonce on any attempt by its owner.
  Test or evidence that exists: packages/domain/src/wallet.test.ts, apps/api/test/wallet.test.ts (instead of
  api/wallet.nonce.test.ts). On the emulator, the server rows show the nonce used=1 and a 409 for the same address on
  a second account.
  Residual risk: With signMessages the wallet doesn't check the domain, so phishing can link a victim's devnet address
  to another account. There is no value at stake. sign_in_payload is the follow-up.
  ────────────────────────────────────────
  Threat: Fake payment success
  Control in place?: Yes. Transfer intents are owned by the server. verifyTransfer checks sender, recipient, amount,
  genesis hash, block time and single use of the signature, at finalized commitment.
  Test or evidence that exists: packages/domain/src/transfer.test.ts; the devnet transfer section of
  apps/api/test/wallet.test.ts, using a fake RPC.
  Residual risk: Confirmation against live devnet has never been exercised. The transfer UI isn't built.
  ────────────────────────────────────────
  Threat: Covert capture
  Control in place?: Yes. OS consent on every start. The notification permission is required on Android 13+. There is
  an
  ongoing notification with a Stop action, a status-bar stop, discard on leaving the screen, and no audio.
  Test or evidence that exists: Maestro record-consent, record-decline, notifications-denied, system-stop,
  notification-stop, leave-while-recording (docs/reviews/gate-b-emulator/summary.txt: 9/9 flows, 0 active projections
  after each); docs/reviews/s0-capture-spike.md.
  Residual risk: Emulator only. Auto-stop on screen lock wasn't observed on this image, and FLAG_SECURE screens and
  wallet app switches are untested.
  ────────────────────────────────────────
  Threat: Earnings or fake-AI claims
  Control in place?: Partial. lintCopy runs on all builder and admin text (API) and on UI string literals (jest).
  /ai/status always returns available:false, and the UI says "Analysis unavailable".
  Test or evidence that exists: apps/mobile/__tests__/copy.test.ts; apps/api/test/review-fixes.test.ts (finding 3);
  lifecycle.test.ts; account.test.ts "reports AI analysis as unavailable" (instead of api/ai.status.test.ts); domain
  copy tests.
  Residual risk: Gap: "paid" and "payout" aren't banned; see finding 1.
  ────────────────────────────────────────
  Threat: Secret leakage
  Control in place?: Yes. A secret scanner runs before commits, .gitignore covers env files, keys and data, logs are
  redacted by matched route, and the admin password is read from a no-echo prompt.
  Test or evidence that exists: scripts/check-secrets.test.mjs, apps/api/test/log.redact.test.ts (matches the plan
  name).
  Residual risk: Test passwords and the AVD PIN go only into the git-ignored .results/ folder. There was one process
  incident, still awaiting Hamza.
  | Ledger tampering or double credit | Yes. Append-only triggers, one reward credit per participation enforced by a
  unique index, idempotent approve, a check that the study budget can't go negative, and the 7-day dispute window. |
  packages/domain/src/ledger.test.ts; apps/api/test/lifecycle.test.ts ("approval credits exactly once", "database
  itself refuses…"); review-fixes.test.ts. | Only test credits. The builder's local top-up has no total cap, by design.
  |

  Status of each area

  - Passed locally:
    - Phases 0 and 2–3, with all review rounds closed.
    - Phase 4 Gate A (web): 4 Playwright runs against the real API, 23 light/dark screenshots.
    - Phase 7 at API level, plus the admin dispute and moderation UI tested end to end.
    - Phases 5–6 on the emulator: 9 Maestro flows, with the server-side checks re-captured.
    - Phase 7 at API level, plus the admin dispute and moderation UI tested end to end.
    - Phases 5–6 on the emulator: 9 Maestro flows, with the server-side checks re-captured.
  - Blocked by hardware or approvals:
    - real-device S0/B1 (no Seeker or Android 14+ phone attached);
    - B2 with a real production wallet;
    - Hamza's review of the consent and retention wording (plan §11, ADR 0002);
    - Hamza's acknowledgement of the routed-around denial and of the prompt-only read-only limit on this reviewer;
    - the stale "plan only" status lines in docs/plans/*.
  - Not built:
    - devnet transfer UI;
    - builder view of disputes on their own studies;
    - admin tool to force a decision on a stuck submission;
    - MWA sign_in_payload flow;
    - iOS run (graceful degradation only);
    - AI provider (out of scope).

  Findings

  1. [P2] The wording check doesn't block "paid" or "payout" in text builders write to testers.
     packages/domain/src/copy.ts:7-18
     - Scenario: A builder approves with the note "You've been paid — payout of 50 USDC sent to your wallet". No rule
       matches:
       - get-paid needs "get paid" or "getting paid";
       - payment-complete needs the word "payment".
     - The note is stored as decisionReason and shown to the tester. That breaks two rules: CLAUDE.md's "no … fake
       payment completion", and plan Phase 6's "the UI never says 'paid' unless the state is confirmed". It's the same
       class of text as the round-1 Phase 2-3 P2 on approve notes.
     - Fix:
       - Add rules for \bpaid\b, \bpay-?outs?\b, \b(sent|transferred)\s+to\s+your\s+wallet\b, and currency amounts such
         as \b\d+(\.\d+)?\s*(usdc|usdt|sol|usd)\b and \$\d.
       - Add domain and API tests, for example an approve note "You've been paid" returning 400.
       - Re-run the mobile copy scan, which may surface existing UI strings that need rewording.
  2. [P3] The progress file is inconsistent. docs/progress.md:16 says "7 native Maestro flows"; the final run has 9
     (summary.txt). Some carried items are already done:
     - :53 media redaction by matched route was done in Phase 3 (app.ts:41-46, plus the /%6Dedia/ test);
     - :57 the shared SIWS domain constant was done in Phase 5-6 round 2;
     - :54 the scanner policy for explorer URLs and large media was never formally decided, and should be either
       decided or closed.
     - Fix: Correct the count and close or update the stale items.
  3. [P3] Account deletion through the UI isn't covered end to end. It's tested only at API level (account.test.ts,
     review-fixes.test.ts). Phase 7 lists deletion as an acceptance item, and the UI has a typed confirmation that no
     test exercises.
     - Fix: Add a Playwright step: Settings → Delete account → type the phrase → land on sign-in → logging in again
       fails.
  4. [P3] Some plan acceptance items are met on the emulator only, and should stay labelled that way.
     - Phase 5 asks for Maestro flows on a real device, with evidence in docs/reviews/gate-b1/.
     - Phase 6 asks for a real-device MWA run with a devnet explorer link, and "never says paid unless confirmed" on a
       transfer UI that doesn't exist.
     - The docs label all of this correctly; keep it that way.
     - Fix: Name docs/reviews/final/verdict.md "local MVP, emulator-verified", not "Gate B final passed".
  5. [P3] Open process items still need Hamza. These are documented, but the merge record should show his explicit
     sign-off:
     - the routed-around denial;
     - the prompt-only read-only enforcement on this reviewer;
     - the stale status lines in the plans;
     - the AVD PIN cleanup (progress.md:26-29).

  After finding 1 is fixed and tested, I expect to return VERDICT: APPROVE-LOCAL-MVP, with the blocked and not-built
  items listed above.

✻ Crunched for 1m 18s · done 1:39 AM
```
