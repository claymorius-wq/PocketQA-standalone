# pqa-qa: full-E2E challenge r1

**Read:** `docs/reviews/full-e2e/` at `8d390f5`: README rules, the 4 part files (**89 rows**: 49 PASS, 25 BLOCKED, 8 NOT RUN, 5 NOT OFFERED, 2 FAIL; no duplicate ids), `economics.md`, and the E-08 bug.

## Rows I verified independently (I agree)
- **L-03 (Google UI, live):** re-run on `dpl_TRefQGTd`, with the bundle bound to `a9d0e7e` and the headers equal to the build (`qa-google-button-r1.md` r4).
  - **Correction for the row:** Chromium logs 2 console errors after the click ("Cross-Origin-Opener-Policy policy would block the window.closed call."). They're third-party and benign, but the row shouldn't claim "0 console errors" after a click.
- **E-08 (FAIL, then fixed):** fix `31c2141` reviewed and **APPROVED** (`qa-e08-fix-review-r1.md`). SQLite 13/13; on my emulator ports, the harness 16/16 and minted 0. Once deployed, flip it to PASS (fixed) with the deployment id.
- **E-12 and H-28 / H-29 (authz):** match my own live runs (65 routes × 5 forged credentials all refused; admin self-promotion denied server-side; private routes redirect).
- **H-19 (R2 CORS):** matches my preflight (vercel.app and optijara.ai 204; foreign origin 403).
- **B-01…B-07 (desktop recorder):** consistent with my screen-recording verdicts (fd22f01 / efbc18e).
- **L-05 / `economics.md`:** the claims I checked against source are correct.
  - `MAX_TOPUP = 10_000` (`ledger.ts:23`; contract `TopUpBody.max(10_000)`);
  - `POCKETQA_ESCROW_FEE_BPS` default **1000** (`config.ts:266`);
  - fee `Math.ceil(reward × bps / 10000)` per test (`escrow.ts:58`);
  - `production && settlement !== 'off'` refused (`config.ts:245`);
  - the copy "test credits (no cash value)" is now on sign-up, Credits, participation and study (L-06).

## Challenges (please act)
**CH-1: pqa-be1 has 17 rows BLOCKED "on email verification" when authorised verified accounts already exist.**
- **Affected rows:** H-09 … H-27, except H-07 / H-08 (verification and reset completion, which really need an inbox) and the admin half of H-23.
- **Why they can run:** the parent has **already authorised** two labelled synthetic accounts with verified emails:
  - **tester:** `qa-hosted-synthetic-tester-20261006@example.test`, uid `NaALbDGF…`;
  - **builder:** `qa-hosted-synthetic-builder-20261006@example.test`, uid `7c5FLttB…`;
  - credentials 0600 in `~/.config/pocketqa/`.
- **What I've already shown with them, live:** sign-in, role routing, persistence after reload, a > 4.5 MB browser upload, finalise, private playback (`X-Amz-Expires=300`, sha match), cross-user 404, and sign-out and switching. So login, role persistence, profile/device, study draft and edit, top-up and publish, eligibility, join, consent, notes, upload, playback, submit, approve and reject, reputation, close and refund, settings and export are all **runnable** on hosted with these two accounts.
- **What's needed:** re-run these rows with them, or mark them NOT RUN with that reason, not BLOCKED. "BLOCKED" should mean that no authorised route exists.
- **Data note:** the runs add labelled synthetic production data. That's already accepted for this pair; record it in `progress.md` as before.

**CH-2: lead rows C-02 … C-09 are NOT RUN.** These are the deck slides, checked statically. Each needs PASS, FAIL or NOT OFFERED with a source reference. `economics.md` already identifies overstatements on slides 01, 03/04, 08 and 10. Convert those into C-row verdicts (C-01 and C-11 are NOT OFFERED; C-10 is FAIL, which I agree with).

**CH-3: E-05 retry semantics (P3, UX).** An approve that crashed after commit, retried with the **same** `Idempotency-Key`, gets **409** (the handler re-runs and the domain guard answers) instead of a 200 replay. The invariant holds (one credit). But R12 classes approve as G, so 409 on retry is "correct" for G. The app must treat that 409 as "already approved" and refresh, not show an error. Please confirm what the UI does, or add a row for it.

**CH-4: D-06 / P-01…P-04 (physical and devnet) BLOCKED: agreed,** with the reasons as stated (a human at the device; key-load authorisation; an iPhone and its provisioning). **No emulator result may stand in for them.**

**CH-5: binding evidence to deployments.** Rows bound to `dpl_GAmo…` (frozen at `7beaad5`) and rows bound to `dpl_TRefQGTd` (`a9d0e7e`) are mixed. Once E-08 (`31c2141`) deploys, the hosted rows that touch disputes, close or decide need a re-run or an explicit statement that the API diff is limited to `repo/studies/*` (the dispute guards).

**Assembly:** run `assemble.py` again after CH-1 and CH-2. I'll re-check the result and the counts.

## r2: re-check at `9807df9` (92 rows: 70 PASS, 11 BLOCKED, 6 NOT OFFERED, 3 FAIL, 2 NOT RUN)
**CH-1, CH-2 and the L-03 correction: done** (my r1 read was an older snapshot).

**Checks I ran:**
- every `evidence` path exists, except L-03's, which points at **my** worktree;
- `check:secrets` passes (1256 files, no findings);
- `grep` over `full-e2e/evidence/` finds no ID tokens (JWT pattern), no `X-Amz-Signature` values and no API-key patterns;
- the live entry is still `entry-d9b5472d…`, consistent with the lead's statement that `dpl_GPVC` (`31c2141`) is API-only.

**Still open:**
- **CH-6: five PASS rows have no evidence file:** **H-05, H-15, H-17, H-20, H-29.** The README says every row needs evidence under `evidence/<agent>/`. These rows quote exact values (for example H-20's 31,457,280 bytes and sha `da127…`, and H-17's participation id), so attach the command output or screenshots behind them. H-15 is `static`, so a file/line reference is enough. Until then I can't verify them.
- **CH-7: L-03's evidence** points at my worktree path. Copy `qa-google-button-r1.md` into `docs/reviews/firebase-vercel/` on the branch (it isn't there yet) and reference that copy.
- **C-07 FAIL** depends on E-08. Once be2 flips E-08 with live evidence on `dpl_GPVC`, re-evaluate C-07. **C-10 FAIL** stays (stale counts; admin not grantable on hosted).
- **C-02 NOT RUN** (framing, no executable claim): **accepted** as worded.
- **H-31 NOT RUN** (wallet escrow on hosted would link wallets to the shared accounts): **accepted** pending the lead's decision. If it's approved, prefer a **third** labelled synthetic builder over changing the shared pair.
- **CH-3 / CH-5** (H-32 / H-33 on `dpl_GPVC`): pending be1. **My P3 production check** is accepted as a gap for Hamza (no authorised admin read).
