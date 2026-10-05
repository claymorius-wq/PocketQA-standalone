# Critique D1: Lens reputation boards (A-Badges, A-BadgeEarned)

Date: 2026-10-05. This was a read-only review. No board, generator, library or spec was edited.

**Boards:** `project/A-Badges.dc.html` (1200×7048) and `project/A-BadgeEarned.dc.html` (390×844).

**Measured against:** REPUTATION.md R2–R10, DIRECTION-A §2–§14, CONSISTENCY.md, and the boards Main, A-Motion, A-Credits and A-Session.

**Paths:** evidence paths are relative to `G/review-rep/`, where G = `…/scratchpad/glass`. Probe output is in `notes-probes.txt`.

## How I checked

- **Static renders:** `static.cjs`, which follows the shot.cjs pattern. A-Badges was rendered in 1200 px slices plus 2× crops.
- **Live runs:** `live.cjs` on the rep-preview support.js stand-in. It captures timed frames and also samples computed opacity and transform every animation frame, so U5/U9 timing was measured, not judged by eye.
- **Accessibility:** CDP accessibility tree, keyboard Tab and Escape, and pixel contrast measurements.
- **Glyphs:** a scratch page renders the five new glyphs beside lens-glyphs at the sizes the boards use.
- **Format:** `validate.mjs` prints PASS for both boards. There were no console errors on any run.

### What holds

- **U9 choreography:** it matches the §07 timeline.
  - U5 is out about 360 ms before U9 starts, so the two lights never overlap.
  - Every segment is between 120 and 700 ms.
  - The key pool goes 0.72 → 0.40 → 0.72.
- **Reduced motion:** the sheet waits 1200 ms and fades in over 120 ms. U9 is shown at 0.45 at once, and the final number appears at once.
- **Sheet focus:** in "Builder approves", focus goes to the title. Tab moves to Done. Escape closes the sheet and returns focus to the session title.
- **Uplight at rest:** nothing outside the sheet is uplit at rest.

**Counts:** 1 × P1 · 9 × P2 · 11 × P3.

---

## P1

### D1-01 · P1 · The badge sheet shows held points as if a balance just landed

**Where:** A-BadgeEarned, moment "Builder approves", both badges. Also A-Badges §07, both vignettes. The source is `badgeSheet()`.

**Evidence:**
- `shots/beZ-contact.png` (2×, ms after load):
  - **3420:** the "+150" line rises in empty ("+   points") about 80 ms before its digits.
  - **3560:** the digits roll at the peak of the U9 light.
  - **At rest:** it is the largest type on the sheet: Red Hat Display 26/30 in `numeral`, larger than the badge name at 22/26.
- The only sign that these points are held is 34 px lower, in 13/18 muted text.
- `shots/money-compare.png`: the sheet copies the A-Credits balance pattern: a large numeral, a muted unit, and a "can't be withdrawn" disclaimer. It uses the same Earned light and the same S5 roll, two seconds after "50 test credits added to your balance".

**Rules broken:**
- **R2.3:** held points are "shown recessed and unlit".
- **R5:** "Not lit: held points".
- **§11.5:** S5 is reserved for balances (U5, U6).
- **§14:** no flying numbers or "+" floaters.

The most visible depiction of these held points is raised, bright, prefixed with "+" and rolling at the light's peak. It reads as a second payout.

**Fix:** in `lens-rep.mjs badgeSheet()`, replace the odometer line with `pointsChip(points, { held: true, delta: true })`. That is the recessed well with an unlit bead, reading "+150 held". Drop `RP.roll` and the `lq-up6` row for held points, so U9 lights only the medallion. Amend R4.3 and R5 to match.

---

## P2

### D1-02 · P2 · A tier-up starts from a locked medallion

**Where:** A-BadgeEarned, badge "Reliable tester · tier II", moment "Builder approves".

**Evidence:**
- `shots/beT2-2900.png`: under "TIER II EARNED", the medallion uses the locked recipe for about 540 ms before U9: sunk, smoked face, muted glyph, no beads.
- `shots/beT2-contact.png`: it then lifts and lights with two beads.
- The tester already holds tier I. R4.2 draws that as lit glass with one bead, and R6 says "tiers you hold stay". The moment shows a tier the tester holds as locked, then awards it again.

