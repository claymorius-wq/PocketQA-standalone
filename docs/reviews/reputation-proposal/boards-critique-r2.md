# Critique S: the Lens reputation set (five boards, reviewed as one set)

Date: 2026-10-05. Read-only review: no board, generator, module or spec was edited.

**Boards:** `A-Badges` (1200×7261), `A-BadgeEarned` (390×844), `A-Profile` (390×3044), `A-Leaderboard` (390×1439), `A-ReviewTrust` (390×6463), all in `G/project/`.

**Measured against:** REPUTATION.md (R1–R12), DIRECTION-A, CONSISTENCY, research §6 (`rep-research/escrow-report.md`), and the canvas boards they must sit beside (Main, A-Settings, A-Review, A-Credits, A-Session, A-Work).

**Paths:** evidence paths are relative to `G/review-rep2/`. Screenshots are in `shots/`. Measurements and computed accessibility output are in `notes-probes.txt` and `pf-focus.txt`.

## How I checked

- **Live renders:** `rl.cjs` merges rep-preview's `pf-live.cjs` and `rt-live.cjs`, with the same support.js patch, so screens are not left inert after a sheet. Every board was rendered in every State and view, with tall boards cut into 1,100 px slices.
  - Interactions were scripted: shelf, hero, track record, switch, Show me, Escape, Done, Tab.
  - Measurements were run in the page: light at rest, gaps and overflow, the sheet's position per frame, running animations.
- **Accessibility:** CDP accessibility tree (`ax.cjs`) and Playwright aria snapshots.
- **Glyphs:** `glyphs.mjs` renders the redrawn glyphs and the new `you` glyph at the sizes the boards draw them, beside the app glyphs and the letters they could be read as.
- **Format:** `validate.mjs` passes all five boards. No run logged a page error, console error or warning.

### What holds

- **Light:**
  - Nothing is uplit at rest except U5 on A-BadgeEarned's notice, and U9 on the open sheet's 120 medallion.
  - U5 hands over before U9 starts.
  - The key pool is 1 at rest, 0.72 while lit, and 0.4 behind sheets.
  - The leaderboard and the builder screen add no light.
- **Arithmetic within each board** matches R6:
  - A-Badges' sample tester: 640 points + 150 held, Level 2.
  - A-Profile Established:
    - 1,550 = 11 × 100 + 10 × 20 + 30 + 3 × 40 + 2 × 50.
    - Last 90 days: 640.
    - 950 to Analyst.
  - A-Profile Points held: 150 held, Level 1.
  - A-ReviewTrust's hidden total: 2,380, Level 3.
  - Tier counts are right.
  - Leaderboard levels are plausible, and ties use competition ranking.
  - Every board posts held points exactly 7 days after its own approval date.
- **Held points:** recessed and unlit everywhere, hatched in the meter, never rolled. The level never moves on held points.
- **Money language:** none near points. No currency shares a points row or chip. No forbidden copy (R7) appears in any phone UI.
- **Shared builds:**
  - Medallion sizes: 40, 56, 96 and 120.
  - The same `pointsChip`, `levelMeter`, `stackHeader` and C3 `tabBar` everywhere.
  - The `you` glyph reads as part of the lens-ring family at 26 px, lit and muted.
  - The redrawn `accepted` and `sharpEye` no longer read as `work`, `approve`, `eye` or `discover` at 19 px.
- **Accessibility:**
  - The switch has role switch with checked.
  - The helpful mark has aria-pressed, plus aria-disabled when read-only or off.
  - Shelf buttons carry labels and aria-haspopup.
  - Dialogs are aria-modal and labelled.
  - The meter's aria-valuetext speaks "October 10".
  - Opening a sheet by click moves focus to its title. Escape and Done return focus to the opener.
  - Reduced motion leaves only 120 ms fades.
  - Small text uses tokens at 4.8:1 or better.

**Counts:** 3 × P1 · 10 × P2 · 10 × P3.

---

## The three cross-board rules (items 1–3)

