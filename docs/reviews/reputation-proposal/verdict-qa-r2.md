# Verdict: reputation proposal docs, review r2

- **Reviewer:** an independent, read-only subagent of the contributor session (Claude Code, `claude-opus-5-5`). This is not Hamza's `pqa-qa` pane.
- **Commit reviewed:** `80d9bed` on `docs/reputation-escrow-proposal`. Its parent is `45d806f` (reviewed in r1), and its base is `origin/main` `87e09d4`.
- **Date:** 2026-10-05.
- **Verdict:** **APPROVE**
- **Counts:** P1: 0 · P2: 0 · P3: 6 (all new)
- **r1 findings:** 20 FIXED, 1 PARTLY (P3-6), 0 NOT FIXED. No r1 P2 is still open.

## Summary

All ten r1 P2s are fixed, and the fixes check out against the sources:
- **Repo.** The research's A9/B1 wording now matches the repo.
- **Chain.** The Squads devnet facts match my own RPC output.
- **Spec.** The design doc matches REPUTATION.md v3 and `SAMPLE`.
- **Code.** The new code references match the code: `src/motion/sheet.ts`, the Android Modal fallback, and the `tab-settings` users.

What remains is P3 only:
- The lead's re-check file records commands that fail as written.
- One claim cites the wrong source.
- The design's animation-budget claim can't hold as the sequence is written.
- The light theme is only partly specified.
- A few component details are still only in the spec.
- Some nits.

Per the coordinator, I don't report the progress entry's missing mention of r2 and of board verification.

## r1 findings: status at `80d9bed`

| r1 | Status | Evidence |
|---|---|---|
| P2-1 | FIXED | `progress.md:10` says who did the work: subagents of the contributor session, not `pqa-qa`. `:19` drops "all fixed" and "final verification". `:14` and `:20` point to files that exist. |
| P2-2 | FIXED | research `:329` "production pays no rewards … Test credits stay off in production (the ledger's D3)"; `:343` "Only then could B1 be revisited for paid studies." |
| P2-3 | FIXED | research `:33-34`, row B `:57`, gate 10 `:140-142` and S1 `:351` now split mainnet from devnet. Authority `HM5y4mz…` and slots 302,582,236 and 446,638,068 match my RPC output. |
| P2-4 | FIXED | Design §8 table `:332-338` and Q15 `:362`. Research "Related" `:14` and the §6.5 pointer `:282`. Both docs state the rejection-only 7-day window (design `:54`, `:340`; research `:107`), and the design calls its 7 days a "hold" (`:53`). |
| P2-5 | FIXED | Appendix A (`:389-409`) holds R3, the stacked ring, the sink and k. §4 adds the arc stroke (`:110`), the bead slots (`:119`) and "no new hues" (`:121`). Appendix B (`:411-416`) holds the run rules. A few smaller details remain: new P3-5. |
| P2-6 | FIXED | Design `:130`: "as its state … "Tier II · New" … \| as its state". |
| P2-7 | FIXED | Design `:151-156`: DIRECTION-A.md §2, §10.2 and §11.5, where S3 plays for U1–U9 and S5 stays with U5 and U6. Acceptance needs an ADR. |
| P2-8 | FIXED | `:164-175` is one table: 11 rows, no stray pipes (`qa-r2-evidence/render-check.txt`). 2940 is split into first badge and tier-up (`:170-171`). Done is in the table with 240/320/700 (`:175`). The React Native Lift row says "first badge only" (`:198`). |
| P2-9 | FIXED | `:196` matches `useSheetMotion`: `withSpring(0, motion.spring.sheet)` on native and `motion.timing.sheetOpen` (420 ease-lens) on web (`apps/mobile/src/motion/sheet.ts:54`). It also matches ConfirmSheet's Android fallback (`src/ui/index.tsx:936-940`). `:201` uses a `ClipPath` glint and no Skia. |
| P2-10 | FIXED | `:312` meter text equals v3 R4.3, and the web/React Native mapping is stated. `:288` "+150 points held". `:289` ends "… On time 20 points". |
| P3-1 | FIXED | `:146` "Tier I · 9/10", `:221` "9 of 10 toward tier II" and `:306` "1 of 3" are sample values. |
| P3-2 | FIXED | `:188` "waits 1,200 ms". |
| P3-3 | FIXED | Glossary `:26-36`. `:212` and `:221` say "no Uplight". `:89` puts the level on the profile and the leaderboard, never with builders. |
| P3-4 | FIXED | `:134-140` lists six glyphs, including `you`; `:377` says six. |
| P3-5 | FIXED | `:371-373` cover `GET /me`, `contract-changes.md`, a features flag, and export and deletion. `:378-380` list every user of `tab-settings` (10 files, matching `git grep`). |
| P3-6 | PARTLY | 48 dp targets are stated (`:282`). The light theme (`:190`) defers the medallion's rendering: new P3-4. |
| P3-7 | FIXED | Q14 (`:361`); `:89`. |
| P3-8 | FIXED | Research `:333` and approvals item 2 (`:340`). |
| P3-9 | FIXED | Research `:335` and approvals item 2 (`:340`). |
| P3-10 | FIXED | Date and channel cited: progress `:9`, research `:7`, design `:5`. Sharp eye is marked "(added)" (`:61`, `:69`). Hamza's quoted words come from a relayed message I can't see; they agree with the earlier subagent briefs. |
| P3-11 | FIXED | Research `:5` "No escrow"; S6 "OtterSec 2023 and 2024" (`:360`); S56 adds §5.3 (`:418`); "Not legal advice" at §5.2 (`:210`); progress `:18` rewritten. |

