# Phase 5-6 — independent-qa targeted re-review (round 3)

Reviewer: `pqa-qa` (`wX:p2`, claude-opus-5-5, read-only). Captured verbatim by the lead on 2026-10-03.

```text
⏺ VERDICT: APPROVE

  All four round-2 P3 fixes are in place. I used Read only and modified nothing.

  - Stop collisions (P3 #1): fixed.
    - discardAsync now settles a stopAsync that is still waiting by calling the previous pendingStop with null
      (ScreenCaptureModule.kt:50-56).
    - The new purgeAsync deletes every recording except the active session's file (:94, :99-103).
    - On unmount the screen discards an active recording, then purges (participation/[id].tsx:110-113). That also
      cleans up a clip from a system stop that landed just before the tester left.
  - Notification Stop untested (P3 #2): fixed. notification-stop.yaml opens the shade, taps "Stop recording", and
    checks the clip is in the review queue and Start is back. The screenshot shows the notification with its "Stop
    recording" action. summary.txt shows all 9 flows EXIT=0 with active_projections=0.
  - S0 report (P3 #3): fixed. s0-capture-spike.md:22-24 adds rows for the notification Stop action, the
    notifications-denied refusal, and leaving the screen while recording.
  - Server checks (P3 #4): fixed. verification.md:178-199 re-captures them for run 20261003-012751: exactly one
    evidence upload (a real MP4), then nonce, link and unlink all returning 200, and the nonce marked used.
  - Verify run: pnpm verify EXIT=0, with mobile 111/111 and api 238/238.

  Findings:

  1. [P3] The notification-stop flow doesn't check that the notification went away or that the projection ended. It
     asserts only the app UI. Those two facts come from the runner's dumpsys check and a one-off manual check.
     - Fix (optional): Add assertNotVisible: "Pocket QA is recording your screen" after reopening the shade.

  Carried forward, not blocking:
  - Hamza still needs to acknowledge the earlier routed-around permission denial.
  - All of this is emulator-only evidence. The real-device S0/B1 gates and the real-wallet B2 gate remain blocked.

✻ Baked for 20s · done 1:36 AM
```