**Fix:** in `lens-rep.mjs medallionMoment()`, when `tier > 1`, render the starting layer as `litBody(P, glyph, g, tier - 1)`: lit, with tier − 1 beads, no sink and no lift. Let the bead seat, the stacked ring and U9 carry the tier-up. Keep the sunk-to-lit lift for first-time badges only.

### D1-03 · P2 · Two badge glyphs are existing app glyphs with one detail changed

**Where:** both boards: A-Badges §03, §04 and §06, and the A-BadgeEarned sheet. The source is `REP_GLYPHS`.

**Evidence:** `shots/glyphpairs.png` compares each pair at a 40 medallion, a 40 tile, a 56 medallion, 26 px muted, and a 96 medallion.
- **Sharp eye:** its first part is the same almond-and-iris path as `GLYPHS.eye`, which is used for "View evidence" and "Review work".
- **First accepted test:** its tray and clip block are the same as `GLYPHS.work`, the My work tab icon.
- **What differs:** only a reticle with 1.6 ticks and a 3.6 check. At 19–27 px both details blur into a smudge.
- **Result:** a First accepted test row reads as the My work icon, and Sharp eye reads as "View evidence". Device specialist and Discover are different enough.

**Fix:** redraw `REP_GLYPHS.sharpEye` and `REP_GLYPHS.accepted` so their silhouettes are not `eye` and `work`. For example:
- **Sharp eye:** a reticle ring with four ticks around a finding pin, with no almond.
- **First accepted test:** a 4.4 check standing on a round seal plate.

Check both at 19 px beside `GLYPHS.eye` and `GLYPHS.work` before promoting them to lens-glyphs.mjs.

### D1-04 · P2 · The progress arc is lit from the bottom-left

**Where:** A-Badges §02 anatomy, §03 Locked and In progress, and the §06 shelf and rows. This affects every arc.

**Evidence:** `shots/z-anat.png` and `shots/arc240.png`.
- The arc is violet at 12–2 o'clock and palest at 7–9 o'clock. Sampled colours:

  | Position | Colour |
  |---|---|
  | 1:30 | #8A80EB |
  | 7:30 | #A7ACCF |
  | 9:00 | #C2C5F5 |
  | 10:30 | #AFAEFB |

- R3 asks for #E4EAFF at the top-left, running to #8C7BFF at the bottom-right.
- **Cause:** the `objectBoundingBox` gradient rotates with the circle's `rotate(-90)`, so it runs from bottom-left to top-right.
- The anatomy caption says "Every layer obeys DIRECTION-A §2: rims lit top-left". The arc is the one layer lit from the wrong side.

**Fix:** in `lens-rep.mjs arcHtml()`, set the linearGradient to `x1="1" y1="0" x2="0" y2="1"` (or `gradientTransform="rotate(90 .5 .5)"`). The circle's rotate(-90) then puts the pale stop at the top-left.

### D1-05 · P2 · The sample profile has an impossible history

**Where:** A-Badges §06 shelf and rows, read with the §05 meter.

**Evidence:** `shots/z-sec06.png`.
- **Shelf:** shows "First accepted test · NEW", earned Oct 3, next to:
  - Helpful feedback tier II, earned Sep 28. That needs five accepted sessions.
  - Reliable tester tier I, earned Oct 1. That needs three.
- **Rows beside it:** list Reliable tester tier II on Oct 3 and First accepted test on Oct 3.
- **Sharp eye:** "0 of 3" in the shelf but "2 of 3" in the rows.
- **Meter:** shows 640 settled points, so the first accepted test cannot be new.

Badges appear to come before any accepted work. That is the opposite of R9.1, "only approved work".

**Fix:** in `gen-a-badges.mjs shelfCard` and `rowsCard`, use one consistent tester:
- First accepted test earned Sep 12, not New.
- The newest badge (for example Helpful feedback tier II, Oct 3) is the one marked "New".
- Reliable tester and Sharp eye show the same tier and progress in both samples.

### D1-06 · P2 · A new badge row shows its points as settled

**Where:** A-Badges §06, BADGE ROW · 40.

**Evidence:** `shots/z-rows.png`. The row "Reliable tester · Tier II · Oct 3" ends in a raised "+50 points" chip with a lit bead. Points from an Oct 3 approval are held until Oct 10; the meter on the same board says "150 held until Oct 10". R2.3 and R4.3 draw held points as the recessed "+50 held" chip. This is the sample row the next screens will copy.