## New findings

### P1

None.

### P2

None.

### P3 (don't block)

**P3-1 · `docs/reviews/reputation-proposal/research-recheck.txt:5-27` · The recorded commands don't run as written.**
- Each line shows `curl <endpoint> -d '{"method":…,"params":…}'`, with no `content-type` header, no `"jsonrpc"` and no `"id"`.
- I ran line 5 exactly as written, and the endpoint answered HTTP 415: "Invalid content-type, this application only supports application/json". With the header and a full JSON-RPC body it returns 650240 (`qa-r2-evidence/recheck-command-test.txt`).
- The recorded values are correct: every one matches my own r1 RPC output. CLAUDE.md:13, however, asks for the actual commands. A similar inexact-command evidence item was carried as a P3 in Phase 0.
- **Fix:** record the real invocation (header, `"jsonrpc":"2.0"`, `"id"`, and the node trimming step), or label the lines "abbreviated".

**P3-2 · research `:34` and `:141` · "Different binary" cites the wrong source.**
- Both lines cite "(OBSERVED [S1])". [S1] is defined as the research's own RPC queries (`:18`), and neither those queries nor `research-recheck.txt` compare program bytes. Different deploy slots alone don't prove the binaries differ.
- The proof is the hash comparison in `docs/reviews/reputation-proposal/qa-r1-evidence/squads-binary.txt`: mainnet `d4866083…`, which equals OtterSec's `on_chain_hash`, against devnet `57a8d2d7…`.
- **Fix:** cite that file next to [S1].

**P3-3 · design `:202` · The animation budget can't hold as the sequence is written.**
- The Budget row says "at most two animating SVG layers (ADR 0006)". The kit draws the Mode A under-glow as an SVG inside an animated view whose opacity follows u (`apps/mobile/src/ui/patterns/light.tsx:44-61`), and the medallion's uplit layer and the glint are SVG as well.
- At least three SVG layers animate together:
  - **3360–3920 ms:** the uplit layer, the under-glow and the glint;
  - **2400–2580 ms:** the ground pool going to 0.4, plus the U5 notice's uplit layer and under-glow fading out. The stack header's scrim pool follows the ground pool too.
