# Verify: the Lens reputation set (five boards), final pass before the product owner

Date: 2026-10-05. Read-only: no board, generator, module, spec or canvas file was edited. Everything I wrote is under
`G/verify-rep/` (G = `…/scratchpad/glass`). Evidence paths below are relative to `G/verify-rep/`.

**Result:** 42 FIXED · 2 PARTLY (S-06, S-13) · 0 NOT FIXED. Rules: one truth PASS, product-only phones PASS, real
phone sizes PASS. Regressions: 7, all P3. No P1 or P2 left.

## How I checked

- **Harness:** `vr.cjs` is `review-rep2/rl.cjs` (the merged pf-live + rt-live harness), with the same patched
  support.js stand-in, retargeted so it writes only to `verify-rep/live` and `verify-rep/shots`. I added these steps:
  - `at`: wait until N ms after mount;
  - `scrollShots`: screenshot every scroll position inside a phone;
  - `scroll`;
  - `ax`: the CDP accessibility tree.

  Boards are served over a local HTTP server, as the harnesses do, so no long file URLs are used. Scratch pages (glyphs,
  odometer) use `page.setContent`.
- **Runs and logs:** `runs/*.json` and `runs/*.log`. Screenshots (356) are in `shots/`.
- **Coverage:**

  | Board | What was run |
  |---|---|
  | A-BadgeEarned | 2 badges × 2 moments × full and reduced, plus Done, backdrop, Back, replay |
  | A-Profile | 12 States × full and reduced, plus 18 interaction runs: every shelf item, the hero, three track cells, the switch, every link and tab, Retry, Tab order |
  | A-Leaderboard | 8 States × 2, plus Show me, Retry (Error and Offline), Back, both hand-offs, Tab |
  | A-ReviewTrust | 8 views × 2, plus 18 transfer variants on the decided views, plus the toggle, explainer, Approve and Reject flows, Escape and Tab |
  | A-Badges | full and reduced in 12 slices of 1,100 px, the preview switch, Replay U9, the vignettes' Replay and Done, and the §06 specimens |

  A-Review and A-Session were run for comparison.
- **Probes:** these are in `probes/`.

  | Probe | What it checks |
  |---|---|
  | `light` | Uplight-coloured paint, with effective opacity |
  | `holes` | Leftover `{{…}}`, `undefined` and `NaN` |
  | `pills` | Any "proposal" or "not decided" text |
  | `layout` | Scroll metrics, pinned bars, the gap from the last content to the pin, off-phone text, clipped text |
  | `nums`, `money` | Every number with its row, and points beside money words |
  | `sheet`, `rise`, `u9trace`, `chip`, `anim` | Dialog state and focus, the rise per frame, U5 and U9 per frame, held-chip motion, running animations |
  | `dotwrap`, `lonewords` | C6 lines that end on a dot, and short last lines |
  | `pfmeasure`, `bgmeasure`, `bgshelf`, `ladder`, `arcsample` | Padding, type, meters, arc colours |
- **Format:** `node validate.mjs` printed PASS for all five boards.
- **Regeneration:** `regen.mjs` re-ran every generator against the current modules into `tmp/`. All five boards are
  byte-identical to `project/`. So there are no hand edits and no stale builds, and A-Badges §06 and §11 are current
  with lens-rep-you and lens-rep-trust.
- **Console:** no page errors and no console errors in about 160 runs. The only console output is an inherited Chrome
  accessibility warning; see "Inherited, not counted".
- **Figures:** `figs.mjs` prints `repOf` and `leaderboardOf` for Elif K., Demo Tester and the voided record. I also
  rechecked Elif K. by hand from the raw `SAMPLE`:
  - posted 1,910;
  - held 240 = 100 + 40 + 30 + 20 + 50;
  - 640 over 90 days, from sessions posting after Jul 7;
  - rank 12, with 11 rows above 640;
  - 14 of 16 accepted · 13 of 14 on time · 1 lost dispute;
  - clean runs on sessions elif-11 and elif-16;
  - Device specialist earned Jun 5;
  - Sharp eye 9 of 10.

## Findings

