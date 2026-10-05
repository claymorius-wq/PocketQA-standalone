# Verdict: reputation proposal docs, review r1

- **Reviewer:** an independent, read-only subagent of the contributor session (Claude Code, `claude-opus-5-5`). This is not Hamza's `pqa-qa` pane.
- **Commit reviewed:** `45d806f` on `docs/reputation-escrow-proposal`, based on `origin/main` `87e09d4`. It changes 3 files (+732 lines) and is docs only.
- **Date:** 2026-10-05.
- **Verdict:** **CHANGES_REQUIRED**
- **Counts:** P1: 0 · P2: 10 · P3: 11

## Summary

**What checks out.**
- **Research numbers.** These match the chain and the primary sources: rent, the SIMD-0437 schedule, the cost table, Streamflow fees, the USDC mints, the Civic Pass end dates, the Seeker Genesis Token facts and the Squads audit dates.
- **Repo quotes.** The quotes from A9, B1, B2, CLAUDE.md and the plan are accurate.
- **Sample figures.** The design doc's figures for Demo Tester and Elif K. recompute exactly with `repOf`.

**What blocks the merge.**
- **Progress entry.** `progress.md` reports a review and a verification that did not exist when the commit was made.
- **Research accuracy.** The research misstates A9/B1. It also calls Squads immutable without naming a cluster, and on devnet, where the pilot would run, it is not.
- **Design accuracy.** The design doc contradicts REPUTATION.md v3 and `SAMPLE` in several places (P2-6, P2-7, P2-8, P2-10). It misdescribes the existing sheet code (P2-9), and it overstates how complete it is (P2-5).
- **Cross-doc consistency.** The two docs disagree on the badge, ranking and hold rules, and neither says which one governs.

## Findings

### P1

None.

### P2 (each blocks the merge)

**P2-1 · `docs/progress.md:18` and `:12` · The entry reports a review and a verification that were not done at commit time, and doesn't say who did the work.**

- **What's wrong.**
  - `:18` says "This PR's docs were reviewed too; the verdict is in `docs/reviews/reputation-proposal/`". That folder doesn't exist in `45d806f`, or anywhere else in the repo. This r1 review started after the commit.
  - `:18` also says the boards had "a final verification".
  - `:12` says the on-chain and fee facts "were re-checked before commit". No command output for that re-check is recorded anywhere, and it missed the devnet Squads facts (see P2-3).
  - The entry never says that the research, the boards, the critiques and the review came from subagents of the contributor session rather than from `pqa-qa`. The earlier contributor entry does say this (`:80`: "The reviewers were read-only subagents of the contributor session, not the `pqa-qa` pane").
- **Evidence.**
  - `git ls-tree -r --name-only 45d806f docs/reviews | grep -i reput` returns nothing.
  - The author and committer dates are both `2026-10-05T05:40:46+02:00`, and the reflog shows no amend.
  - The only verification artifacts are in the contributor scratchpad, under `glass/verify-rep/`. 376 of its 385 files are newer than the commit (`find -newermt '2026-10-05 05:40:46'`). The other 9 are copies of the boards and two sample dumps. Files were still being written at 06:13, during this review.
  - CLAUDE.md:13 says command evidence belongs in `docs/verification.md`.
- **Fix.**
  - Rewrite the bullet to state only what exists at the fix commit. For example: "Boards: two critique rounds (21 and 23 findings, all fixed in REPUTATION.md v3), by read-only subagents of the contributor session. Docs: review r1 CHANGES_REQUIRED, then r2, by a read-only subagent of the contributor session (not `pqa-qa`). The verdicts are in `docs/reviews/reputation-proposal/`."
  - Commit those verdicts to that folder.
  - Mention the final verification only once its result is recorded.
  - Record the RPC and fee re-check commands and their output in `docs/verification.md` or in the review folder.

**P2-2 · `docs/research/usdc-escrow-and-anti-gaming.md:313` and `:325` · §7.1 says production runs on test credits. Production has none.**