1. **One tester, one truth.**
   - Add one sample history to `lens-rep.mjs`, and derive every count, total, level, tier, held/posted split and 90-day figure from it.
   - **Demo Tester** stays what the canvas already says: a first-time tester with one session, Demo: checkout flow, approved Oct 3 and held until Oct 10.
   - Every established view uses a second named tester.
   - The clean run counts the Reliable tester run, so a tier-II or tier-III session always carries the +50.
2. **Proposal labels.**
   - Phone screens show the product only.
   - "(proposal values)" goes in the canvas title and `<title>` of every board that shows an undecided value.
   - The per-value "Proposal" tags live in the board notes on the system board.
   - A-Badges keeps its section-head pills.
   - If reviewers want pills on the phones, use one shared tweak, off by default, on all four phone boards.
3. **Board layout.**
   - Each phone board is one phone at its parent's size:
     - 390×844 for tester screens, like A-Settings and A-Credits;
     - 390×1360 for the review fork, like A-Review.
   - Content scrolls inside the phone. Sheets, docks and tab bars pin to that viewport, and states come from the State tweak.
   - Notes and open questions move to a new **A-Badges §11 "Screens"**, one card per phone, and to REPUTATION.md R10.
   - The phones join the canvas rows at the existing 470 px pitch.

---

## P1

### S-01 · P1 · "Demo Tester" has five incompatible histories

**Boards:**
- A-Profile, Established (the default state).
- A-ReviewTrust, every view.
- A-Leaderboard, Ranked.
- A-BadgeEarned, both badges.
- Against the existing A-Work, A-Credits, A-Session, A-Review and A-Settings.

**Evidence:** `shots/ev-one-truth.png`, which composes `pf-est-s0`, `rt-est-s0`, `lb-scrolled`, `rt-dec-edit-s2`, `cr-after`, `wk-seed`, `st-full`, `pf-est-s1` and `be-first-4800`.

| Where | Demo Tester's record |
|---|---|
| Existing canvas | One session (Demo: checkout flow), joined Oct 3, 2:03 PM. Approved Oct 3 (A-Review); +50 test credits at 4:40 PM (A-Credits). Device profile: Web · Browser (A-Settings) |
| A-BadgeEarned | That session is the **First accepted test** (+150 held until Oct 10), which agrees with the canvas. The other badge option makes it the tenth on-time session in a row |
| A-Profile, Established | "Tester since May 2", 12 accepted, 11 of 12 on time, Level 3, 1,550 points + 150 held. The checkout flow is session 12. Sharp eye is locked at 2 of 3. Device: "Pixel 6a · Android 14", and that row opens A-Settings, which shows Web |
| A-ReviewTrust | The same submission (Oct 3, 2:05 PM) carries 16 accepted, 15 of 16 on time and **Sharp eye tier I**. It is decided **Oct 5**, 2:24 PM (A-Review: Oct 3), so its "points post Oct 12" (A-Profile: held until Oct 10) |
| A-Leaderboard | Rank 12 of 240, 640 points, Level 3 |
| A-Badges | §01 shows "You · hidden 640 points" for a Level 2 tester. §06's "established tester" has 2,310 points |

Each board's arithmetic is correct on its own. Together they give one name, one study and one date, but four point totals, two approval dates and two device profiles. The product owner cannot tell what the product would show.

**Fix:** export one sample history from `lens-rep.mjs` (`SAMPLE`: sessions with date, builder, device, on time, findings, helpful mark and status), with helpers that compute every figure.
- `gen-a-profile`, `gen-a-leaderboard`, `lens-rep-trust` (TESTERS) and `gen-a-badge-earned` read from it.
- Demo Tester keeps the canvas story:
  - A-Profile's New tester state shows Oct 2, and Points held shows Oct 5.
  - A-Leaderboard shows "Not ranked yet".
  - A-ReviewTrust shows the New tester card.
- The established states take a second named tester.
- `gen-a-review-trust.logic.js` DECIDED goes back to A-Review's Oct 3 decision.

**Owner:** `lens-rep.mjs`.

### S-02 · P1 · The same badge moment is worth +150 on one board and +170 on another

**Boards:** A-Profile, states "Sheet · new badge, U9" and the revisit. A-BadgeEarned, badge "Reliable tester · tier II".