| ID | Verdict | Evidence (what I saw) |
|---|---|---|
| D1-01 | FIXED | The sheet shows the recessed "+150 held" / "+240 held" chip with an unlit bead, and no odometer. The `chip` probe shows it unmoved at 2.9, 3.1, 3.5 and 4.3 s. During U9 the only animations are medallion layers: lq-earn, out, lift, fade, earnu, glint (`bez-b1-5300.png`, `runs/be.log`) |
| D1-02 | FIXED | `u9trace` on the tier-up: the start layer is lit with 1 bead, no transform, opacity 1 throughout. The 2nd bead seats at about 3.43 s (`bez-b2-2870.png`, then `bez-b2-5300.png`) |
| D1-03 | FIXED | `accepted` is a round seal plate with a cut check; `sharpEye` is a reticle around a pin. At 19 px neither reads as work, eye or discover (`glyph-row-accepted.png`, `glyph-row-sharpeye.png`) |
| D1-04 | FIXED | The arc gradient is `1,0,0,1`. Sampled colours: 10:30 #D6DAFF (palest), 4:30 #988BFF (most violet), so it is pale top-left and violet bottom-right (`arcsample.js`, `bgz-arc.png`) |
| D1-05 | FIXED | §06 shelf and rows show one tester, Elif K.: First accepted test earned May 6 (not New), Reliable tester tier II New on Oct 3, Sharp eye tier I 9/10 in both, and the meter at 1,910 + 240 held (`bg-full-s3.png`) |
| D1-06 | FIXED | The §06 badge row "Reliable tester · Tier II · Oct 3" ends in the recessed "+240 held" chip (`bg-full-s3.png`) |
| D1-07 | FIXED | §01, §04, §05 and §07 carry PROPOSAL "Values not decided". A-BadgeEarned's `<title>` and its canvas title both say "(proposal values)" (`bg-full-s0/s2/s5.png`, `canvas.json`) |
| D1-08 | FIXED | §04 Device specialist is "ONCE · single level": 5 accepted tests on one device, from at least 3 builders (`bg-full-s2.png`) |
| D1-09 | FIXED | "Sheet at rest", both badges, full and reduced: focus goes to `h2#lsBe-s1-t`/`-s2-t`; Escape closes and focus returns to `#lsBe-title` (`runs/be.log`) |
| D1-10 | FIXED | Meter aria-valuetext: "…240 points held until October 10." (`bgmeasure`, `runs/pf-inter.log`) |
| D1-11 | FIXED | `odometer()` renders 1,000 → "+1,000" (4 digit columns plus a fixed comma) and 12,345 → 5 columns. `RP.roll(1240)` keys are h, t, o, d3 (`odo.png`, `odo.mjs`). No board shows it, so this was checked on the shared component |
| D1-12 | FIXED | The note reads "The text carries the meaning; the medallion is decorative (aria-hidden)…". In the DOM the row medallion is aria-hidden (`bg-full-s3.png`) |
| D1-13 | FIXED | Widths: tubes 4.0, check 4.4, ticks 2.4 (source). The fork is redrawn; see S-18 (`glyph-fork-3x.png`) |
| D1-14 | FIXED | A-Badges shelf padding is 14 16 12 16. Meta lines align within each row (3746/3746/3746, then 3882/3882). "Helpful feedback" sits 42 px from the rim (`bgshelf`) |
| D1-15 | FIXED | Every listed break is gone: "Lit glass at rest", "Only accepted / work counts", "October 3" and "tier I" kept together, "240 points held…" (`bg-full-s0/s1/s2/s8.png`). New breaks in §11 are listed as R-6 |
| D1-16 | FIXED | §04 caption blocks all sit at y 2594, 32 px tall. §07 captions are one line each (`bgmeasure`, `bgz-captions-full.png`) |
| D1-17 | FIXED | §10 cards open on "ROLE IMG", "THE SHEET" and "REDUCED MOTION" with no top divider (`bg-full-s8.png`) |
| D1-18 | FIXED | Zero rows use #AEA8CF at opacity 1 and read "nothing" (`bgmeasure`, `bgz-ledger2.png`) |
| D1-19 | FIXED | Values read "2,480 points", "+100 points", "+30 points" and "from 300 points" (`bg-full-s0/s2.png`) |
| D1-20 | FIXED | With the switch on Reduced, vignette A reads "REDUCED MOTION · Set by the preview switch" (`bgz-captions-red.png`) |
| D1-21 | FIXED | §07 subtitle: "Proposed ninth Uplight moment: amends DIRECTION-A §2, §10.2 and §11.5". Main stays unchanged until the PO accepts, as the fix allowed (`bg-full-s5.png`) |
| S-01 | FIXED | Every board derives from SAMPLE (regen is identical). Demo Tester is the canvas first-timer: Oct 3, 2:24 PM, 150 held until Oct 10, Web · Browser. Elif K. takes every established view. ReviewTrust's decided views show Oct 3 (see rule 1) |
| S-02 | FIXED | The same moment shows +240 on both A-Profile and A-BadgeEarned, with the same breakdown 100 · 40 · 30 · 20 · 50 points. The held group has "Marked helpful +40 held" and "Clean run +50 held" (`pf01…-scr-p2.png`, `be-b2` accessibility output) |
| S-03 | FIXED | The builder card has a name, 3 counts and "Device specialist · Android": no level, points or rank. The profile says "Builders see these counts and up to two badges…" (`rt1-…-full.png`, `pf01…-p1.png`) |
| S-04 | FIXED | `pills.js` finds nothing in any phone State, sheet or motion. All four `<title>`s and canvas titles carry "(proposal values)". `proposalTag`, `proposalRow` and `ann.on` are gone from the modules |
| S-05 | FIXED | A-Profile: 390×844, the tab bar pinned at 758–832 in all States, content ending 82 px above it.<br>A-ReviewTrust: 390×1360; the dock gap is 18 px, the explainer no longer overlaps, decided views end 40 px above the bottom, and every transfer variant scrolls without clipping.<br>Sheets are pinned to the viewport. The canvas pitch is 470 (`runs/*-states.log`) |
| S-06 | PARTLY | Fixed for click-opened sheets: helpful sheet translateY 488 → 0 in about 450 ms, and the hero's U9 starts after the rise (`rise`, `u9trace`). Not fixed in the "Sheet · new badge, U9" State and its Replay: the sheet sits at translateY 0 from 78 ms and U9 glows at about 940 ms on a sheet that never rose (`seeded.cjs`). See R-1 |
| S-07 | FIXED | In all five "Sheet ·" States and A-ReviewTrust's "Approve sheet", full and reduced, focus goes to the title, Escape closes, and focus returns to the opener (`runs/pf-states.log`, `runs/rt-states.log`) |
| S-08 | FIXED | Switch note: "Shows your display name, level, 90-day points and one badge. Never your email, wallet or device." §01 reads "Display names only, and a way out" with no hidden row (`bg-full-s0.png`) |
| S-09 | FIXED | Copy: "You'll appear after 5 sessions that have posted, from at least 2 builders. 0 of 5 so far." Points held counts 0, because held sessions don't count. The Tier 1 gate is R9.8 / R10.9 |
| S-10 | FIXED | The rule note is "BUILDER CAP · 3 sessions per builder in 30 days"; 1/k moved to the open questions. Its ref tag is stale (R-3) (`bg-full-s11.png`) |
| S-11 | FIXED | The card leads with "13 of 15 accepted" and sits after Evidence in the DOM and on screen (`rt-measure`, `rt1-…-full.png`) |
| S-12 | FIXED | Shelf shows "Tier II · New"; "NEW" appears alone only for First accepted test (`pf01…-p1.png`, `pf03…-p1.png`, `bg-full-s3.png`) |
| S-13 | PARTLY | Done: REPUTATION.md v3 covers five boards, R4.5, R10.9–14, R11 for both modules and an R12 v3 table; A-Badges has the §06 Screens row and §11; the R10.8 citation is fixed. Not done: `you` is not in lens-glyphs.mjs or Main §06 (grep: 0), deferred to the PO by R4.4, so CONSISTENCY G.1/G.6 is still unmet |
| S-14 | FIXED | One `trackRecord` on both boards: Red Hat Display 500 19/24, "of N" 400 19/24. Ladder tier names are DM Mono 500 12/16 (`ladder`, `rt-measure`) |
| S-15 | FIXED | The hero caption is "590 points to Analyst" only; "Held until Oct 10" appears once (`pf01…-p0.png`) |
| S-16 | FIXED | The hero is one button, "Reliable tester, tier II, earned October 3, new", and its children are aria-hidden (`aria #lsPf-hero-m`) |
| S-17 | FIXED | A-Profile shelf padding is 14 16 12 16; "Helpful feedback" sits 42 px from the rim (`pfmeasure`) |
| S-18 | FIXED | The fork is tilted 15° with parallel prongs, a handle about half the glyph's height and a round foot. Beside Y, y and ψ it reads as an object (`glyph-fork-3x.png`) |
| S-19 | FIXED | Accessible text now has pauses: "Rank 12 of 240 . Last 90 days , 640 points"; "Level 5, Principal"; "Accepted findings , tier I"; "Accepted test 100 , … points" (accessibility output in `runs/*.log`) |
| S-20 | FIXED | Sheet descriptions say "Held until October 10"; posted sheets say "Posted June 12"; group labels read "Held until October 10", "Posted September 29" and "Voided October 4" |
| S-21 | FIXED | The 0-point meters have no fill element: only the hatch on Points held, and an empty groove on New tester and in §06 (`pfmeasure`, `bg-full-s3.png`) |
| S-22 | FIXED | Every phone breakdown ends in "points". A-ReviewTrust's note reads "+40 points per mark". R7 is amended. (§11's own notes are listed as R-4) |
| S-23 | FIXED | The "Session voided" State has a neutral notice, an unlit "−130 points" reversal row, Level 3 unchanged at 1,780, no light, and a 120 ms fade only (`pf05…-p0/p2.png`) |