- **What's wrong.**
  - `:313`: "In both cases, production funding stays on test credits."
  - `:325`: "Only then can B1 move from test credits to funded studies."
- **Evidence.**
  - A9 (`docs/production/parent-access-actions.md:19`): "Rewards must be positive, and credits come only from the test top-up, which is disabled in production. Production builders therefore can't publish."
  - D3 (`docs/production/acceptance-ledger.md:79`): "Test-credit top-up unavailable in production".
  - B1 (`:87`) is ⛔ blocked on A9. Builders can't publish until Hamza chooses either unpaid studies (reward 0) or no publishing.
  - The research's own `:314` says production runs volunteer studies under option (a).
- **Fix.**
  - Replace `:313` with: "In both cases, production pays no rewards. Under (a), studies run at reward 0. Under (b), nothing publishes. Test credits stay off in production (D3)."
  - Replace `:325` with: "Only then could B1 be revisited for paid studies."

**P2-3 · research `:7`, `:26` and `:48` · "Null upgrade authority" and "immutable" don't name a cluster. On devnet, where the pilot would run, Squads v4 is upgradeable and runs a different binary.**

- **What's wrong.**
  - `:7`: "Squads v4 has a null upgrade authority".
  - `:26`: "immutable since November 2024 (OBSERVED [S2][S4][S6][S1])".
  - `:48`: "Upgrade authority null (OBSERVED [S1])", in the same table row that answers "Devnet: Yes".
  - Source [S1] (`:329-337`) covers both mainnet and devnet.
- **Evidence.** I ran read-only `getAccountInfo` calls on 2026-10-05 against the program data account `Fy3YMJCvwbAXUgUM5b91ucUVA3jYzwWLHL3MwBqKsh8n`. Output is in `qa-r1-evidence/rpc-check.txt` and `squads-binary.txt`.
  - **Mainnet:** no upgrade authority. The last deploy was at slot 302,582,236. The program's SHA-256 is `d4866083…bf2fac`, which equals OtterSec's `on_chain_hash` (`is_frozen: true`).
  - **Devnet:** the upgrade authority is `HM5y4mz3Bt9JY9mr1hkyhnvqxSH4H2u2451j7Hc2dtvK`. The last deploy was at slot 446,638,068. The SHA-256 is `57a8d2d7…4f2f74`, which is a different binary.
  - The same key is also the authority and the treasury of the devnet ProgramConfig.
- **Why it matters.**
  - §1 and §3 rest the design on Squads being audited and immutable in every privileged role, in a devnet v1.
  - On devnet, the code is neither the audited mainnet binary nor frozen. Pilot results there say nothing about the mainnet build, and the program can change in the middle of the pilot.
- **Fix.**
  - In all three places, say the claim holds on mainnet, and add the devnet facts under [S1].
  - In §3.5, add that devnet Squads results don't validate mainnet, so the exact mainnet binary must be re-checked before any mainnet step.
  - Correct the provenance line at `:7`.

**P2-4 · research §6.4–§6.5 vs design §2, §3, §8 and §9 · The two docs disagree on core rules, and neither says which governs.**