**Fix:** in `gen-a-badges.mjs rowsCard`, end the row with `pointsChip(50, { held: true, delta: true })`.

### D1-07 · P2 · Values that are not decided appear without the proposal label

**Where:**
- A-Badges: §01, §04 and §07.
- All of A-BadgeEarned.

**Evidence:**
- **§05 is the only labelled section** (`shots/bg-s2.png`): it carries "PROPOSAL · Values not decided".
- **§04, directly above it:** the tier thresholds are unlabelled. They are 3·10·25, 1·5·15, 5·15·40 and 3·10·30, and R10 question 5 says they are not decided.
- **§01:** the "+100 / +30" ledger is unlabelled.
- **§07:** the "+150" breakdown is unlabelled (`shots/z-vigA.png`).
- **A-BadgeEarned** (`shots/beRest-900.png`, `shots/beT2-4400.png`): shows +150 and +170, the 100 · 30 · 20 breakdown and "Ten accepted sessions", with nothing saying these are proposals.

**Fix:** in `gen-a-badges.mjs`, put the §05 `pill('Proposal', 'warning')` and "Values not decided" in the `secTitle()` right slot of §01, §04 and §07. Add "(proposal values)" to A-BadgeEarned's title when it is placed in canvas.json.

### D1-08 · P2 · Device specialist rewards volume, not quality

**Where:** A-Badges §04.

**Evidence:** `shots/z-sec04.png`.
- **Rule:** "Accepted tests on one device profile", with tiers 5 · 15 · 40.
- **No quality signal:** acceptance is the only signal.
- **Self-declared device:** the device is self-declared (R10 question 6), so tier III means "40 accepted tests on a device you said you have".
- **Effect:**
  - It is a count ladder that rewards whoever runs the most sessions on one phone.
  - It is the only badge with no quality event behind its tiers: no helpful mark, accepted finding or on-time run.
  - The section subtitle says "each rewarding quality".

**Fix:** in `lens-rep.mjs BADGES`, entry `device`, do one of these:
- Make it single-level: "5 accepted tests on one verified device", shown with the device.
- Count a quality event on that device for tiers II and III: accepted findings or helpful marks.

### D1-09 · P2 · The sheet at rest opens without moving focus

**Where:** A-BadgeEarned, moment "Sheet at rest" (the revisit case).

**Evidence:** `shots/beRest-900.png`, plus `esc.cjs` (output in `notes-probes.txt`).
- The dialog is open: aria-modal, background inert, aria-hidden="false".
- Focus stays on BODY.
- Pressing Escape straight away does nothing, because the key handler sits on the dialog.
- R8 says focus moves to the title after 60 ms. It does in "Builder approves".

**Fix:** in `gen-a-badge-earned.mjs begin()`, in the "Sheet at rest" branch, call `LQ.focus(this, [id + '-t'], 60)` after `setState`.

### D1-10 · P2 · `spokenDate()` is broken, so the level meter says "Oct 10"

**Where:** A-Badges §05 and §06 level meters, and every future caller of `spokenDate()`.

**Evidence:**
- **What the board promises:** `shots/bg-s5.png` (§10 card) says the meter will speak "…150 points held until October 10."
- **What it actually says:** the rendered `aria-valuetext` is "…150 points held until Oct 10." (`dom.cjs`).
- **Cause:** `spokenDate('2026-10-10T16:40')` returns "" for any input. The regex is `/^(d{4})-(d{2})-(d{2})/`, with no `\d`, so `levelMeter()` falls back to the on-screen date.
- **Rule:** R7 and R8 require "October 10" when spoken.

**Fix:** in `lens-rep.mjs spokenDate`, use `/^(\d{4})-(\d{2})-(\d{2})/`.

---

## P3

### D1-11 · P3 · The points odometer drops the fourth digit

**Where:** the shared `odometer()` and `RP.roll()`. Neither board shows it yet.

**Evidence:** `shots/odo.png`.
- `odometer({ value: 1000 })` renders "+100", and 1240 renders "+124".
- The odometer always has exactly three columns (`padStart(3)`) and no thousands separator.
- Today's maximum per session is about 300, but the values are not decided, and the Profile and Review screens are told to import this component.