## The three cross-board rules

**1 · One truth: PASS.** Every seeded State on every board matches `repOf` / `leaderboardOf`.

| Figure (repOf) | A-Profile | A-Leaderboard | A-ReviewTrust | A-BadgeEarned | A-Badges |
|---|---|---|---|---|---|
| **Elif K.:** 1,910 posted, Level 3, 590 to Analyst | ✓ hero | Level 3 ✓ | (never shown) ✓ | n/a | §01 §05 §06 §10 ✓ |
| 240 held until Oct 10 = 100 · 40 · 30 · 20 · 50 | ✓ hero, activity, sheet | n/a | "until Oct 10" / "posted Oct 10" ✓ | ✓ | §05 §06 ✓ |
| 14 of 16 · 13 of 14 · 1 (today); 13 of 15 · 12 of 13 · 1 (at review) | ✓ | n/a | ✓ both | n/a | §06 ✓ |
| 640 over 90 days, rank 12 of 240, key badge Reliable II | ✓ | ✓ row and dock | n/a | n/a | §06 ✓ |
| Badges: First May 6; Reliable II Oct 3 New 10/25; Helpful I May 26 3/5; Device Jun 5; Sharp I Jun 12 9/10 | ✓ shelf and sheets | ✓ key badge | Device "Android", Sharp tier I ✓ | ✓ | §02 §03 §06 ✓ |
| Voided record: 13 of 15 · 13 of 13, 1,780, Sharp 8/10, rank 12 | ✓ | n/a | n/a | n/a | §06 §11 ✓ |
| **Demo Tester:** since Oct 2, Web · Browser | ✓ | n/a | n/a | n/a | n/a |
| 150 held until Oct 10 = 100 · 30 · 20; Level 1, 0 posted, 300 to Examiner | ✓ | n/a | n/a | ✓ | §06 §07 ✓ |
| 1/1 · 1/1 · 0; locked 1/3, 0/1, 1/5, 1/3 | ✓ | n/a | "New tester · No track record yet" ✓ | n/a | §03 ✓ |
| Not ranked, 0 of 5, 239 ranked | ✓ | ✓ | n/a | n/a | n/a |
| Submitted 2:05 PM, approved 2:24 PM | n/a | n/a | submitted 2:05 PM ✓ | ✓ | §11 ✓ |