**Evidence:** `shots/ev-clean-run.png`, which composes `pf-sh-revisit-full` and `be-t2-4700`. Both sheets show "Tier II earned · Reliable tester" for Demo: checkout flow, held until Oct 10.

| Board | Points | Breakdown |
|---|---|---|
| A-Profile | +150 | Accepted test 100 · Accepted finding 30 · On time 20 |
| A-BadgeEarned | +170 | Accepted test 100 · On time 20 · Clean run 50 |

**Cause:** R6 defines two runs.
- Reliable tester counts on-time accepted sessions in a row.
- The clean run counts "5 accepted sessions in a row" and says nothing about late ones.

So in A-Profile's history (session 2 was late), the clean runs fall on sessions 5 and 10. The session that completes the 10-in-a-row Reliable run is session 12, and it gets no +50. A-BadgeEarned gives the clean run to the tenth on-time session.

**Two further gaps on the same session:** on A-ReviewTrust, the builder files a finding on this session (+30), and the decided views mark its feedback helpful (+40).
- A-BadgeEarned's breakdown has neither.
- A-Profile's held group has no "Marked helpful +40 held" row.

**Fix:** in R6 and `lens-rep.mjs` POINT_RULES, define the clean run as "every 5th session of your Reliable tester run (accepted, on time, no lost dispute)". A tier-II or tier-III session then always includes +50. Derive both breakdowns from the one session record (S-01).

With A-Profile's current history, the consequences are:
- The clean runs fall on sessions 7 and 12.
- Session 12 holds 200 (100 + 30 + 20 + 50), or 240 if the helpful mark stands.
- The posted total becomes 1,500, and the 90-day total changes with it.

**Owner:** `lens-rep.mjs`, with REPUTATION.md R6.

### S-03 · P1 · Builders see every tester's level (a points band), counts and device-named badges, and the tester is never told

**Boards:**
- A-ReviewTrust: Established, Marked, the decided views and Rejected.
- A-Profile: every state.
- A-Settings (existing).

**Evidence:**
- **The builder card:** `shots/rt-est-s0.png` shows:
  - "Demo Tester · Level 3 · Inspector";
  - three counts;
  - "Device specialist · Pixel 6a".
- **Level is a points band:** Level 3 means 1,000–2,499 points (R6).
  - The board's own open question calls it "a coarse view of points" (`shots/rt-est-s4.png`, Q1).
  - Its reason for hiding points ("they would bias the review toward whoever already leads") applies to level too.
- **Nothing tells the tester:** nothing on A-Profile (`shots/pf-est-s0.png`, `shots/pf-est-s1.png`) says builders see any of this. The hide switch covers only the leaderboard.
- **The device:** A-Settings (`shots/st-full.png`) promises the device profile is "Used only to match you with studies". The card shows the device model to every builder.

**Fix:**
- In `lens-rep-trust.mjs` testerCard:
  - drop the level (keep the counts);
  - show Device specialist with its device class, not the model, until R10.3 and R10.6 are decided.
- In `gen-a-profile.mjs`, add one line under Track record: "Builders see these counts and up to two badges when they review your work."

**Owner:** `lens-rep-trust.mjs`.

---

## P2

### S-04 · P2 · Proposal pills sit inside the product UI, are built two ways, and are read aloud

**Boards and states:**
- **A-Profile:** the Reputation, Badges, Points activity and Leaderboard heads, plus every badge, progress and info sheet.
- **A-Leaderboard:** the "Last 90 days" head and the Not ranked dock.
- **A-ReviewTrust:** the Findings head, where the pill cannot be hidden.
- **The other two boards, for comparison:**
  - A-BadgeEarned has no pills and carries "(proposal values)" in its title.
  - A-Badges has them in section heads.

**Evidence:** `shots/pf-est-s0.png`, `shots/pf-sh-revisit-full.png`, `shots/lb-unranked.png`, `shots/rt-est-s1.png`.
- **Count:** four pills sit on the You screen at once, and a fifth sits in every sheet.
- **Two builds:**
  - `lens-rep-you` gates its pills behind a "Proposal labels" tweak that defaults to on.
  - `lens-rep-trust`'s `proposalTag` has no gate.