- **Where they disagree.** A ✓ means a §9 question already covers the point.
  - **Reliable tester.** Research `:279`: "At least 10 settled, at least 3 builders, R ≥ 0.8", where R is a Wilson score. Design `:45`: an on-time streak, with tiers 3 · 10 · 25. Design `:288` still lists "a Wilson lower bound for reliability" as a build measure, but doesn't say where it applies.
  - **Device specialist.** Research `:281`: 8 acceptances on one device *class*, from at least 3 builders, "with consistent device signals". Design `:47`: 5 accepted tests on one *device*, from at least 3 builders.
  - **Ranking.** Research `:270`: a 90-day score of R × Σ(1 or 1.5) ÷ k. Design `:215` and `:281`: the plain total of posted 90-day points. ✓ Q11 covers only the 1/k part.
  - **Identity.** Research `:224`: a Tier 1 identity signal is required for the leaderboard *and* for every badge beyond First Accepted Test. Design Q10 (`:301`) asks about the leaderboard only.
  - **First badge.** Research `:278`: earned at the "First settled acceptance". Design `:34`: earned at approval. ✓ Q1.
  - **Hold period.**
    - Research `:259-262`: points wait until the payout is finalized, the dispute windows have closed, and a 7-day *fraud hold* has passed. Research `:98`: a 72-hour dispute window after a rejection.
    - Design `:31`: "the 7-day dispute window" after an approval.
    - The repo has only one dispute window: 7 days after a *rejection*, added to stop reject-then-close abuse (`packages/domain/src/participation.ts:28-41`; `canOpenDispute` requires `status === 'rejected'`). The research's 72 hours would shorten it.
    - Q2 (`:293`) asks about this, but the design's rules and its copy (`:252`) read as if a window after approval already exists.
  - **Links.** The research never links to the design doc.
- **Fix.**
  - Add a "Research vs this proposal" table to design §8. For each item, give the proposal's choice and the reason.
  - Add a §9 question for every research rule the proposal doesn't adopt: Wilson R, device class with a threshold of 8, the weighted score, identity checks for badges, and the hold model.
  - At research §6.5, add a note that the design doc replaces these HYPOTHESIS criteria for the product proposal.
  - In both docs, state that the repo's 7-day window applies only to rejections. In the design, call its 7 days a "hold" until Q2 is decided.

**P2-5 · design `:12` and `:97` · The doc says it carries everything an engineer needs from a private spec, and that it adds no new colours. Neither is true.**

- **The spec isn't reachable.** REPUTATION.md is not in the repo, and the canvas is private (`:6`).
- **What the doc leaves out.**
  - **All of R3:** the socket, bezel, face dome, specular, cast and caustic, the unlit body, the arc gradient, the bead gradients, and the level fill and hatch.
  - **The arc-stroke row of R4.1:** gap × 0.5, at least 2, which gives 2/2/4/4.
  - **The bead slots of R4.1:** tier I sits at 4:30, tier II one step clockwise and tier III one step counter-clockwise, where a step is 1.6 beads. The doc (`:95`) puts every bead "at 4:30".
  - **The locked sink:** the doc (`:103`) says "sunk 1px" instead of `translate(max(0.5, 0.5k), max(1, k))`, and it never mentions the shadow scale k = S/56.
  - **R6 "How the run counts":** sessions count in order of final decision, an overturned rejection counts at the time of the overturn, and a session over the builder cap neither adds to the run nor breaks it.
  - **Also:** the reduced-motion wait (P3-2) and the `you` glyph (P3-4).
- **The colours.** REPUTATION.md R3 says "No new hues", which is a weaker claim than "no new colours". At least 15 of its gradient stops occur nowhere in `apps/mobile/src` or `apps/mobile/app` at `87e09d4` (`git grep -i` finds 0 hits). Examples: `#4636A6`, `#221A50`, `#E4EAFF`, `#B2A8F0`, `#6E62C8`, `#C9D8FF`, `#23204C`, `#100E2C`.
- **Fix.** Do one of these:
  - Change `:12` to say what the doc actually carries: the rules, values, timings and copy. Add that the visual recipes (R3 and R4.1) and `SAMPLE` must be added to `docs/design/` before anything is built.
  - Or add an appendix with R3, the arc-stroke row, the bead slots, the sink and k, and the run rules.

  Either way, change `:97` to: "No new hues. The medallion adds gradient stops in the existing violet and blue families. They go into the glass recipes and the contrast test."

**P2-6 · design `:106` · The "New" state contradicts REPUTATION.md v3 and the sample.**