**Fix:** in `lens-rep.mjs odometer()` and `RP.roll()`, build one column per character of `fmt(value)`, with "," as a fixed cell, instead of `padStart(3)`.

### D1-12 · P3 · The badge-row note contradicts the DOM and R8

**Where:** A-Badges §06, BADGE ROW · 40.

**Evidence:** `shots/z-rows.png`. The caption says "the medallion carries the spoken label". In the DOM, the row medallion is `aria-hidden` and the row text carries the label, as R8 requires. A designer who follows the note would add a second label, and the row would be announced twice.

**Fix:** in `gen-a-badges.mjs`, change the BADGE ROW `compCol` note to: "The text carries the meaning; the medallion is decorative (aria-hidden). A points delta may trail it, never a credit amount."

### D1-13 · P3 · The Reliable tester glyph reads as a "Y", and stroke widths are below §7.1

**Where:** both boards (shelf, rows, badge set, sheet). The source is `REP_GLYPHS`.

**Evidence:** `shots/glyphs.png` and `shots/glyphs-40x3.png`.
- `reliable` is a single 3.6 tube with no filled shape. At 19–27 px it reads as "Y" or "ψ", and it looks lighter than the solid accepted, helpful and deviceSpec glyphs.
- Stroke ("tube") widths are below §7.1:

  | Detail | Width | §7.1 |
  |---|---|---|
  | Check in `accepted` | 3.6 | 4.4 for checks |
  | Tines in `reliable` | 3.6 | 4.0 default |
  | Ticks in `sharpEye` | 1.6 | 1.7–2.6 for details |

  At 19 px the ticks are under 1 px wide.
- A 40 row puts a 19 px medallion glyph next to the 24 px glyphs used in 40 tiles.

**Fix:** in `lens-rep.mjs REP_GLYPHS`:
- Draw the tuning fork at 4.0 with a filled stem block, so it reads as an object rather than a letter.
- Set the accepted check to 4.4 and the Sharp eye ticks to at least 1.7.
- Re-check all five glyphs at 19 px.

### D1-14 · P3 · Shelf meta lines don't align

**Where:** A-Badges §06 shelf (`shelfItem()`).

**Evidence:** `shots/z-shelf.png`.
- "First accepted test" wraps to two lines, so its "NEW" label sits about 18 px below "Tier I · 7/10" and "Tier II" in the same row.
- The card's 8 px side padding leaves "Helpful feedback" nearly touching the rim. Cards elsewhere use 18 px.

**Fix:** in `lens-rep.mjs shelfItem()`, give the name a two-line block (`min-height: 36px`, meta below it) so the meta lines align across a row. Set the `shelfCard` padding in gen-a-badges.mjs to 16 px.

### D1-15 · P3 · Lone last words and split phrases

**Where:** A-Badges §01, §02, §03, §04 and §10.

**Evidence:**

| Screenshot | Bad break |
|---|---|
| `shots/z-states.png` | "Lit glass, at / rest" and "Earned, still / growing" |
| `shots/bg-s0.png` | "Only accepted work / counts" and "Held until the window / closes" |
| `shots/z-sizes.png` | "Lists, review rows, / history" |
| `shots/z-sec04.png` | "…a builder / approves." |
| `shots/bg-s1.png` | a spoken quote splits "October / 3" |
| `shots/bg-s5.png` | "150 / points" and "toward / tier I" |

**Fix:** in `gen-a-badges.mjs`:
- Add `text-wrap: balance` to `strong()`.
- Join "October 3", "150 points" and "tier I" with U+00A0 (a non-breaking space) in the spoken strings in `stateCard` and `a11y`.

### D1-16 · P3 · Matching captions sit at different heights

**Where:** A-Badges §04 cards and the §07 vignette headers.

**Evidence:**
- `shots/z-sec04.png`: the TIERS caption is one line in Sharp eye, two lines in Reliable and Helpful, and three in Device specialist. The dividers above the tier wells step down across five side-by-side cards.
- `shots/z-hdr07.png`: "FULL MOTION · U5, beat, sheet, U9" fits on one line, but "REDUCED MOTION / Meaning stays, movement goes" wraps, so the two Replay rows differ.