- ADR 0006 records exactly this kind of overrun for sheets as a "Known excess, to measure".
- **Fix:** state it the same way, as a known excess to measure on the Seeker, or merge the uplit layer and under-glow into one SVG.

**P3-4 · design `:190` · The light theme is only partly specified (r1 P3-6 residual).**
- The doc correctly says U9 doesn't light in the light theme. But it defers the medallion itself to the future light Lens theme (`TODO(light-lens)`).
- ADR 0006's light theme exists today: `glassLight` is a set of flat fills with solid hairline rims and no shadows. If the layer ships before the light Lens theme, light-theme users would get a medallion nobody specified, and CLAUDE.md requires light, dark and system themes.
- **Fix:** specify a flat fallback now: a flat fill from the light palette, a hairline rim, no cast, caustic or specular, flat beads, a solid arc, and contrast pairs added to the contrast test. Or state that the layer ships dark-only until then, and put that to Hamza.

**P3-5 · design `:13` and `:186` · A few component details are still only in REPUTATION.md.**
- `:13` says the doc carries what an engineer needs. These details are still missing:
  - **R4.3:** `pointsChip` is 28 tall with a 9px unlit bead when held. The profile hero's level meter drops the held clause from its caption (`heldCaption: false`). The shelf is a 358 card with 16px sides.
  - **R4.5:** the switch's thumb slides 20px over 240 ms ease-lens. The Helpful mark is selected glass and never light. The reversal entry reads "−130 points" and is never red.
  - **R5 "Not lit":** the "Never lit" list (`:186`) leaves out the Helpful mark and the builder's card.
- **Fix:** add them to §4, §6 or Appendix A, or say at `:13` that component sizes and these behaviours stay in REPUTATION.md.

**P3-6 · Nits.**
- **Glossary (`:31`).** "Eight earned moments" isn't right: U1, U3 and U4 aren't earned. Write "eight moments that earn light", as DIRECTION-A §10.2 frames them.
- **Tier-up row (`:171`).** It says a tier-up adds "(one more bead, the stacked ring)", but the ring is new only at tier II, because tiers II and III both have it (Appendix A `:400`).
- **Medallion label (`:306`).** The example "Reliable tester, tier II, earned October 3" isn't Elif's label. `repOf` gives ", new" until the sheet is seen, then "… 10 of 25 toward tier III", because the badge is in progress.
- **§8 table, Device specialist (`:335`).** The "Why" reads as lowering the bar *because* the device is unverified. Say what's meant: the device-signal check is dropped until devices can be verified, and the badge stays single-level so the count can't be farmed.
- **§8 table, Identity (`:337`).** The row cites Q9, which covers the leaderboard only. Identity for badges is in Q15.
- **"Ship dark" (`:371`).** In a doc about dark and light themes this reads as a theme. Write "ship switched off".
- **Tab rename (`:378-380`).** `review-loop.spec.ts:190` and `:212` also assert the `settings-screen` testID. Keep it, or list it.

## What I checked and how

- **The change.**
  - `git diff 45d806f..80d9bed --stat`: 11 files. Three are edited docs (design, research, progress). The other eight are new review files: the r1 verdict, its six evidence files, and `research-recheck.txt`.
  - The commit message, and the author and committer dates (`2026-10-05T06:25:33+02:00`).
  - The working tree was clean when I started. During the review, another process left uncommitted edits: to the design doc and `progress.md` (the board-verification wording), plus three new `boards-*.md` files. This review doesn't cover them. Every check read `80d9bed` itself (`git show` or `git grep`), and the secret scan ran while the tree was still clean.
  - `verdict-qa-r1.md` is byte-identical to my r1 file. The six evidence files match apart from line endings: the repo has LF, my copies have CRLF.
