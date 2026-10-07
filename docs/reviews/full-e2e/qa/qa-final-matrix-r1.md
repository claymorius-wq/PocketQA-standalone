# pqa-qa: FINAL MATRIX review (C) r1: feat/firebase-vercel f960f71, docs/reviews/full-e2e/results.json + checklist.md

**Input:** copied read-only to `qa-final-matrix-input/` (results-f960f71.json, checklist-f960f71.md).
**Counts:** 154 rows: PASS 117, BLOCKED 16, NOT RUN 10, NOT OFFERED 7, FAIL 3, NOTE 1.

## What holds
- **Original FAILs are kept with their fix evidence:**
  - **H-33** stays FAIL (historical), with H-34 PASS as the fix;
  - **P-13** stays FAIL, with the fix on its branch and device re-verification pending;
  - **E-24, E-25, E-27** say "Was FAIL at … → fixed by …";
  - **C-07** keeps the E-08 FAIL history;
  - **C-10** is FAIL (stale counts).
- **The stage-2 non-reproducibility CORRECTION** is on E-20, E-21 and E-23. E-27 keeps the P1-NS1 history.
- **Gates with rows:**
  - human Google login (L-04, H-07, H-08);
  - R2 CORS origin (L-09, WD-06), with WD-07..WD-11 NOT RUN behind it;
  - the Vercel preview (L-10: no protection changed; the artifact ran on loopback);
  - the scratch incident / USB API (L-11, no claim of no loss);
  - mainnet (C-11, D-07);
  - merge status (L-08: **nothing from this phase is on main**, main = daf0c85; 7bda3ce is deployed without being on main).
- **Web devnet rows WD-01..WD-05:** environment labelled precisely (loopback artifact + real devnet + "Pocket QA Test Wallet (devnet): injected by Playwright, not an extension"). WD-03 cites my readback of `23qD7jPT`.
- **The local fake-chain journey** has its own environment label.

## REQUIRED changes (the matrix isn't final until these are done)
1. **P-16 must not be PASS.** Its title claims "actual microphone speech", but its own notes say the **known-phrase protocol was NOT RUN** and the words aren't verified. Hamza's rule: narration quality is judged by speech evidence, never by audio presence.
   - **Split it:** P-16a "microphone audio present in the uploaded clip (signal level: voice-band energy)" = PASS; **P-16b "narration intelligible / known phrase" = NOT RUN** (Hamza asked not to repeat the capture).
   - Or set P-16 = NOT RUN with that note.
2. **E-28 and E-29 notes still say "pending pqa-qa's readback".** Both are **done: independent PASS.** Reference:
   - **E-28:** `devnet/qa-e28-run-r1.md` §"FRESH single-pass E-28 … PASS" (study cdda612d; 15 platform signatures, 0 outside; 20 303 480 lamports; payout/refund/fee 1/0/1/1, vault 0). Also the readbacks of attempts #2–#4, the cleanups (0213a47a PASS, 2cffc01c PASS) and the finish (227fbd36 FC-1 PASS).
   - **E-29:** `devnet/qa-e29-harness-r1.md` §"E-29 = PASS" (b3efa2ce; exactly one arbiter vote `5HFU4J8n…`, arbiter 1 / builder 0; refund and fee op ids recomputed; vault 0; combined 30 308 480 incl. the fixture).
3. **D-06 is stale.** "BLOCKED: needs explicit authorization to load and sign with the existing pilot keys" was superseded: fresh devnet operations were authorised and ran (D-08, E-28, E-29).
   - Mark it **superseded** (point to D-08 / E-28 / E-29), and don't leave it as an open BLOCKED with an outdated reason.
   - D-01..D-06 have **no `sha`**. Bind them (the SHA or date of the historic pilot artefacts they read).