- **The doc:** "as Earned, plus a "New" label … | none", meaning no progress arc.
- **v3 R4.2:** "as its state; its meta reads "Tier II · New" … a single-level badge reads "New" alone | as its state".
- **The code:**
  - `lens-rep.mjs:494` draws the arc whenever `state` is `locked` or `progress`, whatever `isNew` is.
  - `:637` writes "Tier II · New".
- **The sample:** the sample's own new badge is still in progress. `repOf('elif')` returns Reliable tester with `state: progress`, `tier 2`, `10/25` and `isNew: true`, so it shows an arc toward tier III.
- **The risk:** a badge built from the doc would show no arc, and it could lose its tier text (critique S-12).
- **Fix:** copy v3's New row.
  - The glass and the arc follow the badge's state.
  - The meta reads "Tier II · New", with "New" in DM Mono 500 in `primary`. A single-level badge reads "New" alone.

**P2-7 · design `:127` and `:304` · §5 misdescribes the spec change Hamza is asked to accept in Q13.**

- **The doc:** U9 amends "the rule that only balances roll (§11.5)".
- **v3 R5:** in §11.5, S3 (the Uplight rise) plays for U1–U9, and U9's lift, glint and bead seat join the signature motions. S5, the number roll, "stays U5 and U6 only".
- **DIRECTION-A §11.5 today:** S3 plays for "U1–U8 only", and S5 for "(U5, U6)".
- So the roll rule is the one thing U9 leaves alone. This doc says as much at `:146`: "The points never roll".
- **Fix.**
  - Reword `:127`: "If accepted, U9 amends DIRECTION-A.md §2 (the Uplight at nine moments), §10.2 (a U9 row) and §11.5 (S3 plays for U1–U9; the lift, glint and bead seat become signature motions; S5 stays with U5 and U6)."
  - Name `DIRECTION-A.md` explicitly, because "§2" and "§10" also exist in this doc.
  - Say that accepting U9 means an ADR, either an addendum to 0006 or a new 0007, because the Lens spec isn't in the repo.

**P2-8 · design `:141`, `:148-149` and `:167` · The U9 sequence table is broken and contradicts v3 on tier-ups.**

- **Rendering.**
  - The `| Done |` row at `:149` follows a paragraph directly, so it renders as literal pipe characters inside the Tier-ups text. The table ends at the "4200 →" row.
  - Python-Markdown with the tables extension renders 9 rows (`qa-r1-evidence/render-check.txt`). GitHub's renderer treats the line the same way, as a continuation of the paragraph.
- **Content.**
  - v3 R5 splits the 2940 row into two:
    - "First badge: the medallion lifts".
    - "Tier-up: no sink, no lift: the lit tier − 1 glass stays; the tier glass fades in over it; only the start layer casts | 320 ease-lens".
  - In the doc, the lift row (`:141`) and the React Native Lift row (`:167`) apply to every badge, and the Tier-ups paragraph never says there is no lift.
  - The Done row drops the middle duration. v3 has "240 ease-exit; 320; 700".
- **Fix.**
  - Move Done into the table after "4200 →", with "240 ease-exit; 320 (U5 → 0.45); 700 (key pool → 0.72)".
  - Split the 2940 row into v3's two rows.
  - Mark the React Native Lift row "first badge only".

**P2-9 · design `:166` and `:169-170` · The React Native mapping misdescribes the existing sheet, and departs from ADR 0006 without saying so.**

- **The sheet.** `:166` says "the existing sheet spring, with the BlurView crossfading in once it settles". The existing sheet has no blur crossfade, and on Android it has no blur at all.
  - `apps/mobile/src/ui/index.tsx:936-940` renders `GlassBlur … blur={Platform.OS !== 'android'}`. The code comment says: "A Modal is its own window: Android cannot blur the screen behind it, so it takes the solid fallback."
  - ADR 0006 (line 100) records the same rule.
  - The crossfade comes from the web boards (`lens-rep-you.mjs:120`).