- **Every r1 finding** was re-checked at its new lines; see the table above.
- **The design doc, read in full** against REPUTATION.md v3, `SAMPLE` and `repOf`, DIRECTION-A.md, ADR 0006, and the code it names.
  - The spec and `lens-rep*.mjs` are unchanged since r1 (file times 04:59–05:35), so my r1 `repOf` output still applies.
  - Every figure matches: 150 and 240 held until Oct 10; 1,910 posted, Level 3, 590 points to Analyst; 640 points in 90 days, rank 12 of 240; 14 of 16 and 13 of 14; 13 of 15 and 12 of 13 at review time; Sharp eye at 9/10 and Demo Tester's "1 of 3" label; "Posted May 13", which is `elif-01` + 7 days; and 2,480 for rank 1.
  - The glossary matches DIRECTION-A: §10.2 for U5–U8, §4 for "L-1 · Well", L1 and L2.
  - Appendix A matches R3 value by value. The code's extra socket gradient isn't in R3, and the doc follows R3.
  - Appendix B matches R6 and the `repOf` run logic: capped sessions are neutral, and an overturn counts at the overturn.
  - The tier-up rows match `lens-rep.mjs`. The `U9` comment and the `lq-rep-seat` keyframes give translate(−1px, −1.5px), which matches `:199`.
  - The key pool returns over 700 ms ease-lens (`gen-a-badge-earned.mjs:184`).
  - Code references:
    - `apps/mobile/src/motion/sheet.ts:6-10,48,54`: backdrop 320 ease-lens; spring on native; 420 ease-lens on web; a 120 ms fade under reduced motion; close at 240 ease-exit.
    - `motion.ts` `resolveMotion`.
    - `src/ui/index.tsx:936-940`.
    - `src/ui/patterns/light.tsx:44-61`.
    - `TabsLayout.tsx:80`: the testID is `tab-${name}`, so keeping the route keeps the testID.
    - `participation.ts:35-41`.
    - The contracts' `GET /me` and `ClientConfig.features`.
- **The research.**
  - Read the full diff and every changed passage in context.
  - `research-recheck.txt`: all its values equal my r1 RPC output: rent 650,240 and 1,488,440 on both clusters; the Squads program-data authority and slots; the USDC owner, decimals and freeze authorities. Its web summaries match my r1 web checks. Its commands don't run as recorded (P3-1).
  - Gate 10 (`:140-142`) is accurate. The binary claim's source is P3-2.
- **The §8 table.** Every "Research" cell matches the research text it summarises: §6.1 Tier 1 (`:238`), §6.4 (`:274-276`), and §6.5 (`:284-288`, `:294-297`). Every "This proposal" cell matches the design's own §3 and §8.
- **The §10 testID list.** `git grep tab-settings` at `80d9bed` finds exactly the 10 files the doc lists: 5 Playwright, counting `e2e/preview/browser-smoke.mjs`, which uses Playwright's `page.getByTestId`, and 5 Maestro.
- **Rendering.** Python-Markdown with the tables extension on both docs: the design has 10 tables and the research 5. No table line is orphaned and no pipes leak into paragraphs (`qa-r2-evidence/render-check.txt`).
- **Links.** `../design/reputation-layer.md`, `../research/…` and `../decisions/0006-…` all resolve, and every § reference resolves, including §8.3, Q1–Q15 and Appendices A and B.
- **Hygiene and rules.**
  - The repo secret scanner (`scanRepo`) on the clean tree at `80d9bed` scanned 762 files and found nothing.
  - The diff contains no emails or local paths.
  - `git diff --check` flags one blank line at the end of `qa-r1-evidence/seq.md`. That file is my verbatim extract of design lines 133–150, the last of which was blank, so it's harmless.
  - Fit with CLAUDE.md: devnet-first, gated mainnet, no approvals claimed, no invented Seeker APIs. The CLAUDE.md custody reading is fixed (r1 P3-8).
- **Not checked.**
  - Hamza's quoted words (design `:5-9`, research `:7`). They come from a relayed message that isn't in the repo or the scratchpad.
  - The boards themselves.
  - Builds and tests, because the change is docs only.

My evidence for this review is in the contributor scratchpad under `pr-review/qa-r2-evidence/`: `render-check.txt` and `recheck-command-test.txt`.