- **The badge sheet differs by board:** A-Profile adds a pill row under the held line; A-BadgeEarned and A-Badges do not.
- **Read aloud as product content:**
  - The locked and progress sheets' dialog description ends "STATUS: PROPOSAL Values not decided" (`notes-probes.txt`).
  - The Not ranked pill sits inside the dock's role="status".
- **The canvas title:** `add-rep-page.mjs` titles A-BadgeEarned "Reputation · Badge earned (U9)". That drops the "(proposal values)" REPUTATION.md requires.

**Fix:** apply rule 2.
- Delete `proposalTag`, `proposalRow`, `labelled()` and the `ann.on` tweak from `lens-rep-you.mjs`, and `proposalTag` from `lens-rep-trust.mjs`.
- Add "(proposal values)" to the three phone titles and to `add-rep-page.mjs`.
- Move the tags to the notes.

**Owner:** `lens-rep-you.mjs`.

### S-05 · P2 · The phone boards are not phones: tall screens with notes strips leave holes, clip content and put sheets mid-board

**Boards:**
- A-Profile: 2346 phone + 698 notes.
- A-ReviewTrust: 2624 phone + 3839 notes.
- A-Leaderboard: 844 phone + 595 notes.
- A-BadgeEarned: 844 phone, no notes.

**Evidence:** from `notes-probes.txt`.

**A-ReviewTrust:**
- **Empty band above the Decision dock:**
  - 173 px in Established, Marked and Approve sheet;
  - 373 px in New tester (`shots/rt-new-bottom.png`);
  - 207 px under the Rejected notice.
- **Overlap:** in First-use explainer, the Add-a-finding card runs 6 px under the dock (`shots/rt-expl-bottom.png`).
- **Clipping:** any transfer tweak overflows the decided screen by 133–203 px and cuts the U8-lit row (`shots/rt-tx-confirmed.png`).
- **Sheet position:** the Approve sheet lands at y 2290 of 6463 (`shots/rt-approve-full.png`).

**A-Profile:**
- **Sheet position:** sheets sit at y 1774–2370 of 3044, under 1,500 px of dimmed screen (`shots/pf-board-sheet.png`).
- **Empty phone:** 323 px of empty phone above the tab bar for a New tester, and 1,477–1,499 px in Error and Loading (`shots/pf-loading-board.png`).

**The notes, and the canvas row:**
- A-Profile and A-Leaderboard use `notesStrip`.
- A-ReviewTrust's own 3,839 px strip has a 40 px title, a second State switcher and five numbered sections.
- A-BadgeEarned has no notes. No existing canvas phone has notes.
- `add-rep-page.mjs` would place boards 7261, 844, 3044, 1439 and 6463 px tall side by side.

**Fix:** apply rule 3.
- `gen-a-profile.mjs`: set PHONE_H to 844, with A-Leaderboard's `lsLb-scroll` scroller.
- `gen-a-review-trust.mjs`: keep A-Review's 1360 phone and its dock.
- Delete the notes strips, and the duplicate switcher, from `gen-a-profile`, `gen-a-leaderboard` and `gen-a-review-trust`. Move their content to `gen-a-badges.mjs` §11.

**Owner:** `gen-a-profile.mjs` and `gen-a-review-trust.mjs`.

### S-06 · P2 · A-Profile's sheets appear without the C4 rise, so U9 starts on a sheet that never moved

**Boards and states:** A-Profile, every sheet opened from the hero, the shelf or a track record cell.

**Evidence:** `notes-probes.txt`, section SHEET RISE.
- **A-Profile:** the dialog's transform is identity from the first sampled frame (66 ms).
- **A-ReviewTrust, for comparison:** the Approve sheet rises from 356 px to 0 over about 520 ms.
- **The rule:** C4 and §11.4 say sheets rise over 420 ms (ease-lens), and R5 times U9 from that rise (sheet + 540 ms). On A-Profile, only the backdrop fades.
- **Cause:** `gen-a-profile.mjs` mounts the sheet's markup (`sv.*`) in the same render that opens it (`which` and `LQ.openSheet` in one tick). The closed `translateY` is never painted.