**Fix:** in `gen-a-badges.mjs`, give the `badgeCard` caption block a fixed two-line height (`min-height: 32px`, tag above unit), and shorten the reduced vignette's caption to a single line.

### D1-17 · P3 · Leftover dividers at the top of the §10 cards

**Where:** A-Badges §10.

**Evidence:** `shots/z-a11ytop.png`. Each of the three cards opens with a divider 6 px under its rim, because the first `a11y()` item keeps its `border-top`.

**Fix:** in `gen-a-badges.mjs a11y()`, draw the `border-top` only between items, not on the first item of each card.

### D1-18 · P3 · Dimmed ledger rows fall below 4.5:1 contrast

**Where:** A-Badges §01, "Quality, not volume".

**Evidence:** `shots/z-p2.png`. "Submitted 0" and "Recorded 40 minutes 0" are 12 px text-muted at opacity 0.62. Measured against the well, they are 3.90:1 and 4.16:1 (`contrast.cjs`). R8's own rule is text-muted, never fainter.

**Fix:** in `gen-a-badges.mjs ledgerLine`, remove the 0.62 opacity. Show the zero rows in plain text-muted, which is 8.9:1 on a well, and write the value as "nothing".

### D1-19 · P3 · Point values without the word "points"

**Where:** A-Badges §01 (leaderboard and ledger) and §05 (levels).

**Evidence:**
- `shots/bg-s0.png`: the sample leaderboard lists bare "2,480", "1,960" and "640", and the ledger shows bare "+100" and "+30".
- `shots/bg-s2.png`: the levels read "from 300", "from 1,000" and so on.
- R7 says points always come with the word "points". A bare number next to a display name reads as a score, which R7 rules out.

**Fix:** in `gen-a-badges.mjs lbRow`, `ledgerLine` and `levelRow`, add " points": for example "2,480 points" and "from 300 points".

### D1-20 · P3 · The "FULL MOTION" vignette plays reduced when the switch is set to Reduced

**Where:** A-Badges hero switch and §07 vignette A.

**Evidence:** `shots/bgMode-contact.png`. With the preview switch on Reduced, Replay on the vignette labelled "FULL MOTION" fades the sheet in at 1200 ms with no lift, glint or roll. The caption still says full motion, and the two vignettes become identical.

**Fix:** in `gen-a-badges.mjs`, bind vignette A's caption to `mode` with a new `{{mode.capA}}` hole: "FULL MOTION" or "REDUCED MOTION (preview switch)".

### D1-21 · P3 · Main still says there are eight Uplight moments

**Where:** A-Badges §07 compared with Main §10.

**Evidence:**
- `shots/main-sec10.png`: Main says "B's light from below, at eight key moments only, one per screen".
- `shots/z-hdr07.png`: A-Badges says "The ninth Uplight moment".
- DIRECTION-A also has closed lists: §2 names "the Uplight at the eight moments of §10" as the complete list of light sources, and §11.5 limits S5 to U5 and U6.
- REPUTATION.md says it "overrides nothing". A viewer going from Main to A-Badges meets a contradiction.

**Fix:**
- **Until the PO accepts U9:** change the §07 subtitle in `gen-a-badges.mjs` to "Proposed ninth Uplight moment: amends DIRECTION-A §2, §10.2 and §11.5".
- **Once it is accepted:** add the U9 row to Main §10 through `lens-board-v2.mjs`.

---

## Checked but not counted (inherited, or a renderer artifact)

- **Sheet blur:** the sheet's backdrop blur does not blur content inside the scrolling screen in this headless renderer. Elements injected outside the scroller are blurred. The notes text therefore shows sharp under Done on A-BadgeEarned. It is the same shared `sheet()` build as A-Session.
- **Inherited from A-Session's Approved state:** the staggered entrance of the notice, transfer and notes on a push arrival, and the stale meta line "Reward if approved · Not guaranteed".
- **Replay overlap:** Replay restarts U5 while the closing sheet still holds U9 at 0.45. The 0.62 backdrop hides the overlap; frozen frame `shots/bg-replay-overlap.png`.
- **Reduced motion:** U5 at 0.45 and the fading-in sheet overlap for a single 120 ms crossfade.
- **Inert specimen buttons:** the shelf buttons on A-Badges do nothing, which matches Main's convention for sample buttons.