Residuals, both P3:
- **R-2:** an in-session Approve on A-ReviewTrust stamps the wall clock.
- **R-7:** "Ten" on one board and "10" on another.

**2 · The phones show the product only: PASS.**
- `pills.js` finds no "proposal" or "not decided" text in any phone State, sheet or motion. That covers A-Profile (24 runs plus sheets), A-Leaderboard (16), A-ReviewTrust (16 plus transfers) and A-BadgeEarned (8).
- `<title>`s:
  - "A · Lens — Badge earned (proposal values)";
  - "You (proposal values)";
  - "Leaderboard (proposal values)";
  - "Builder review · trust (proposal values)".
- All four canvas titles in `project/canvas.json` end "(proposal values)".

**3 · Real phone sizes: PASS.**
- **Sizes:** the four phones are 390×844, 390×844, 390×844 and 390×1360, from data-props and canvas.json. Their content scrolls inside (scrollHeight 2558 / 1472 / 2365 / 1008).
- **Pinned:**
  - tab bar 758–832 in every A-Profile State;
  - Leaderboard dock 756–832 (738–832 when unranked);
  - A-ReviewTrust dock 1238–1348;
  - sheets bottom-pinned in the viewport.
- **Gaps above the pins:**
  - A-Profile: 82 px (the mask clearance);
  - A-Leaderboard: 62 px;
  - A-ReviewTrust: 18 px.