**Fix:** in `open()`, set `which` first, then call `LQ.openSheet` inside `LQ.later(this, …, 34)`. Alternatively, keep every sheet mounted and hidden, as A-BadgeEarned does.

**Owner:** `gen-a-profile.mjs`.

### S-07 · P2 · Sheets opened by a State selection get no focus, and Escape does nothing (D1-09 again, on new boards)

**Boards and states:** A-Profile, all five "Sheet ·" states. A-ReviewTrust, "Approve sheet", where the fork inherits A-Review's mount logic.

**Evidence:** `notes-probes.txt`, section FOCUS.
- **The dialog is open:** it is aria-modal and the background is inert.
- **Focus stays on BODY:** pressing Escape leaves the sheet open, because the key handler sits on the dialog.
- **The rule:** R8 says focus moves to the title after 60 ms, "also when the sheet is shown at rest".
- **A-BadgeEarned, for comparison:** its "Sheet at rest" does this correctly.

**Fix:**
- In `gen-a-profile.mjs`, call `LQ.focus(this, [<sheet>-t], 60)` after opening a sheet from the State tweak (in `componentDidMount` and `sync`).
- In `gen-a-review-trust.logic.js`, do the same in `componentDidMount` when `V.sheet` is set.

**Owner:** `gen-a-profile.mjs`.

### S-08 · P2 · The leaderboard's privacy copy misstates what is public

**Boards and states:** A-Profile, the Leaderboard switch in every state. A-Leaderboard notes. A-Badges §01.

**Evidence:**
- **A-Profile's switch note** (`shots/z-pf-lb.png`): "Show me on the leaderboard · Only your display name and level are shown."
- **What a row actually shows** (`shots/lb-z-rows.png`): also 90-day points, a rank and a key-badge medallion.
- **A-Leaderboard's notes** say "this screen promises display name and level only".
- **A-Badges §01** (`shots/bg-s0.png`):
  - It titles the principle "Private by default", but the switch defaults to shown (R10.4 is still open).
  - Its sample ranking includes "You · hidden 640 points". A-Leaderboard's Hidden state leaves the hidden tester out of the list (`shots/lb-hidden.png`).

**Fix:**
- In `gen-a-profile.mjs`, change the switch note to "Shows your display name, level, 90-day points and one badge. Never your email, wallet or device."
- In `gen-a-badges.mjs` p5:
  - retitle the principle "Display names only, and a way out";
  - drop the hidden row from the sample.

**Owner:** `gen-a-profile.mjs`.

### S-09 · P2 · The leaderboard threshold quotes the research but drops its anti-Sybil parts

**Boards and states:** A-Leaderboard, Not ranked yet and Empty. A-Profile, Points held and New tester.

**Evidence:** `shots/lb-unranked.png`, `shots/pf-held-s1.png`, `shots/pf-new-s1.png`.
- **What the boards say:** "You'll appear after 5 approved sessions from at least 2 builders." Both notes strips call this "a threshold from the research".
- **What the research says (§6.5):** "Tier 1, at least 5 settled submissions, and at least 2 builders". In §6.1, Tier 1 means one strong identity signal.
- **What the boards drop:**
  - They count approved sessions, held ones included. Points held shows "1 of 5 so far" for a session held until Oct 10.
  - They drop the Tier 1 identity gate, which is the research's defence for the leaderboard. R9 does not mention identity at all.

**Fix:**
- Copy and count: "5 sessions that have posted, from at least 2 builders". Count posted sessions only.
- Add the Tier 1 identity question to R9.8 and R10.

**Owner:** `gen-a-leaderboard.mjs`, with the `gen-a-profile.mjs` row copy.

### S-10 · P2 · A-ReviewTrust's notes propose a 1/k pair weight that no other board applies

**Boards:** A-ReviewTrust notes §03, against A-Badges §09, A-Profile's info sheet, and R6 and R9.3.

