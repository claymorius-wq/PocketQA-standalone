# Phase 5-6 — independent-qa verdict, round 2

Reviewer: `pqa-qa` (`wX:p2`, claude-opus-5-5, read-only). Captured verbatim by the lead on 2026-10-03.

```text
⏺ VERDICT: APPROVE

  The P2 is fixed, P3s 2–4 are fixed, and the rest are documented or waiting on Hamza. Four new P3s are listed at the
  end. I used Read only and modified nothing.

  Round-1 findings

  1. [P2] Recording outlived the session screen — FIXED.
     - Remount: recording is now initialised from isRecording() (participation/[id].tsx:89), so coming back shows Stop.
     - Submit: an active recording counts as pending (:100-101), which disables Submit.
     - Unmount: leaving the screen calls discardAsync() (:110). That routes the finished clip through pendingStop,
       which deletes the file (ScreenCaptureModule.kt:45-55).
     - Notification: it now has a "Stop recording" action, using an explicit, immutable PendingIntent to ACTION_STOP
       (ScreenCaptureService.kt:150-159). That gives Android 10–14 a way to stop.
     - Startup sweep: the cleanup at OnCreate keeps only RecorderBridge.currentFile (ScreenCaptureModule.kt:93-97).
     - Evidence: leave-while-recording.yaml, plus run-native.sh:22-26, which checks for no active projection after
       every flow. summary.txt shows all 8 flows at active_projections=0.
     - Sweep safety:
       - A JS reload loses the in-memory segment list anyway, so deleting a kept-but-unuploaded clip after a reload
         only removes something that could no longer be reviewed.
       - A recording that is still running is protected by currentFile.
       - A remount after a reload shows Stop, and stopAsync still works.
       - There is one module instance per JS context.
  2. [P3] Notification permission — FIXED. On Android 13+, recording asks for POST_NOTIFICATIONS first and refuses with
     "Nothing was recorded" if it's denied (:136-142). notifications-denied.yaml exercises the real OS prompt and
     checks that the capture dialog never opens.
  3. [P3] Stale wallet comments — FIXED. The comments now describe signMessages, say the wallet does no domain check,
     and note the sign_in_payload follow-up (contracts index.ts:359-373).
  4. [P3] Domain divergence — FIXED. The domain is no longer configurable (config.ts:69-70), and the variable is gone
     from .env.example.
  5. [P3] On-device file deletion not proven — NOT FIXED, accepted. The release APK isn't debuggable, so run-as isn't
     available. Deletion is covered only by the code paths.
  6. [P3] Routed-around denial — still open. It needs Hamza's acknowledgement.
  7. [P3] Untested B1/B2 items — FIXED as documentation. They're tracked as open gates in progress.md.

  New findings (P3, non-blocking)

  1. [P3] discardAsync can collide with stops already in progress. ScreenCaptureModule.kt:45-55
     - Stop then leave: if the tester taps Stop and immediately leaves, discardAsync overwrites the pendingStop set by
       stopAsync. The clip is still deleted, which is correct, but the stopAsync promise never settles.
     - System stop then leave: if a system stop lands just before unmount, isRecording() is already false, so
       discardAsync isn't called. The clip goes to onStopped with no JS listener and stays on disk until the next
       launch's sweep.
     - Fix: In discardAsync, call the previous pendingStop with null before replacing it. On unmount, also call a small
       purgeAsync() that deletes every recording except currentFile.
  2. [P3] The notification's Stop action is untested. No Maestro flow taps it, and it's the only stop path on Android
     10–14.
     - Fix: Add a flow that opens the notification shade, taps "Stop recording", and checks for the "Recording stopped"
       segment and no active projection.
  3. [P3] The S0 report wasn't updated. s0-capture-spike.md:14-24 doesn't yet include the new behaviours: the
     notification Stop action, the notification-permission refusal, and discard on leaving the screen.
     - Fix: Add rows for them that point to the new screenshots.
  4. [P3] Server checks for the final APK aren't shown. summary.txt only shows the device-side checks. The server-side
     row checks in verification.md (evidence row, wallet_links, nonce used, the 409) come from the earlier run.
     - Fix: Re-capture them for run 20261003-010504, or note that they come from the earlier run.

  The emulator-labelled gate is ready for Hamza's approval, with his acknowledgement of finding 6 included. The
  real-device S0/B1 and real-wallet B2 gates stay blocked.

✻ Worked for 56s · done 1:13 AM
```