- `layout.js` finds no text off the phone and no clipped text. Its only "clipped" hit is the phone root's decorative key pool.

## Regressions

All are new or residual. None is P1 or P2.

| # | Sev | Board · state | Evidence | Owner to fix |
|---|---|---|---|---|
| R-1 | P3 | A-Profile · "Sheet · new badge, U9", and Replay in that State | The sheet sits at translateY 0 from the first frame (78 ms); U9's glow rises at about 940 ms. So U9 plays on a sheet that never rose, but R5 times U9 from the C4 rise. Click-opened sheets do rise (`seeded.cjs` output, `rise` probe). This is the PARTLY half of S-06 | `gen-a-profile.mjs`: in seed(), mount the sheet closed and open it like `open()` |
| R-2 | P3 | A-ReviewTrust · Established / Marked → Approve → confirm (in-session) | Shows "Decided Oct 5, 6:09 AM" (wall clock), "You can change it until Oct 12", and the Track record stays at 13 of 15. The seeded "Decided · editable" shows Oct 3, 2:31 PM, Oct 10 and 14 of 16, and A-Profile holds that same session until Oct 10 (`rti-approved.png`, `runs/rt-inter.log`) | `gen-a-review-trust.logic.js`: in decide(), stamp `SAMPLED[who].decided` and show the `after` card |
| R-3 | P3 | A-Badges §11, and REPUTATION.md | Stale notes:<br>• ReviewTrust open questions 4–6 are tagged "NEW", but REPUTATION.md now numbers them R10.10, R10.13 and R10.14.<br>• A-Profile question 6 says "A-Profile and A-Leaderboard are not in canvas.json yet (R10.8)", and REPUTATION.md says "none is in canvas.json yet". But `project/canvas.json` (05:39:45) places all five boards on page "rep" (`bg-full-s9.png`, `bg-full-s11.png`) | `lens-rep-trust.mjs` (TRUST_NOTES refs), `lens-rep-you.mjs` (PROFILE_NOTES), REPUTATION.md |
| R-4 | P3 | A-Badges §11 · the A-BadgeEarned card | Points numbers without "points": "150 held until Oct 10", "240 held with the clean run", "Every amount in both breakdowns (100, 40, 30, 20, 50)" (`bg-full-s8.png`, `bgtext`) | `gen-a-badges.mjs` (BE_NOTES) |
| R-5 | P3 | A-Profile · Points held / New tester → Device specialist sheet; A-Badges §05, §08, §11 | Lines end on a dot, which C6 forbids:<br>• "…for example Pixel 6a ·⏎Android 14." (`pfi-held-device.png`)<br>• §05 EXAMPLE "…helpful feedback 40 ·⏎…" (`bgz-example05.png`)<br>• §08 SAY "…Accepted finding 30 ·⏎On time 20 points" (`bgz-say08.png`)<br>• §11 VALUES "Helpful feedback 1 · 5 ·⏎15" (`bgz-values11.png`)<br>(`dotwrap.js`) | `lens-rep.mjs` (the plain "·" in `BADGES.device.rule`), `gen-a-badges.mjs` (§05 partsText, §08 row), `lens-rep-you.mjs` (VALUES) |
| R-6 | P3 | A-Badges §11 | The section subtitle leaves a lone last word: "…when this board is⏎generated". Several §11 notes end on short last lines: "below it.", "as praise.", "it? NEW" (`bg-full-s8/s9/s11.png`, `lonewords`) | `gen-a-badges.mjs` (secTitle note and noteHtml: balance the wrap or shorten the copy) |
| R-7 | P3 | A-BadgeEarned "Reliable tester · tier II" vs A-Profile badge sheets | The same sheet says "Ten accepted sessions in a row…" on A-BadgeEarned and "10 accepted sessions in a row…" on A-Profile (accessibility descriptions in `be.log` and `pf-states.log`) | `gen-a-profile.mjs` `bodyOf()`, or `gen-a-badge-earned.mjs` `WORD`; put one string in lens-rep |