**Evidence:**
- **A-ReviewTrust** (`shots/rt-est-s4.png`): "PAIR WEIGHT … The k-th approval from the same builder weighs 1/k", under a Proposal tag.
- **Everywhere else, the rule is a cap:** R9.3, A-Badges §09 "Builder cap" (`shots/bg-s5.png`) and A-Profile's Accepted-sessions sheet (`shots/pf-sh-tacc.png`) allow 3 sessions per builder in 30 days, each at a flat +100.
- **The totals are flat sums:** A-Profile's 1,550 and A-ReviewTrust's own 2,380 add flat values; neither applies 1/k.

**Fix:** in `gen-a-review-trust.mjs` §03, state R9.3's cap as the rule. Move "diminish points per builder–tester pair (research §6.3 and §6.5)?" to the open questions.

**Owner:** `gen-a-review-trust.mjs`.

### S-11 · P2 · The builder's track record leads with volume, hides rejections, and sits above the evidence

**Boards and states:** A-ReviewTrust, every view. A-Profile, Track record.

**Evidence:** `shots/rt-est-s0.png`.
- **Volume first:** the first figure is "16 accepted sessions".
- **No denominator:** "15 of 16 on time" and "0 lost disputes" are measured against accepted work only. A tester with 16 accepted out of 40 submitted reads the same as one with 16 out of 16. Rejections that stood appear nowhere.
- **The rules:** R2.2 says "quality, not volume". Research §6.5 measures reliability as accepted ÷ (accepted + upheld rejections + no-shows).
- **Position:** the card sits between the status block and the evidence, so the builder reads it before the work.

**Fix:**
- In `lens-rep-trust.mjs` testerCard, lead with "16 of 18 accepted" (accepted out of decided sessions).
- In `gen-a-review-trust.mjs`, move the card below Evidence.

**Owner:** `lens-rep-trust.mjs`.

### S-12 · P2 · A new badge's tier is shown only by its beads

**Boards and states:**
- A-Profile shelf, Established: Reliable tester tier II, marked New.
- A-Badges §06 shelf: Sharp eye tier I, marked New.

**Evidence:** `shots/z-pf-shelf.png`, `shots/bg-s3.png`.
- **What is drawn:** the meta line reads "NEW" where it would read "Tier II" or "Tier I". At 56 px, the beads are 4 px.
- **R8:** "Nothing depends on light, colour or beads alone: the tier … always written."
- **A-Badges §10:** "The tier is always written".
- The aria-label carries the tier, but a sighted user cannot read it.

**Fix:** in `lens-rep.mjs` `metaFor()`, when `isNew` render "Tier II · New", with "New" in primary. Use "New" alone only for single-level badges.

**Owner:** `lens-rep.mjs`.

### S-13 · P2 · The spec and the system board describe two boards; the set has five

**Boards:** REPUTATION.md, A-Badges §06, lens-glyphs and Main §06.

**Evidence:**
- **REPUTATION.md covers two of the five boards:** its Artboards list, R4.3, R10, R11 and R12 cover only A-Badges and A-BadgeEarned.
  - A-Profile, A-Leaderboard, A-ReviewTrust, `lens-rep-you.mjs` and `lens-rep-trust.mjs` appear in one import sentence (line 13).
- **Never specified:**
  - the You tab replacing Settings;
  - the switch;
  - the track record;
  - the helpful mark's rules (editable until the points post, cleared on reject);
  - the leaderboard threshold;
  - the key-badge rule;
  - the four new open questions.
- **A-Badges §06** (`shots/bg-s3.png`) shows four components. The phones use about ten more:
  - `switchRow`, `statCell`, `activityRow`, `lbRow`, `progressSheet`, `infoSheet` and `tierLadder` from `lens-rep-you`;
  - `testerCard`, `badgeLine` and `helpfulToggle` from `lens-rep-trust`.
- **The `you` glyph** is a tab glyph defined in `lens-rep-you.mjs`. It is not in `lens-glyphs.mjs` and not on Main §06 or A-Badges, which breaks CONSISTENCY G.1 and G.6.
- **A citation error:** A-Profile's notes cite R10.7 for canvas placement. It is R10.8.

**Fix:**
- REPUTATION.md v3:
  - add the three artboards;
  - add R4.5 for the new components;
  - add R10 questions 9–12;
  - add R11 entries for both modules;
  - add a v3 row to R12.