- **The glint.**
  - `:169-170` say "ring mask" and "masked canvas".
  - v3 R5 and the A-Badges board say "a band under a Skia ring clip", but ADR 0006 rejected Skia.
  - The doc quietly swaps the mechanism without naming one that React Native can actually do.
- **Fix.**
  - Sheet row: "The existing `ConfirmSheet` motion (`SPRING.sheet`). `GlassBlur` blurs on iOS and web; Android takes the solid fallback inside a Modal. Nothing animates blur."
  - Glint row: "A 105° band clipped to the ring with react-native-svg `ClipPath`, as the flute does. No Skia (ADR 0006)."

**P2-10 · design `:270`, `:269` and `:251` · Three strings contradict REPUTATION.md v3 and `SAMPLE`.**

- **The level meter (`:270`).** The example reads "Level 2, Examiner. 640 points, 360 to Inspector. 150 points held until October 10."
  - No sample tester has these figures:
    - Demo Tester is at Level 1, with 0 points posted and 150 held.
    - Elif K. is at Level 3, with 1,910 points posted and 240 held.
    - 640 is Elif's 90-day total.
  - The example drops "points" after 360, which breaks the doc's own rule at `:257`. The string appears nowhere on the boards.
  - v3 R4.3 has: "Level 3, Inspector. 1,910 points, 590 points to Analyst. 240 points held until October 10."
  - This line uses `accessibilityRole="progressbar"`, while `:121` uses `role="meter"`.
- **The held chip (`:269`).** The doc reads "Plus 150 points, held until October 10." In v3 R4.3 and `lens-rep.mjs:548-555`, the chip is read as "+150 points held". The date belongs to the separate held sentence.
- **The points breakdown (`:251`).** "Accepted test 100 · Accepted finding 30 · On time 20" sits in a list headed "verbatim on the boards" (`:247`). In v3 R7 it ends "… On time 20 points" (critique S-22).
- **Fix:** use v3's strings. Choose one role for the level meter, and say how it maps to React Native.

### P3 (don't block)

**P3-1 · design `:122`, `:187` and `:265` · Example figures that aren't in the sample.**
- "Tier I · 7/10", "4 of 10 toward tier II" and "Sharp eye, locked. 2 of 3 …" appear nowhere on the boards. A grep of `lens-rep*.mjs`, `gen-a-*` and the five generated `.dc.html` boards finds 0 hits. They don't match either sample tester.
- **Fix:** use the sample's values.
  - Elif: "Tier I · 9/10" and "9 of 10 toward tier II" (Sharp eye).
  - Demo: "Sharp eye, locked. 1 of 3 accepted findings toward tier I".

**P3-2 · design `:160` · The reduced-motion wait.**
- The doc says the sheet "waits the same reading time". v3 R5 and `gen-a-badge-earned.mjs:113,151` wait 1,200 ms.
- **Fix:** write "waits 1,200 ms".

**P3-3 · design · Words and terms that read two ways.**
- **"Lit."** In the states table (`:104-105`), "lit" means lit glass. Elsewhere it means the Uplight.
  - So `:180` "hero size (96, never lit)" and `:187` "in progress or locked: unlit" read as unlit glass, for badges that are earned or in progress.
  - **Fix:** write "no Uplight".
- **Undefined terms.**
  - "The reputation line" (`:182`, `:217`) is really the sentence at `:253`.
  - U5, U6, Mode A and L-1 aren't defined in this doc, and no repo doc defines them either. ADR 0006 describes U1, U7, U8 and L1–L3, and mentions Mode A only in passing.
  - **Fix:** add a short glossary.
- **Who sees the level.** `:68` says the level shows "beside a display name", but builders never see the level (`:238`).
  - **Fix:** write "on the profile and the leaderboard".

**P3-4 · design `:112` and `:316` · The glyph count.**
- The doc says "five new glyphs". v3 R4.4 lists six, including `you` for the proposed tab, which `:175` mentions.
- **Fix:** count six, and list `you`.

