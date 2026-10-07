# Incident: session scratch deleted under /private/tmp/claude-501 (2026-10-07)

Reported by pocketqa-lead. Facts below are first-hand reads; inferences are marked as such.

## What happened
- ~2026-10-06T23:42Z (≈01:42 local): the session scratch directories of several agents disappeared at once:
  - `/private/tmp/claude-501/-Users-hamzadiaz-Projects-pocket-qa/da661565-…/scratchpad` (lead);
  - pqa-qa's `…/e1acf907-…`, pqa-be1's and pqa-be2's scratchpads.
- `~/Library/Caches/ms-playwright` was removed at the same time; free disk went from ≈2.4 GiB to 28 GiB, later 63 GiB.
- No team agent ran the deletion; each one reported its last deletion as earlier, and literal-path only.
- **Who ran it is NOT identified yet.** Inference: a broad disk cleanup outside this team. The parent is asked to identify it.

## Live USB API (Hamza's local data)
- PID 28574 (`apps/api` from `.worktrees/native-voice`, port 8787) kept running and answers `/health` ok. Its data dir was `…/da661565-…/scratchpad/nv-api-data/` (deleted).
- `lsof -p 28574` shows it still holds OPEN handles to the deleted `pocketqa.sqlite` (fd 14, 532480 B), `pocketqa.sqlite-wal` (fd 15, 358472 B) and `pocketqa.sqlite-shm`. The current data exists only inside that process.
  - **Do not stop or restart PID 28574** until a recovery decision is made. Stopping it releases the inodes.
- Its `media/` files were not held open (not in lsof), so they are gone from local disk.

## Backups and archives (verified read-only, 2026-10-06T23:5xZ)
- `~/.local/share/pocketqa/backups/20261006T000054Z/` (outside /private/tmp; untouched):
  - `pocketqa.sqlite` sha256 `3501bc9e96436b10b58ba843509ff670dff08354ca61bfdf698429fbede610e3` = recorded = the migration snapshot. `PRAGMA integrity_check` = ok.
  - Counts: users 77, studies 39, participations 30, evidence 11, ledger 154. The Seeker evidence row `4aef8a84-…` is present.
  - `media/`: 11 files, all OK against `media.sha256`.
- The hosted copy (the real migration of that snapshot, 2026-10-06): the Firestore `evidence/4aef8a84-…` doc exists, and its R2 object `evidence/4aef8a84…` is present (HEAD size 27178114 bytes).
- **Possible loss (not verified):** any local writes made AFTER 2026-10-06T00:00:54Z exist only in PID 28574's open database. The lead's read-only integrity read of the live DB at ~16:0xZ on 2026-10-06 showed users 77 / evidence 11, equal to the backup, so no new evidence had been added by then. Sessions, audit rows or other writes after that can't be verified from outside the process. No claim of "no loss" is made.

## Recovery plan (decision: Hamza/parent)
1. Keep PID 28574 running; nobody touches it.
2. Option A (safest, no process change): restore the verified backup into a DURABLE data dir (for example `~/.local/share/pocketqa/usb-api-data/`), and point a NEW API process at it on another port for checking; switch the Seeker's `adb reverse` only after Hamza confirms.
3. Option B (to capture post-backup writes): a consistent online backup taken by the running process itself, which would need code/debugger access to PID 28574. It is invasive; only with Hamza's explicit approval.
4. From now on, no live data dir in a session scratchpad (lead memory recorded).

## Collateral in this team
- The lead's E-28 launcher/run files were lost and rebuilt in `~/.local/share/pocketqa/e28` (0700).
- Every committed evidence/run.json (feat/devnet-races `docs/reviews/devnet/evidence/pqa-be2/`) is intact.
- pqa-be1's copy of the Seeker clip download is lost (re-downloadable from the private evidence).
- The HALT on all deletions (parent order) is in force for every agent.

## Related, the web desktop run (separate from the cleanup)
- Under the lead's decision B, made before the parent's override arrived, pqa-be1's run disconnected the SYNTHETIC devnet tester account `pqa-e2e-devnet-tester-1@example.test` from a throwaway devnet key `2bV3iDXY…Cz9q` (one `DELETE /api/wallet` 200 at 2026-10-06T23:54:27.866Z) and linked the tester fixture `6xof…PBs`. No user account or user wallet was involved. Per the override, no further link changes will be made.