- A-Badges §06: add a "Screens" row of the new components (`gen-a-badges.mjs`).
- Promote `you` into `lens-glyphs.mjs`.

**Owner:** REPUTATION.md.

---

## P3

### S-14 · P3 · One readout, two builds, both off the type scale

**Boards:** the A-Profile and A-ReviewTrust track records, and A-Profile's progress sheets.

**Evidence:**
- **A-Profile** (`shots/pf-est-s0.png`): numerals in Red Hat Display 28/32, "of 12" at 16/20, labels at 13/17.
- **A-ReviewTrust** (`shots/rt-est-s0.png`): numerals at 22/26, "of" in Instrument Sans 14.
- **The type scale:** neither size is in DIRECTION-A §5.
- **Tier ladder:** the labels "I II III" are DM Mono 10 px (`shots/z-ladder.png`). The type scale's smallest size is 12.

**Fix:**
- Build one `trackRecord(P, counts, { interactive })` in `lens-rep.mjs`, used by both boards, with one numeral size.
- Set the tier ladder labels to the 12/16 label style.

**Owner:** `lens-rep.mjs`.

### S-15 · P3 · The hero says "held until Oct 10" twice

**Boards and states:** A-Profile, Established and Points held.

**Evidence:** `shots/pf-est-s0.png`. The meter caption reads "950 to Analyst · 150 held until Oct 10". About 16 px lower come the "+150 held" chip and "Held until Oct 10, when the dispute window closes…".

**Fix:** give `levelMeter` an option that drops the held clause from its caption (keeping the hatch), and pass it from the A-Profile hero.

**Owner:** `gen-a-profile.mjs`, with that option added in `lens-rep.mjs`.

### S-16 · P3 · The hero badge is announced twice

**Boards and states:** A-Profile hero, every state.

**Evidence:** `pf-focus.txt` (aria tree).
- First, the button: "Reliable tester, tier II, earned October 3, new".
- Then the visible text: "Latest badge Reliable tester Tier II earned Oct 3 New".
- R8 says one announcement, never two.

**Fix:** in `hero()`, make the whole top row the button, labelled with `medalLabel`, and aria-hide the visible text inside it.

**Owner:** `gen-a-profile.mjs`.

### S-17 · P3 · The shelf card has 8 px sides on A-Profile (a D1-14 regression)

**Boards and states:** A-Profile, Badges, every state.

**Evidence:**
- **Rendered** (`shots/z-pf-shelf.png`): "Helpful feedback" and "Device specialist" end about 13 px from the rim.
- **Source:** `gen-a-profile.mjs` uses padding `12px 8px 10px`. A-Badges' `shelfCard` was fixed to `14px 16px 12px`.

**Fix:** in `shelf()`, set the padding to `14px 16px 12px`.

**Owner:** `gen-a-profile.mjs`.

### S-18 · P3 · The redrawn tuning fork still reads as a "Y"

**Boards:** every place the glyph appears: the hero, the shelf, the leaderboard's key badges and the sheets.

**Evidence:**
- **The glyph sheet** (`shots/glyphs.png`, first row): at 19 px (40 row), 27 px (56), 46 px (96) and 26 px in a tile, it sits beside the letters Y and ψ and reads as them.
- **The leaderboard** (`shots/lb-z-rows.png`): the rows for mira.k and You.
- **D1-13's goal is not met:** the goal was "reads as an object rather than a letter". The stem block is short and the tines dominate.

**Fix:** in `REP_GLYPHS.reliable`:
- lengthen the handle to about half the glyph's height and give it a round foot;
- tilt the fork about 15°;
- recheck at 19 px.

**Owner:** `lens-rep.mjs`.

### S-19 · P3 · Separator dots glue words together in accessible text

**Boards:**
- A-Profile: the leaderboard link and the activity rows.
- A-Leaderboard: the rows.
- A-ReviewTrust: the card.
- Every badge sheet.

**Evidence:** `notes-probes.txt`.
- "Last 90 days640 points"
- "Level 5Principal"
- "Demo TesterLevel 3Inspector"
- "Accepted findingstier I"
- "Accepted test 100Accepted finding 30On time 20"