**P3-5 · design §10 (`:306-317`) · Work the proposal would trigger that §10 doesn't list.**
- **The tab rename.** Renaming the tab affects e2e flows that open Settings through the `tab-settings` testID:
  - Maestro: `ios-settings.yaml`, `sign-out.yaml`, `_open-wallet.yaml`, `sheet-keyboard.yaml`.
  - Playwright: `account-delete.spec.ts`, `wallet-login.spec.ts`, `review-loop.spec.ts`.
  - **Fix:** keep the route and testIDs, or plan these updates.
- **The API route.** There is no "profile response" (`:312`). A tester's own data comes from `GET /me`, which returns `User` (`packages/contracts/src/index.ts:592`).
  - **Fix:** name that route or a new one, log it in `docs/decisions/contract-changes.md`, and consider a `ClientConfig.features` flag.
- **Export and deletion.** `POST /me/export` and `DELETE /me` must cover points, badges and leaderboard rows.
  - **Fix:** add this to §10.

**P3-6 · design §4 and §7 · Repo UI rules the proposal doesn't carry.**
- **Light theme.** CLAUDE.md requires light, dark and system themes, and ADR 0006 skips the Uplight when `glass.enabled === false`. The doc never says what the medallion and U9 do in the light theme.
- **Touch targets.** The plan (§2) and ADR 0006 (line 43) set 48 dp touch targets. REPUTATION R8 says "at least 44 tall".
- **Fix:** add a light-theme paragraph, and set targets at 48 dp.

**P3-7 · design `:68` and `:275` · A level never drops, even after an admin void.**
- A tester who colluded keeps any level reached with points that were later voided.
- **Fix:** add a §9 question: does an admin void (not a lost dispute) recompute the level?

**P3-8 · research `:316` · The reading of CLAUDE.md.**
- The research says "CLAUDE.md restricts only *mainnet* escrow". But CLAUDE.md:7 also lists "smart-contract custody", with no cluster attached. So a devnet vault program arguably needs that separate approval too, not just a plan amendment.
- **Fix:** say this in §7.1 and in approvals item 2.

**P3-9 · research §7.1 · Copy rules.**
- The plan's Copy row requires "Reward if approved · Not guaranteed", and a banned-phrase linter blocks payout and currency wording in study and reviewer text. A USDC pilot needs those rules revisited.
- **Fix:** add this to the approvals or to §7.

**P3-10 · `docs/progress.md:8`, design `:3` and `:48`, research `:27` · Where Hamza's asks come from.**
- Hamza's direction, and the quoted "no rushed custom contract" rule, have no source in the repo. His plan file isn't in the repo either.
  - **Fix:** cite the date and channel (H-direct or H-relayed, as the ledger does), and quote the preference exactly.
- Sharp eye isn't one of Hamza's four badges.
  - **Fix:** mark it "(added)", as v3 does.

**P3-11 · Nits.**
- Research `:342` (source S6) says "OtterSec Jul–Sep 2023", while `:48` says "2023/2024". The Squads docs list OtterSec audits in both years.
- Research `:400` (source S56) leaves out §5.3, which `:308` cites.
- Research `:5` quotes the plan as "no escrow"; the plan says "No escrow".
- "Not legal advice" appears only in the byline (`:3`). Repeat it at the top of §5.2.
- progress `:16` says the design "ends with the anti-gaming rules and 13 open questions". It actually ends with §10.

## What I checked and how

- **The change and its metadata.**
  - `git diff 87e09d4..45d806f --stat` (3 files, +732) and `git show 45d806f`.
  - Author and committer dates, and the reflog.
  - `git diff --check` is clean, and the working tree was clean before and after the review.