**Unfixed item (P3):** S-13's `you` glyph promotion. `you` and the five badge glyphs stay outside `lens-glyphs.mjs` and
Main §06 (CONSISTENCY G.1/G.6), pending the PO. Owner: `lens-glyphs.mjs`, plus `lens-board-v2.mjs` for Main §06.

**Checked and clean:**

| Check | Result |
|---|---|
| Light at rest | None on any phone State. Only U5 on A-BadgeEarned's notice, U9 at 0.45 on open badge sheets, and the two §07 vignette sheets are lit. U5 → 0 by 2.63 s, U9 starts about 2.97 s, so the two lights never overlap |
| Reduced motion | Sheets fade in 120 ms with no transform; U9 is at 0.45 at once; no lift, glint or seat |
| Leftover `{{holes}}` | None |
| Dead controls | None among the controls exercised: every shelf item, the hero, track cells, switch, links, tabs, Retry, Show me, Back, toggle, Got it, Approve, Reject, Done, backdrop, Replay, and the §06 specimens |
| Escape | Closes every sheet |
| Focus on open | Every sheet takes focus |
| Points shown | Every points figure has "points", or is the R7 held chip "+N held" (spoken "+N points held") |
| Money language | No money beside points; the only hits are R7 disclaimers and the switch's privacy copy |
| §06 Screens row | Renders the real lens-rep-you and lens-rep-trust components with SAMPLE figures (byte-identical regen) |

## Inherited, not counted

- **Chrome accessibility warning.** "Blocked aria-hidden on an element because its descendant retained focus" is logged only when the accessibility tree is on (CDP). LQ `closeSheet` hides the dialog 260 ms before focus returns, and `openSheet` hides the background 60 ms before focus moves. It reproduces on A-Review (`arev-approve-click`). If it is fixed, the owner is `lens-motion.logic.js`.
- **A-Review's own light.** The U7 pilot (0.55) on the Approve sheet and U8 (0.45) on "Confirmed on devnet" match A-Review exactly. The reputation layer adds no light there.
- **Canvas-level differences:**
  - Demo Tester's consent is 1:58 PM on A-Review, but SAMPLE and A-Work have joined at 2:03 PM.
  - The evidence row reads "android · 3.2 MB" for a Web · Browser tester.
  - A-BadgeEarned's transfer was created at 4:52 PM (A-Session).
  - The approved session still says "Reward if approved · Not guaranteed".
  - The wallet ends "…sAsU" on one board and "…gAsU" on another.
  - The A-Settings stand-in shows Web · Browser behind Elif's Pixel row.
- **Stack headers.** The header scrolls with the content on A-Leaderboard and A-BadgeEarned, as it does on A-Session.
- **Sheet blur.** The sheet's backdrop blur doesn't render in headless Chromium.

## Not verifiable here

- **React Native notes:** `SPRING.sheet`, the withSequence values, and the 600 ms no-touch wait.
- **The real canvas runtime:** every render used the patched support.js stand-in, as instructed.
- **Contrast in §10:** the ratios there (15.6:1, 7.8:1, 9.8:1) were not re-measured. I only re-measured the ledger zero rows.
- **Glyph legibility:** "reads as an object" is a judgement. The renders are saved in `shots/glyph-*.png`.