A-ReviewTrust's notes promise "Demo Tester, Level 3, Inspector".

**Fix:** in `lens-shared.mjs` `sep()`, add a visually hidden ", " after the aria-hidden dot.

**Owner:** `lens-shared.mjs`.

### S-20 · P3 · Held and posted dates are spoken "Oct 10" in the sheets and the hero

**Boards:**
- A-Profile: the held row, the Points activity group labels, and the badge and posted sheets.
- A-BadgeEarned.
- A-Badges §07.

**Evidence:**
- **The badge sheet** (`ax.cjs`): its dialog description reads "Held until Oct 10, when the dispute window closes".
- **The rule:** R7 and R8 ask for "October 10" when spoken.
- **Elsewhere this is done correctly:** A-ReviewTrust's caption speaks "Points posted October 12", and the meter's valuetext speaks the full date too.

**Fix:**
- In `badgeSheet()`, render the date as an aria-hidden "Oct 10" plus a screen-reader-only `spokenDate(heldIso)`, as `helpfulCaption` does.
- In `lens-rep-you`, make `dateT()` do the same; `groupLabel` and A-Profile's `heldRow` use it. Update `postedSheet`'s pattern to match the new `badgeSheet` markup.

**Owner:** `lens-rep.mjs`.

### S-21 · P3 · The level meter lights a stub at 0 points

**Boards and states:** A-Profile, New tester and Points held. A-Badges §06, the 0-point meter.

**Evidence:** `shots/z-meter-new.png` shows "0 points" with a lit sliver at the start of the groove, because the fill is `max(0.02, …)`.

**Fix:** in `levelMeter()`, set fill to 0 at the level floor.

**Owner:** `lens-rep.mjs`.

### S-22 · P3 · Point values without the word "points" in the sheet breakdown

**Boards:** A-BadgeEarned, A-Profile's sheets, A-Badges §07, and A-ReviewTrust's notes.

**Evidence:**
- **The badge sheet** (`shots/be-first-4800.png`):
  - The breakdown reads "Accepted test 100 · Accepted finding 30 · On time 20".
  - The chip next to it reads "+150 held".
  - None of these four point values carries the word "points". It appears only in the reputation line below.
- **R7 contradicts itself:** it asks for "points" "in ledgers … too", and also lists this exact breakdown as a verbatim string.
- **A-ReviewTrust's notes** (`shots/rt-est-s5.png`) say "+40 per mark".

**Fix:**
- In `badgeSheet()`, end the breakdown with " points", and amend R7's verbatim string to match.
- Write "+40 points per mark" in `gen-a-review-trust.mjs`.

**Owner:** `lens-rep.mjs`.

### S-23 · P3 · The void and reversal state is promised but drawn nowhere

**Boards:** A-Profile (info sheet), against R9.2 and R5.

**Evidence:**
- **The promise** (`shots/pf-sh-tacc.png`): "If an admin voids a session, it leaves this count, with its points and badge progress."
- **What it should look like:**
  - R5 calls for a plain notice with no motion beyond 120 ms.
  - Research §6.4 calls for an append-only ledger with reversal entries.
- **What exists:** no board draws a voided state, and Points activity has no reversal row.

**Fix:** in `gen-a-profile.mjs`, add a "Session voided" state:
- a neutral notice;
- an unlit reversal row in Points activity;
- the level left unchanged.

**Owner:** `gen-a-profile.mjs`.

---

## Checked, not counted (inherited or a renderer artifact)

- **Sheet glass:** it does not blur content inside the scroller in headless Chromium, as D1 noted.
- **Inherited from A-Review and A-Session:**
  - "Reward if approved · Not guaranteed" on an approved session;
  - the truncated wallet reads "…sAsU" on A-Session and A-BadgeEarned but "…gAsU" on A-Review and A-ReviewTrust;
  - A-Review decides at 2:24 PM, but A-Credits credits at 4:40 PM;
  - the LQ Escape handler sits on the dialog.
- **Sheet titles:** they read in uppercase because of `text-transform` on the kicker.
- **Settings rows:** A-Profile's Settings rows open A-Settings with its own "Settings" tab active. The board's notes declare A-Settings a stand-in.