- **Repo facts at `87e09d4`,** read with `git show 87e09d4:<path>`.
  - Rules and gates:
    - CLAUDE.md lines 3, 7, 11 and 13.
    - The plan's §2 Money, Web3, UI and Copy rows, plus §5.1, §5.3, Phase 6 and §10.
    - A9 (`parent-access-actions.md:19`); B1, B2 and D3 (`acceptance-ledger.md:79`, `:87-88`); ADR 0006.
  - Code:
    - `motion.ts`: `EASE`, `DUR`, `SPRING.sheet {32, 300}`, `UPLIGHT.earned {560, 700, rest 0.45}`, `UPLIGHT.cut 180`.
    - `apps/api/src/ledger.ts` and `db.ts`: an append-only ledger with `participation_id` and `kind`.
    - `participation.ts`: `DISPUTE_WINDOW_MS`, which applies to rejections only.
    - The tester tab layout `(tester)/_layout.tsx`, where tab 4 is "Settings".
    - `SettingsScreen.tsx`.
    - `participation/[id].tsx`: U5 lights the Approved notice; U6 lights the dispute card when a rejection is overturned.
    - `ConfirmSheet` in `src/ui/index.tsx`.
    - The contracts' `GET /me`, the file `contract-changes.md`, and the e2e flows that use Settings.
  - Every quote the research attributes to these files matches. The only one that isn't word for word is the "no"/"No" in P3-11.
- **The spec and the sample.**
  - Read in full: REPUTATION.md v3.
  - Read in the relevant parts: DIRECTION-A.md §2, §10 and §11.5–11.7; `lens-rep.mjs` (`BADGES`, `POINT_RULES`, `LEVELS`, `SAMPLE`, `repOf`, `medallion`, `metaFor`, `pointsChip`, `levelMeter`, `U9`); `lens-rep-trust.mjs` (`TRUST_COPY`, `badgeLine`); the notes in `lens-rep-you.mjs`; `gen-a-badges.mjs`; `gen-a-badge-earned.mjs`; `add-rep-page.mjs`; and `canvas.json`.
  - I recomputed the figures with `repOf` (`qa-r1-evidence/rep-check.mjs` and `.txt`):
    - **Demo Tester, as of Oct 5:**
      - 1 session decided and accepted, on time.
      - 150 points held until Oct 10; 0 posted; Level 1.
      - First accepted test, marked new.
      - Not ranked: 0 of 5 posted sessions, and the board shows 239 ranked testers.
    - **Elif K., as of Oct 5:**
      - 16 sessions decided, from 6 builders: 14 accepted (1 of them overturned), 1 rejected, and 1 upheld (her lost dispute). 13 of her 14 accepted sessions were on time.
      - 1,910 points posted: Level 3 Inspector, 590 to Analyst.
      - 240 points held until Oct 10, from the Oct 3 session: 100 + 40 + 30 + 20 + 50. That session is her 10th in a row and earns Reliable tester tier II, marked new.
      - 640 points in 90 days, rank 12 of 240.
    - **Elif at review time (Oct 3, 14:30):** 13 of 15 accepted · 12 of 13 on time · 1 lost dispute. Sharp eye at tier I (8/10); Device specialist earned.
    - **Leaderboard top:** mira.k with 2,480 points; Ines W. and dev.okafor tie at rank 3.
  - Every figure the design gives for these two testers matches, except those in P2-10 and P3-1.
  - The design's 13 questions cover v3 R10, except R10.8 (canvas placement), which is internal to the design work.
  - v3's artboard note ("none is in canvas.json yet") is out of date. `canvas.json` now has the page "Next · reputation (proposal)", as the doc says. That staleness belongs to the spec, not the doc.