4. **P-01..P-05 are stale** ("adb unauthorized"). The device was authorised (Hamza, SM02E4072811963). pqa-ios is updating them. **I'll re-check them before the final verdict.**
5. **Missing explicit rows (no hidden gaps):**
   - **(a) Real wallet integration (G-W3):** a real browser extension (Phantom/Solflare) or **MWA on the Seeker**. Status BLOCKED (human/device). State that **no scripted/injected signer evidences it** (WD-01's note isn't a row).
   - **(b) Independent custody:** status NOT OFFERED / limitation.
     - All devnet roles (platform, builder fixture, arbiter) are **test keys under one custodian**.
     - The platform key signed outside the server **only** as labelled fixture setup: `4V89zLPDyh6b` (0.05 SOL → builder), `yESeXcGYCMuc` (0.01 SOL → arbiter), plus the D-08 pilot.
     - The 2-of-3 is therefore **not** independent custody on devnet.
   - **(c) Production custom domain down:** **`https://pocketqa.optijara.ai` → HTTP 502 from Cloudflare** for `/` and `/api/health`. First seen by me ~22:49Z, **still 502 at 00:34:51Z**. `https://pocketqa.vercel.app` = 200 (dpl_DfajPV9S). An external tunnel/origin issue (the parent's). It needs a row (BLOCKED/FAIL of the custom domain), not silence.
   - **(d) Spend books vs chain:** the cap is cumulative over finalized operations (**E-28 #4 proved the refusal before signing**). But the books **over-count**: +5 213 280 lamports at 00:06Z (estimates; fail-safe).
     - Fixed by be3 c3c0c8e (true-down to the observed fee + rent), which I approved **by code review only**. **It's NOT in any artifact, and its emulator suites are NOT RUN** (they clear emulator data; the parent's halt on deletions).
     - Row: PASS (cap) + NOTE/NOT RUN (exact books).
   - **(e) P2-CS1 (client signing, original FAIL kept):** the first client signing card showed the amount and destination from the server's JSON, not the bytes (my repro: a 1-SOL System transfer accepted as "1.50 test USDC to the vault").
     - Fixed: 4cc99ac + 74f9d08 (templates), then 8e92922 (CS3 devnet read).
     - Needs a row (FAIL → fixed), in line with "retain original FAIL with fixed evidence".
6. **Environment conflation:** E-28 and E-29 use `environment: devnet`, the same label as the D-02..D-08 historic **SQLite pilot**.
   - Relabel E-28/E-29 as **"loopback-devnet-artifact (real devnet), API-driven, scripted fixture signer"**. Their deployment field already says so; the environment must too.
   - **C-08** (env devnet) should say it aggregates loopback-artifact evidence.
7. **Bind the remaining rows without a SHA:** B-01..B-07, W-02..W-06, P-01..P-05 (after update), D-01..D-06.
8. **E-20..E-27 (sha eb5ddba):** add my independent runs as evidence:
   - 12a16c5: emulator devnet* 127/127, unit 94/94;
   - the scratch merges d0ef83d (136/136) and 65fc637 (136/137, 1 flaky timeout that passes alone 11/11 ×2);
   - G-W2 LOCAL journey reproduced at 2cab74f (3/3).
   - Note that suites for c3c0c8e were not run (the halt).

## Recommended (not blocking)
- L-08 status: "NOT RUN" reads like a pending test. It's a **fact**, so use NOTE ("NOT MERGED").
- Rows should cite the P3s still open:
  - P3-W1 (signing allowed when the devnet read is unavailable);
  - P3-W2 (fee recipient not pinned client-side);
  - P3-SR1 (the spend report loads the signer);
  - P3-C1/C4, P3-T1 (flaky timeout), P3-N1 (non-monotonic audio dts).

**Verdict r1: CHANGES_REQUIRED** (items 1–7). Send the updated SHA. I'll re-check every changed row, and P-01..P-05, before the final (C) verdict.

---
# r2: feat/firebase-vercel 2d483f0 (161 rows: PASS 124, BLOCKED 12, NOT RUN 12, NOT OFFERED 8, FAIL 4, NOTE 1)
**Input copied:** `qa-final-matrix-input/results-2d483f0.json`, `checklist-2d483f0.md`. Rows added: L-12..L-16, P-03b, P-16b. None removed.

## r1 items: verified
1. **P-16:** FIXED. P-16 = signal-level PASS ("the words are NOT claimed"). **P-16b known phrase = NOT RUN**, with the reason (the capture ended before the phrase request; Hamza asked not to repeat it).
2. **E-28 / E-29:** FIXED. "readback DONE = PASS", citing my files and figures.
3. **D-06:** FIXED. Superseded by D-08 (+ E-28/E-29), with the old BLOCKED reason kept as history. D-0x bound to SHAs.
4. **P-01..P-05:** updated from P-10..P-22, with the original BLOCKED observations kept verbatim as history.
5. **Missing rows:** all added, with correct statuses:
   - **L-12** real wallet extension/MWA **BLOCKED** (G-W3; "no wallet-compatibility claim");
   - **L-13** independent custody **NOT OFFERED** (one custodian; out-of-server platform signatures listed: the D-08 pilot, `4V89zLPDyh6b`, `yESeXcGYCMuc`);
   - **L-14** `pocketqa.optijara.ai` **FAIL** (502 at 22:49Z and 00:34:51Z; vercel 200; owner = the parent);
   - **L-15** spend books: cap **PASS** + the over-count of +5 213 280 + c3c0c8e code-reviewed only, not in an artifact, suites NOT RUN;
   - **L-16** P2-CS1, original FAIL + fix evidence.
6. **Environments:** FIXED. E-28/E-29 = loopback-devnet-artifact (real devnet …), distinct from the D-0x SQLite pilot (`devnet`) and the fake-chain/emulator rows.
7. **SHAs:** every row now has a SHA. E-20..E-27 cite my independent runs (12a16c5 127/127; d0ef83d 136/136; 65fc637 136/137 + the flaky timeout).

## Remaining (small wording fixes; the content is right, the text contradicts the status)
- **M-1 C-05 (BLOCKED):** "Secure screens record black (FLAG_SECURE) needs a physical device: BLOCKED (P-01..P-03, **USB debugging unauthorized**)". **Stale:** adb has been authorised since 20:57Z. FLAG_SECURE was never exercised on the Seeker (capture paused by Hamza).
  - The reason should read "NOT RUN on the Seeker (device available; capture paused by Hamza; needs a human at the device)".
  - The row status can stay BLOCKED (human), with the corrected reason.
- **M-2 P-03b (NOT RUN):** its observed text ends "…and adb is unauthorized (P-01)". **Stale.** Replace it with the current gate (a human at the device for the OS dialogs; capture paused).
- **M-3 P-05 (PASS):** the notes still **begin** "BLOCKED (human). After authorization: …", which contradicts the status. Prefix it "HISTORY:" or move it after "Cleared 2026-10-06 ~20:57Z …".
- **Convention note (no change required):** original-FAIL rows are expressed two ways. H-33/P-13 keep status FAIL; E-24/E-25/E-27/L-16 are PASS with "Was FAIL … fixed by …". Both are explicit and evidenced, which is acceptable. The checklist header should state the convention once.

## Verdict r2
**APPROVE**, conditional on M-1..M-3 (pure wording; no status or evidence changes), plus the convention line in the header.

**Explicit gates in the matrix** (none hidden):

| Gate | Row(s) |
|---|---|
| human Google login | L-04, H-07, H-08 |
| device prompts / FLAG_SECURE / deny / interruptions | P-03b, P-19..P-21, C-05 |
| iPhone | P-04 |
| known-phrase narration | P-16b |
| R2 CORS origin | L-09, WD-06..WD-11 |
| Vercel preview | L-10 |
| optijara 502 | L-14 |
| real wallet / MWA | L-12 |
| independent custody | L-13 |
| mainnet | C-11, D-07 |
| USB API recovery decision | L-11 |
| merge to main (nothing merged) | L-08 |
| exact spend books / c3c0c8e not shipped, suites not run | L-15 |
| P-13 fix device re-verification | P-13 |

**Final binding:** my approval is of **2d483f0's matrix content** (after M-1..M-3). It doesn't approve or imply any merge.

---
# r3 (FINAL): feat/firebase-vercel fc1edc3 = APPROVE
**Verified by diff,** `2d483f0..fc1edc3` (c198d93 + fc1edc3); input copied to `qa-final-matrix-input/results-fc1edc3.json` and `checklist-fc1edc3.md`:
- **Same 161 row ids.** Only **3 rows** changed, **text fields only**:
  - **C-05** `observed`: now "BLOCKED (not exercised on the Seeker: device capture paused by Hamza; needs a human at the device)". 0 "unauthorized".
  - **P-03b** `observed` + `notes`: it ends with the current gate. The old BLOCKED text has moved under HISTORY.
  - **P-05** `notes`: it leads with "Cleared 2026-10-06 ~20:57Z …"; the old BLOCKED text is under HISTORY.
  - **Status, sha and evidence are unchanged** for all three. The counts are unchanged (PASS 124, BLOCKED 12, NOT RUN 12, NOT OFFERED 8, FAIL 4, NOTE 1).
- **The checklist header** states the original-FAIL convention: H-33 and P-13 keep FAIL; E-08, E-24, E-25, E-27, C-07 and L-16 read "Was FAIL → fixed"; NOTE is never a result.

## pqa-qa (C) verdict: APPROVE the final matrix at fc1edc3
- **Original FAILs** are kept, with fix evidence.
- **No hidden NOT RUN.** Every NOT RUN and BLOCKED row states its gate.
- **Environments aren't conflated:**
  - hosted-simulated;
  - emulator / hosted-emulator;
  - loopback devnet artifact on real devnet;
  - the historic devnet SQLite pilot;
  - local fake chain;
  - physical Android;
  - desktop browser;
  - static.
- **Explicit gates:**
  - **Human/device:** human Google login; the device prompts / FLAG_SECURE / deny / interruptions; the iPhone; the known-phrase narration; the P-13 fix re-verification on the Seeker.
  - **External:** the R2 CORS origin; the Vercel preview; the optijara 502.
  - **Scope limits:** real wallet / MWA; independent custody; mainnet.
  - **Decisions and pending work:** the USB API recovery decision; the exact spend books (c3c0c8e not shipped; suites NOT RUN under the halt); the merge status.
- **This approves the matrix content only. It is NOT a merge approval.** Nothing from this phase is on main (daf0c85). Merging needs reviewed PRs and Hamza's go, per CLAUDE.md.

---
# ADDENDUM (closeout, 2026-10-07 ~05:2xZ): pqa-qa independent readbacks after the matrix freeze
**Scope:** applies to the final matrix approved at fc1edc3 (and any closeout re-assembly). All results come from **public devnet RPC, finalized, read-only**, using my tools `qa-study-readback.mts` and `qa-e28-readback.py`, run data in `docs/reviews/devnet/qa-run-*.json`. Nothing was deleted.

## A. R2 CORS (L-09 / WD-06): VERIFIED as applied (04:57:00Z)
- Unauthenticated preflight:
  - **PUT** + content-type → 204, with ACAO echoed only for `pocketqa-devnet.vercel.app`, `pocketqa.vercel.app`, `pocketqa.optijara.ai`;
  - **GET and DELETE** → 403 from those three;
  - **an unlisted origin** → 403 for everything.
- No wildcard. Writes still need a server-presigned URL.
- CORS is bucket-wide, so these origins can preflight PUTs to `evidence/` keys too, and authorisation rests with the presigner.

## B. DESKTOP web devnet journey (WD-01..WD-10, artifact 4ee4603): PASS
- **Study `i394010d…`**, multisig `EXdAajef…`, vault `Gup11F3S…` (bound):
  - **reward** 500 000 → ATA(tester `6xofkwsc…`);
  - **refund** 550 000 → the builder;
  - **fee** 50 000 → the fee wallet.
- Each executed once, [builder, platform] (builder first), 0 failed. Fee and refund op ids recomputed. No #4. **Vault 0.**
- **Ledger:** each row exactly once with its memo.
- **Signatures:** builder 3 (= the listed votes); platform 12 on the study, 0 outside, net 15 482 880.

## C. PIXEL 7 web devnet journey (WD-11, be1 run #2 5b30ac5, artifact 4ee4603): PASS
- **Study `i85108647…`**, multisig `AnTZ2S6g…`, vault `ABDfRMVf…` (bound = ATA(vaultPda)):
  - **#1 reward** 500 000 → `Fc2R5qwK…` = ATA(`Bp8jEPny…`), memo `5975159d…`;
  - **#2 fee** 50 000 → the fee wallet, memo `34756d1d…` (**recomputed**);
  - **#3 refund** 550 000 → the builder, memo `7759542e…` (**recomputed**).
- Each **Executed** [builder, platform], 1/0/1/1/0. **#4 absent. Vault 0.**
- **Ledger readback: ok true** (25 transactions): funding `3ZvnC6dK`, reward `Lmwjzy4V`, refund `pxJqRhrn`, fee `341X3B9v`, each once with its op memo. Program data unchanged.
  - My first pass showed `ok: false` only because **my** run data lacked op ids, so the shared fee-wallet ATA matched the desktop study's fee `4UVFGdCh…` (also 50 000). With op ids it's resolved: **not a payment defect.**
- **Signatures since 05:09:30Z:**
  - **builder exactly 4** (funding `3ZvnC6dK` + votes `5cjGy5Yy` / `3w5jo6mQ` / `4S7T7kZ3`);
  - **platform 14** (create `sZ7wiTsN`, 1 ATA, 3 vault transactions, 3 proposals, votes `4rBfgqde` / `2iW6FGF9` / `76SC9vpd`, executes `Lmwjzy4V` / `341X3B9v` / `pxJqRhrn`), **0 outside, 0 failed**, net **18 810 040**.
- **Run #1's draft study `i1075c43…`:** multisig `GDDBd5fc…` `transactionIndex` 0; vault ATA `A93GMBBF…` = 0, whose only signature is its creation (`ju8PBtax`). **No transfer.** (`2XL16P2D` = its multisig create.)
- **Note:** the reward went to `Bp8jEPny…`, the **keyless** E-29 throwaway (frozen at consent from the tester's linked wallet). Those 0.50 devnet test USDC are **permanently unspendable** (no value; no link change, by design). This is not a defect. Future synthetic testers should link a recoverable fixture wallet.
- WD-11 is a **mobile viewport (Pixel 7 emulation), NOT a physical-device MWA test.**

## D. c3c0c8e / dc01238 (L-15)
- be2: an isolated in-memory emulator, scratch merge 234b291 (races 783fa87 + adapter dc01238): **150/150**.
- **dc01238 APPROVED** by my code review: P3-SR1 fixed (pubkey-only cost reader); the arbiter CLI refuses an underfunded key in the dry run and `--send`.
- **Still in no served artifact.** Exact-books behaviour is unproven on live devnet.

## Closeout verdict (pqa-qa)
- **G-W1 CLOSED:** a browser UI on **real devnet**, desktop **and** Pixel 7 viewport, each settled exactly once, vault 0, independently verified.
- **The final matrix stays APPROVED** (fc1edc3) with this addendum. WD-01..WD-11 = PASS as evidenced above, and L-09/WD-06 are no longer blocked.
- **Still open by design (unchanged):**
  - **L-12** real wallet extension / MWA;
  - **L-13** independent custody;
  - **L-04** human Google login;
  - **P-03b, P-13 (fix re-verification), P-16b, P-19..P-21** device/narration;
  - **L-10** Vercel preview;
  - **L-14** optijara 502;
  - **L-15** exact books not shipped;
  - **L-11** the USB API decision;
  - **L-08** nothing merged to main;
  - **C-11 / D-07** mainnet out of scope.
- **This is not a merge approval.**