- **Contrast.** Recomputed against the glass colour: `text` 15.59, `text-muted` 7.78, `primary` 9.84. These match `:271`.
- **Research spot checks: 18.** The outputs are in `qa-r1-evidence/rpc-check.txt`, `squads-binary.txt` and `web-checks.txt`. The chain checks used only read-only `getMinimumBalanceForRentExemption` and `getAccountInfo`, on mainnet and devnet.
  - **Rent ✓.** A 165-byte account costs 1,488,440 lamports on both clusters. The rule (128 + bytes) × 5,080 holds at 0, 100, 200 and 300 bytes.
  - **SIMD-0437 ✓.** The rate drops from 6,960 to 696 in five steps, with steps 3–5 expected in Agave 4.4 in November 2026. Rent is refundable. Steps 1–2 explain today's rate of 5,080.
  - **Cost table ✓.** I recomputed 0.0032/0.0004, 0.0116/0.0016, 0.0149/0.0020, ≈ $1.50, ≈ $0.21, 15%, 1.6 SOL and ≈ 7×.
  - **USDC ✓.** Both mints are classic SPL Token mints (`Tokenkeg…`) with 6 decimals and a freeze authority. They match Circle's address page, and the faucet gives 20 USDC every 2 hours.
  - **Squads.**
    - Mainnet upgrade authority null ✓. Devnet ✗ (P2-3).
    - ProgramConfig creation fee is 0 ✓.
    - Squads' docs: launched October 2023, immutable since November 2024, about $10B secured ✓. The docs name no cluster, and on chain the immutability holds on mainnet only.
    - Audits ✓: four firms. Neodyme's report is dated December 10, 2024, and Certora's "Formal Verification … November 2024". I didn't check the Trail of Bits date.
    - OtterSec verify ✓: not verified, frozen.
    - Source code ✓: an empty destination list means any address, and `MAX_TIME_LOCK` is 3 months.
  - **Streamflow ✓.** 0.16 SOL plus 0.19%, on a page updated 2026-08-14. The SDK says 0.09 SOL. The program is upgradeable.
  - **Smart Account and SAS ✓.** Smart Account is upgradeable, and SAS is upgradeable on both clusters.
  - **Civic Pass ✓.** It ended on 2025-07-01 and 2025-07-31.
  - **Areta ✓.** A $1M fund with a 30% cap. Its status isn't stated, as the doc says.
  - **Kora ✓.** Audited by Runtime Verification; `main` may contain unaudited code; users can pay fees in USDC.
  - **Seeker Genesis Token ✓.**
    - It's a Token-2022 token, minted once per device into the Seed Vault, and it moves only between the owner's own accounts.
    - It's verified with SIWS plus RPC, and the mint should be stored. The device-model check can be spoofed, and there is no attestation API.
    - The group now has 121,105 members (121,104 earlier the same day), and there is no devnet group.
  - **FinCEN ✓.** The headings of §4.2.2 and §4.4 match.
- **Fit with CLAUDE.md.**
  - **Approval and Seeker rules: OK.** Both docs are devnet-first, gate mainnet behind an audit and approvals, claim no approval, take Seeker facts only from Solana Mobile's docs, and invent nothing. P3-8 and P3-9 are the exceptions.
  - **Secrets:** the repo scanner (`scanRepo`) on the clean tree at `45d806f` scanned 754 files and found nothing.
  - **Personal data:** a grep of the diff for emails, phone numbers, local paths and emoji found none. The sample names are fictional and labelled as samples.
- **Links and anchors.** Both relative links resolve, and every internal § reference exists. The only missing target is `docs/reviews/reputation-proposal/` (P2-1).
- **Hygiene.**
  - The new folders `docs/research/` and `docs/design/` fit `docs/`, and their kebab-case file names match the repo's style.
  - There are no stray files or binaries.
  - The progress entry sits newest-first and follows the contributor format. Its content problems are P2-1 and P3-11.
- **Not checked.**
  - I didn't view the boards themselves. I used the spec, the generators and `repOf` instead.
  - Web sources I didn't check: World ID, the SAS announcement, Gibwork, Superteam, Twilio, Play Integrity, the MiCA text, the Trail of Bits date, and Neodyme's Streamflow report.
  - Nothing was built or tested, because the change is docs only.

My helper scripts and their outputs are in the contributor scratchpad under `pr-review/qa-r1-evidence/`. The file `pr-review/checks-raw.txt` is the contributor's own pre-commit check, not part of this review.
