# Reputation layer: design proposal (Lens)

**Status: proposal, not a decision.** Contributor design, 2026-10-05. No code, API, contract or data changes.

**Where the request came from.** Hamza's message of 2026-10-05, relayed by claymorius-wq, asked for points, badges and a leaderboard. In his words:
- "Points: earned reputation—not cash or a promised token."
- "Badges: First Accepted Test, Reliable Tester, Helpful Feedback, Device Specialist."
- "Leaderboard: useful feedback and reliability—not just the number of submissions."
- "Reward honest findings, including negative feedback."

His plan (`docs/plans/wallet-escrow-rewards-leaderboard.md`) isn't in the repo yet, so this proposal waits for it. Every point value, threshold and level name below is **a proposal, not decided**. The product questions are in §9.

**What this document carries.** The rules, values, timings, copy, behaviour and visual recipes (Appendix A) an engineer needs to build the layer. The boards themselves are on the design canvas "Pocket QA Glass" (private; claymorius-wq shares access), on the page **"Next · reputation (proposal)"**:
- `A-Badges`: the system board;
- `A-BadgeEarned`: the badge moment in context;
- `A-Profile`: the tester's "You" tab;
- `A-Leaderboard`;
- `A-ReviewTrust`: the builder's view.

The canvas spec is the Lens reputation addendum (`REPUTATION.md` v3, beside the Lens spec `DIRECTION-A.md`). Neither file is in the repo.

**Related**
- [ADR 0006](../decisions/0006-lens-visual-system.md): the Lens visual system this builds on.
- [`docs/research/usdc-escrow-and-anti-gaming.md`](../research/usdc-escrow-and-anti-gaming.md): the money side, and the anti-gaming research. §8 says where this proposal follows it and where it differs.

## Glossary

| Term | Meaning |
|---|---|
| Key light | Lens's one fixed light, from the top-left of the screen (ADR 0006). The **key pool** is its glow on the ground. |
| Uplight, U1–U8 | A second light, from below, at eight earned moments of the Lens spec. Here: **U5** lights the Approved notice and the credits balance; **U6** lights a dispute overturned in the tester's favour; **U7** lights a builder's Approve or Publish sheet; **U8** lights a devnet transfer confirmed. **U9** is the moment this document proposes. |
| Mode A | The Uplight is carried by its subject (a card, notice or medallion) and glows from under it. |
| L-1, L1, L2 | Lens glass levels: a recessed well; a card; raised glass. |
| Lit glass, unlit glass | Glass drawn with or without the key light's rim and caustic, as earned vs locked badges are. This is not the Uplight. |
| Held, posted | Points earned by approved work but still in the hold (recessed and unlit), and points that count toward the level. |
| The reputation line | "Points are reputation, not cash. They can't be withdrawn, sold or turned into credits." |

## 1. Concept
Credits pay for accepted work. Reputation records how well it was done. In Lens, light is the reward, so reputation is **earned glass**.
- **While it is being earned,** a badge is a small lens element sitting unlit in its socket, with a thin arc filling around it.
- **When it is earned,** its glass is lit. The first time the tester sees it, the Uplight rises under it **once**, in the badge sheet (U9). After that it carries no Uplight.
- **Nothing reads as money:** no coins, no gold, no milled edges, no flying or rolling numbers.

## 2. Product rules
1. **Money and reputation never mix.**
   - Rewards pay for accepted work: test credits today, and USDC only if Hamza approves payments.
   - Points are reputation: never cash, never exchangeable, no token, no NFT, never a payout.
   - Points never share a row, a chip or a sentence with a currency. The Credits tab never shows points.
2. **Quality, not volume.**
   - Points come only from accepted tests, feedback a builder marks helpful (honest negative findings count), accepted findings and reliability (on time, no lost dispute).
   - Joining, consenting, submitting, recording time, clip count and note length earn nothing.
3. **Settled, then counted.**
   - Points count after approval **and** after a **7-day hold**. Until then they are **held**: shown recessed and unlit, and the level doesn't move.
   - The hold assumes a dispute window after an approval (§9 Q2). Today the repo's only dispute window is 7 days after a **rejection** (`DISPUTE_WINDOW_MS` in `packages/domain/src/participation.ts`).
   - The boards' copy says "when the dispute window closes", following Hamza's wording. If Q2 is answered "no window after approval", the copy becomes the hold's own explanation.
   - The badge itself is earned at approval (Q1).
4. **Privacy.** The leaderboard shows display names only. A tester can hide themselves and still earns points and badges. Builders never see points, rank or level (§6.3).
5. **Calm.** No confetti, trophies, ribbons, stars, sparkles, neon, exclamation marks or "Level up!". One moment of light per badge.

## 3. Badges, points and levels (proposal: values not decided)
**Badges.** Tiers are counted in glass beads, never in colour. Sharp eye is an addition to Hamza's four.

| Badge | Rule | Tiers I · II · III |
|---|---|---|
| First accepted test | Your first session a builder approves. | single level |
| Reliable tester | Accepted sessions submitted on time, in a row, with no lost dispute. A lost dispute restarts the run; tiers already held stay. | 3 · 10 · 25 |
| Helpful feedback | Accepted sessions whose notes the builder marked helpful. Honest negative findings count the same as praise. | 1 · 5 · 15 |
| Device specialist | 5 accepted tests on one device, from at least 3 builders. The tester sees the device ("Pixel 6a · Android 14"); builders see only its class ("Android"). | single level |
| Sharp eye (added) | Findings a builder accepted from your sessions. A duplicate counts once, for whoever reported it first. | 3 · 10 · 30 |

Considered and cut, because they reward volume or speed: streaks of days, sessions per week, "first to join", time recorded, and Device specialist tiers (a count of tests on a self-declared device).

**Points**

| Event | Points | Limit |
|---|---|---|
| Accepted test | +100 | per approved session |
| Helpful feedback | +40 | one mark per approved session |
| Accepted finding | +30 | each, up to 3 per session, deduplicated to the first reporter |
| On time | +20 | submitted before the study closes, then accepted |
| Clean run | +50 | every 5th session of the Reliable tester run (accepted, on time, no lost dispute), so the session that reaches tier II or III always carries it |

**Earns nothing:** joining or consenting, submitting, recording time, clip count, note length, rejected work, a lost dispute. A lost dispute restarts the run and never subtracts points, so an honest dispute costs nothing. Appendix B says exactly how the run counts.

**Examples**
- Demo Tester's first approved session, with one accepted finding, on time: 100 + 30 + 20 = **150 points**, held until Oct 10.
- Elif K.'s tenth on-time accepted session in a row, with one finding and a helpful mark: 100 + 40 + 30 + 20 + 50 = **240 points**, held until Oct 10. It earns Reliable tester tier II.

**Levels.** A good session is about 150–240 points, so level 2 takes about two accepted sessions and level 5 about thirty. A level is earned once and never drops (Q14 asks about voids). It shows on the tester's profile and on the leaderboard, never to builders. It never changes a reward or unlocks a payout.

| Level | Name | From |
|---|---|---|
| 1 | Observer | 0 points |
| 2 | Examiner | 300 points |
| 3 | Inspector | 1,000 points |
| 4 | Analyst | 2,500 points |
| 5 | Principal | 6,000 points |

## 4. The medallion
One geometry at four sizes, where S is the socket's outer diameter:

| | Rule | Row 40 | Shelf 56 | Hero 96 | Sheet 120 |
|---|---|---|---|---|---|
| gap (the arc's track) | S × 0.07, ≥ 3 | 3 | 4 | 7 | 8 |
| body | S − 2·gap | 34 | 48 | 82 | 104 |
| bezel | body × 0.09, ≥ 3 | 3 | 4 | 7 | 9 |
| face | body − 2·bezel | 28 | 40 | 68 | 86 |
| glyph | face × 0.68 | 19 | 27 | 46 | 58 |
| bead | bezel × 0.9, ≥ 3 | 3 | 4 | 6 | 8 |
| arc stroke | gap × 0.5, ≥ 2 | 2 | 2 | 4 | 4 |

**Layers, back to front:**
- the **socket**, a circular L-1 well, always present;
- the **progress arc** in the gap, only while locked or in progress;
- the **body**: a cast plus the violet-tile caustic; the L2 violet bezel with the brand lens's 1px rim; the violet face dome and its specular; and for tiers II and III a stacked inner ring;
- the lit **glyph**;
- the **tier beads**.

**Beads** sit in fixed slots on the bezel: tier I at 4:30, tier II one step clockwise, tier III one step counter-clockwise. A step is 1.6 beads, so a bead never moves when the next tier arrives.

**Colours: no new hues.** The medallion adds gradient stops in the existing violet and blue families (Appendix A). They go into the glass recipes and the contrast test (ADR 0006).

**States**

| State | Glass | Arc | Uplight |
|---|---|---|---|
| Locked | unlit body, sunk into the socket (Appendix A), no cast, muted glyph | toward tier I (or the badge) | never |
| In progress | lit, with the beads already earned | toward the next tier | never |
| Earned | lit, beads = tier | none | never at rest |
| New | as its state. The meta reads "Tier II · New", with "New" in DM Mono 500 in `primary`, so the tier is always written; a single-level badge reads "New" alone. This lasts until its sheet is seen | as its state | U9 once, in the badge sheet |

**Never:** gold, silver or bronze; a knurled or milled edge (it reads as a coin); Uplight at rest; a glow on beads; stars, sparkles or confetti; a ribbon or trophy.

**Glyphs.** Six new glyphs in the Lens glyph language, each checked at 19 px beside the app glyphs and the letters it could be mistaken for:
- `accepted`: a round seal plate with a check cut through it;
- `reliable`: a tuning fork tilted 15°, with a long handle and a round foot (never a "Y");
- `helpful`: a note bubble with two ruled lines;
- `deviceSpec`: the device slab with a loupe;
- `sharpEye`: a reticle around a finding pin;
- `you`, for the proposed You tab: a tester seen through the lens ring.

**Shared pieces** (the boards' names):
- `pointsChip`: raised for posted points ("1,910 points"), or recessed with an unlit bead when held ("+150 held");
- `levelMeter`: a recessed groove whose fill starts at 0 at the level's floor; held points are hatched after the fill and never move the level;
- `trackRecord`: accepted out of decided, on time out of accepted, lost disputes;
- `shelfItem`: a 56 medallion, a two-line name block and one readout ("Tier I · 9/10", "Tier II · New", "Earned"), as one button;
- `badgeRow`: a 64-tall list row with a 40 medallion;
- `badgeSheet`: the U9 sheet.

## 5. U9 · Badge earned (proposed)
**A proposed ninth Uplight moment.** If accepted, U9 amends `DIRECTION-A.md` (the Lens spec):
- §2: the Uplight at nine moments;
- §10.2: a U9 row;
- §11.5: S3 (the Uplight rise) plays for U1–U9, and the lift, glint and bead seat become signature motions. S5 (the number roll) stays with U5 and U6.

Because the Lens spec isn't in the repo, accepting U9 also means an ADR: an addendum to ADR 0006, or a new ADR 0007.

**Trigger.** The participation refetch returns new badges the tester hasn't seen (a `lastSeenBadgeAt`-style marker). The badge sheet opens after U5 has settled.

**Grade.** The Earned grade (`UPLIGHT.earned`): Mode A on the sheet's 120 medallion, inside the sheet. It lights only the medallion.

**Sequence** (milliseconds from the Approved notice appearing, full motion):

| Time | What | Duration · easing |
|---|---|---|
| +120 → 1380 | **U5**, Earned on the Approved notice (existing) | 560 ease-uplight, 700 ease-lens |
| 1380 → 2400 | **Reading beat.** In React Native the sheet also waits for 600 ms without a touch | — |
| 2400 | **The sheet rises.** Backdrop 0 → 1; key pool → 0.4. The held chip ("+150 held") is part of the sheet: it arrives with it and never animates | `SPRING.sheet` (web 420 ease-lens); 320 ease-lens |
| 2400 → 2580 | **U5 hands over:** the notice's light goes to 0 | 180 ease-exit |
| 2940 | **First badge: the medallion lifts** from the socket. The lit layer translates (1, 2) → 0 and crossfades in over the unlit layer | 560 ease-lens; 320 crossfade |
| 2940 | **Tier-up: no sink, no lift.** The lit glass of the tier already held stays; the new tier's glass (one more bead, the stacked ring) fades in over it. Only the start layer casts a shadow | 320 ease-lens |
| 2940 → 4200 | **The U9 Earned grade** on the medallion: uplit layers and under-glow | 560 ease-uplight to 1, 700 ease-lens to 0.45 |
| 3360 | **One glint crosses the rim** (a 105° band clipped to the bezel). On a tier-up, the new bead seats in its slot | 560 ease-refract; seat 320 ease-lens |
| 4200 → | **At rest:** U9 at 0.45 while the sheet is open | static |
| Done | The sheet leaves, U5 returns to 0.45, the key pool returns to 0.72, and focus returns to the session title | 240 ease-exit; 320 ease-lens; 700 ease-lens |

**Timing rules**
- Between the notice's light going out (2580) and the medallion's rising (2940) there are **360 ms of dark**, so the two lights never overlap.
- Every segment is 120–700 ms.
- The points never roll. They are held, and held points are never lit or animated. The roll stays with credit balances (U5, U6).

**Rules**
- **Once per badge.** If the tester leaves before the sheet appears, the badge stays "New" and plays U9 when they open it from the shelf.
- **A revisit opens the sheet at rest:** U9 at 0.45, the same held chip, or the posted chip once the hold has ended.
- **Earned glass at rest carries no Uplight:** not on the shelf, the hero or in a row.
- **Never lit:** held points, a lost dispute, a voided session, an admin removing a badge or points (a plain notice), the leaderboard, a level change. A level reached is shown at rest, never celebrated.

**Reduced motion.** The sheet waits 1,200 ms, then fades in over 120 ms. The medallion appears raised and lit, at its new tier, with U9 at 0.45: no lift, glint or seat.

**Light theme.** ADR 0006 turns the glass recipes off in the light theme (`glass.enabled === false`), and components skip the Uplight there. So U9 doesn't light in the light theme. The medallion needs a flat light recipe, which waits for the light Lens theme (`TODO(light-lens)`).

**React Native mapping** (UI thread only, matching ADR 0006):

| Effect | Implementation |
|---|---|
| Sheet | the existing sheet motion in `src/motion/sheet.ts`: `withSpring(0, motion.spring.sheet)` on native, 420 ms ease-lens on web. `GlassBlur` blurs on iOS and web; on Android a Modal takes the solid fallback. Nothing animates blur |
| Held chip | a static view inside the sheet; no animation, no live region |
| Lift (first badge only) | the pre-rendered lit layer translates from (1, 2) with `withTiming(0, 560, ease-lens)`; lit and unlit opacity `withTiming(…, 320)` |
| Tier-up | the start layer is the pre-rendered medallion at the tier already held (static); the new tier's layer `withTiming(1, 320)`; the new bead `withDelay(420, …)` from (−1, −1.5) |
| U9 light | `u = withSequence(withTiming(1, 560, ease-uplight), withTiming(0.45, 700, ease-lens))`, starting 540 ms after the sheet; drives the uplit layer and the under-glow (scaleY 0.3 → 1) |
| Glint | a 105° band clipped to the ring with react-native-svg `ClipPath`, as the fluted lens does, with `withDelay(420, withTiming(…, 560, ease-refract))`. No Skia (ADR 0006) |
| Budget | at most two animating SVG layers (ADR 0006); no animated blur or shadow radius |

## 6. Screens

### 6.1 The tester's "You" tab (`A-Profile`)
**Proposal:** tab 4 changes from "Settings" to **"You"**, with the new `you` glyph. Reputation sits on top, and the settings that live on that tab today become compact rows below it. Credits stays the money tab and never shows points.

**Top to bottom:**
- **Hero:**
  - the display name and "Tester since";
  - the latest badge at hero size (96, no Uplight), with its name, tier and date, and "New" until its sheet is seen;
  - the level meter ("Level 3 · Inspector", 1,910 points, "590 points to Analyst"), with the held points hatched after the fill;
  - the held chip ("+240 held") with one sentence about when the points post, and the reputation line.
- **Track record:** accepted out of decided ("14 of 16 accepted"), on time ("13 of 14") and lost disputes ("1").
  - Each opens a small sheet that says exactly how it is counted.
  - Below it: "Builders see these counts and up to two badges when they review your work."
- **Badges:** the shelf, three per row, showing earned, in progress, locked and new. A badge opens its sheet:
  - an earned badge revisited opens at rest;
  - a new badge plays U9;
  - an in-progress or locked badge opens with no Uplight, showing the rule and the progress as counts ("9 of 10 toward tier II").
- **Points activity:** grouped by when the points post. "Held until Oct 10" lists the Oct 3 session's points as held; earlier groups list posted points. An admin void is its own unlit entry. Never a currency.
- **Leaderboard:** "Rank 12 of 240 · Last 90 days · 640 points", which opens the leaderboard. Below it is the switch "Show me on the leaderboard": "Shows your display name, level, 90-day points and one badge. Never your email, wallet or device."
- **Settings:** Appearance, Device profile, Devnet wallet, AI analysis, Your data, Sign out, then Delete account last.
- **Tab bar:** Discover, My work, Credits, You.

**States**
- established tester;
- new tester (every badge locked: "Your first approved session earns your first badge.");
- points held;
- hidden from the leaderboard;
- session voided: a neutral notice and an unlit reversal entry, with the level unchanged;
- loading;
- error.

Reputation loads separately, so Settings and Sign out keep working if it fails.

**The sample testers.** Every board derives its figures from one sample history.
- **Demo Tester** is the canvas's first-time tester: one approved session ("Demo: checkout flow", Oct 3, 2:24 PM).
  - 150 points held until Oct 10.
  - First accepted test, new.
  - Not ranked: 0 of 5 posted sessions.
- **Elif K.** carries every established view. She has 16 decided sessions from 6 builders:
  - 14 accepted, one of them after a rejection was overturned;
  - one rejected;
  - one rejection upheld after a dispute (her one lost dispute).

  She has 1,910 posted points (Level 3), and 640 points in the last 90 days (rank 12 of 240).

### 6.2 Leaderboard (`A-Leaderboard`), a stack screen opened from You
- **Window:** a rolling 90 days. There is no time-range switch, and old or inflated history falls out on its own.
- **No device filter:** it would reveal which device each tester uses, and the screen promises only a display name, a level, 90-day points and one badge.
- **Explainer:** points from approved work, helpful feedback and reliability over the last 90 days, shown once they post. "Submitting alone earns nothing." It also carries the reputation line.
- **Rows:** rank (DM Mono), display name, level, the 90-day points ("2,480 points") and one key badge at row size.
  - The top three share the first card, nearest the key light, with no podium and no metals.
  - Ties share a rank.
- **Your row:** pinned in a bottom dock: "You · Rank 12 of 240 · Level 3 · 640 points".
- **States:**
  - ranked;
  - scrolled to you;
  - hidden ("You're hidden. Your points still count.", with "Show me");
  - not ranked yet ("You'll appear after 5 sessions that have posted, from at least 2 builders."). It counts posted sessions only, never held ones, so Demo Tester shows 0 of 5;
  - empty;
  - loading;
  - error;
  - offline.

### 6.3 Builder review: the track record and the helpful mark (`A-ReviewTrust`)
- **Track record card**, placed **below the evidence**, so the builder reads the work first:
  - the display name, then the record as of this review: accepted out of decided ("13 of 15 accepted"), on time ("12 of 13") and lost disputes ("1");
  - at most two relevant badges: "Device specialist · Android" (the device class, not the model) and "Sharp eye · tier I";
  - the closing line "Track record, not a verdict on this submission. Judge the evidence."
  - **A new tester** gets the same card in a neutral tone: "New tester · No track record yet. Judge the evidence on its own."
  - **Builders never see points, rank or level, an email or a wallet address.** A level is a band of points, and rank and points would bias the review toward whoever already leads and turn reputation into a lever. The tester's own profile says what builders see.
- **One helpful mark per session:** a toggle at the end of the task notes, where the builder has just read them.
  - Its line reads "Counts toward the tester's reputation if you approve. Critical feedback counts too."
  - The first time it's used, a short explainer says the tester earns reputation points once the hold ends, never credits.
- **The Approve sheet (U7)** gains one quiet line and no second light: "Feedback marked helpful · adds reputation, not credits". If a mark is set, the Reject sheet notes that rejecting clears it.
- **After the decision:** the mark can change until the points post (7 days). Then it is read-only ("Points posted Oct 10"). On a rejected session it is off and disabled: "Helpful marks count on approved sessions."
- **Findings:** one line under the head: "Up to 3 findings from this session count toward the tester's reputation."

**Touch targets** on all three screens are 48 dp, the repo's minimum (plan §2 and ADR 0006).

## 7. Copy and accessibility
**Say** (verbatim on the boards):
- "Badge earned", or "Tier II earned" on a tier-up;
- "Your first approved session.";
- "+150 held" while held, read aloud as "+150 points held"; "1,910 points" once posted;
- "Accepted test 100 · Accepted finding 30 · On time 20 points";
- "Held until Oct 10, when the dispute window closes. Then they count toward your level." (see §2.3);
- "Posted May 13, after the dispute window closed.";
- the reputation line;
- "Tier II · New";
- "14 of 16 accepted";
- "590 points to Analyst".

**Rules**
- Sentence case.
- Points always carry the word "points", in ledgers, leaderboards and level thresholds too ("2,480 points", "from 300 points"). A zero earns "nothing", never "0".
- Progress is written as counts ("2 of 3"), never as percentages.
- A tier is "tier II" in text and "Tier II" as a label.
- Dates read "Oct 3" on screen (DM Mono), and "October 3" to screen readers.
- **Never:** "Congratulations!", "Level up!", "Unlocked", XP, score, coins, tokens, gems, "rewards" for points, "Rank #1", exclamation marks, emoji.

**Accessibility**
- **Medallions.** A medallion on its own is an image with one label, e.g. "Reliable tester, tier II, earned October 3" or "Sharp eye, locked. 1 of 3 accepted findings toward tier I". Its layers are hidden from assistive tech. In a shelf item the button carries the label; in a row or the sheet, the text does. One announcement, never two.
- **Never by light alone.** Tier and progress are always written; nothing depends on light, colour or beads.
- **Separators.** Every "·" is hidden from screen readers and followed by a hidden pause, so "Tier II · New" reads "Tier II, New".
- **The sheet** is a dialog, labelled by its kicker and title and described by its meaning, the points and the held line.
  - Focus moves to the title, also when the sheet opens at rest. Escape and the backdrop close it, the screen behind is inert, and focus returns to what opened it.
  - It reads, for example: "… +240 points held. Accepted test 100, Helpful feedback 40, Accepted finding 30, On time 20, Clean run 50 points. Held until October 10, …".
- **The level meter** is a meter on the web (`role="meter"`). In React Native it maps to `accessibilityRole="progressbar"` with `accessibilityValue { min, max, now, text }`. Its text reads "Level 3, Inspector. 1,910 points, 590 points to Analyst. 240 points held until October 10."
- **Controls:**
  - the switch has `role="switch"` and its checked state;
  - the helpful mark is a toggle button (pressed; disabled when read-only or off);
  - leaderboard rows read as one sentence.
- **Contrast:** names in `text` (15.6:1 on glass), metadata in `text-muted` (7.8:1), "New" in `primary` (9.8:1). Locked names use `text-muted`, never `text-faint`.

## 8. Anti-gaming
1. **Approval only.** Points and badge progress exist only for approved work.
2. **Held 7 days.** Points post after the hold. An admin can void a session found to be collusive. Its points and badge progress go with it, as an append-only reversal entry, with a plain notice and no public mark.
3. **Builder cap.** At most 3 sessions from one builder count toward a tester's points and badges in any 30 days. Device specialist needs 3 builders.
4. **Findings** are capped at 3 per session and deduplicated to the first reporter.
5. **Helpful** is one mark per approved session, never per note or finding. It can be edited until the points post, and it is cleared on reject.
6. **No volume metrics:** no streaks of days, no "sessions this week", no count-only tiers.
7. **Disputes stay safe.** A lost dispute restarts the reliability run and never subtracts points.
8. **Leaderboard.** It ranks points posted in a rolling 90 days, shows display names only, and leaves hidden testers out. A tester appears once 5 sessions have posted, from at least 2 builders.
9. **Points never unlock payouts or change rewards.** Builders never see points, level or rank.

**The research versus this proposal.** The research (§6) gives HYPOTHESIS criteria. Where this product proposal differs, it wins for the product, and each difference is an open question:

| Item | Research (§6) | This proposal | Why |
|---|---|---|---|
| Reliable tester | at least 10 settled, 3 builders, Wilson reliability R ≥ 0.8 | an on-time run, tiers 3 · 10 · 25 | A run is easy to read on a badge. R suits ranking and builder views, not a tier name. Q15 |
| Device specialist | 8 acceptances on one device class, 3 builders, consistent device signals | 5 accepted tests on one device, 3 builders, single level | The device is self-declared today (Q6); a lower bar until it is verified. Q15 |
| Ranking | 90-day score R × Σ(1, or 1.5 if helpful) ÷ k | the plain total of points posted in 90 days | Points already weight helpfulness. R and 1/k are open (Q10, Q15) |
| Identity | a Tier 1 signal for the leaderboard and for every badge beyond the first | posted sessions and builders only | Identity tooling isn't approved; Q9 asks |
| Hold | payout finalized + dispute windows closed + a 7-day fraud hold | a 7-day hold after approval | No payouts exist yet; Q2 |

Both documents use the repo's dispute window: 7 days after a rejection (`DISPUTE_WINDOW_MS`).

The research also brings measures for the build itself:
- recording hashes as review flags, never automatic rejections;
- collusion signals between builder–tester pairs;
- an append-only points ledger with reversal entries.

## 9. Open questions for Hamza
1. **Do badges wait for the hold too?** This proposal earns the badge at approval and holds only its points.
2. **Is there a dispute window after an approval, and who can open it** (the builder, an admin)? Today the repo has one only after a rejection. If there is none, the points could post at approval, "held" goes away, and the helpful mark can't be changed after approval.
3. **Should builders ever filter or invite testers by level or badge?** It gives points indirect cash value. Until this is decided, builders see no level, and see Device specialist only by its class.
4. **Leaderboard default and window:** is a tester shown by default (with the switch to hide), or hidden until they opt in? Is a rolling 90 days right?
5. **The values:** point amounts, the builder cap (3 sessions in 30 days), tier thresholds, level names and thresholds, the 7-day hold, up to 3 findings per session, +40 per mark, and the ranking threshold (5 posted sessions from at least 2 builders).
6. **How is a device verified** for Device specialist? It's self-declared today, and builders will read the badge as verified.
7. **U9 as the ninth Uplight moment** (§5), recorded in an ADR.
8. **The You tab:** rename tab 4 from Settings to You?
9. **Identity before ranking:** should the leaderboard require one strong identity signal (the research's Tier 1: a Seeker Genesis Token, World ID or a vetted attestation)?
10. **Pair weight:** on top of the builder cap, should points diminish for repeated approvals from the same builder (the k-th weighing 1/k)?
11. **What builders see:** three counts and up to two badges, never points, level or rank. Is that the right disclosure, and is the profile's one line enough to tell testers?
12. **The key badge:** which badge leads a leaderboard row: the highest tier (the sample's rule, then the newest), the newest, or one the tester picks?
13. **Helpful marks after an overturn:** when an admin overturns a rejection, does the mark come back, and can the builder still set it? Should Helpful feedback also need marks from several builders, with a builder's marks capped per study (the research suggests 3 builders and 30%)?
14. **Voids and levels:** a level never drops. Should an admin void (as opposed to a lost dispute) recompute it?
15. **The research's other rules:** adopt Wilson reliability (for Reliable tester or ranking), a device-class Device specialist at 8, the weighted 90-day score, or identity checks for badges (§8 table)?

## 10. If this is approved: where it would land
These are suggestions to check against Hamza's plan. None of this exists yet.
- **API.**
  - A points ledger beside `apps/api/src/ledger.ts`. It must stay separate from the credits ledger, so points can never post to a credit account. It is append-only, with reversal entries for voided sessions, and every entry carries its rule (accepted test, helpful, finding, on time, clean run) and its `participation_id`.
  - Badge awards with their tier and `earnedAt`, plus the tester's `lastSeenBadgeAt`.
  - A 90-day leaderboard view that leaves out hidden testers.
- **Contracts.**
  - Today a tester's own data comes from `GET /me` (`User`). Add the reputation fields there or in a new route, log the change in `docs/decisions/contract-changes.md`, and consider a `ClientConfig.features` flag so the layer can ship dark.
  - The builder's review response carries only the track record counts and up to two badges (§6.3), never points, rank or level.
- **Export and deletion.** `POST /me/export` and `DELETE /me` must cover points, badges and leaderboard rows.
- **Mobile.**
  - A `reputation` kit beside `src/ui`: medallion, points chip, level meter, track record, shelf item, badge row and badge sheet.
  - A `UPLIGHT`-style entry for U9's timings in `src/theme/motion.ts`.
  - The six new glyphs in the Lens glyph set.
- **The tab rename.** Keep the route and the `tab-settings` testID, or plan the updates. These flows open Settings through it:
  - Playwright: `account-delete.spec.ts`, `wallet-login.spec.ts`, `review-loop.spec.ts`, `e2e-live/web-launch.spec.ts`, `e2e/preview/browser-smoke.mjs`;
  - Maestro: `_open-wallet.yaml`, `ios-settings.yaml`, `ios-smoke.yaml`, `sheet-keyboard.yaml`, `sign-out.yaml`.
- **Tests:**
  - points never reach a credit account;
  - held → posted when the hold ends;
  - a reversal on a voided session;
  - the builder cap and the run rules (Appendix B);
  - U9 plays once per badge;
  - reduced motion and the light theme.

## Appendix A. Visual recipes
From `REPUTATION.md` v3 R3. **k = S / 56** scales every shadow; **d** is a bead's diameter.

| Use | Value |
|---|---|
| Socket (a circular L-1 well) | floor `linear-gradient(160deg, #07061A 0%, #0C0B24 100%)`; rim `linear-gradient(135deg, #7A74A8 0%, #7A74A8 45%, #A0BAFF 100%)`; `inset 2.4k 3.2k 6.4k rgba(2,1,10,0.80), inset -1px -1px 0 rgba(150,175,255,0.16)` |
| Body rim (1px) | the brand lens's rim: `linear-gradient(135deg, #FFFFFF 0%, #B7C6FF 30%, #6A5BD0 70%, #2A2266 100%)` |
| Bezel (L2 violet) | `radial-gradient(100% 90% at 18% 12%, rgba(170,190,255,0.26) 0%, rgba(170,190,255,0) 55%), linear-gradient(150deg, #3A2E86 0%, #2E2366 55%, #221A50 100%)`; bevel `inset 1px 1px 0 rgba(255,255,255,0.35), inset -1.5k -2k 3k rgba(20,16,70,0.55)` |
| Face (violet dome) | key bloom `radial-gradient(80% 70% at 30% 24%, rgba(186,202,255,0.40) 0%, rgba(186,202,255,0) 60%)`; inner caustic `radial-gradient(70% 55% at 70% 84%, rgba(150,132,255,0.36) 0%, rgba(150,132,255,0) 72%)`; body `linear-gradient(150deg, #4636A6 0%, #33277A 52%, #251B58 100%)`; lip `inset 2k 3k 5k rgba(8,6,30,0.6), inset -1px -1px 0 rgba(176,192,255,0.35)` |
| Face specular | a 1px ring (1.5px at S ≥ 90) of `linear-gradient(135deg, rgba(255,255,255,0.75) 0%, rgba(255,255,255,0) 28%)` |
| Cast + caustic | `5k 8k 16k -5k rgba(2,1,10,0.92), 2k 3k 6k -2k rgba(2,1,10,0.6), 6k 9k 18k -7k rgba(111,155,255,0.45)` (the violet tile's caustic; never a glow) |
| Stacked ring (tiers II, III) | a 1px ring inset `bezel + max(2, 2.5k)`: `rgba(220,230,255,0.42) → 0.14 → 0` |
| Unlit body (locked) | bezel `linear-gradient(150deg, #23204C 0%, #1C1942 55%, #17143A 100%)`, rim `rgba(169,193,255,0.34) → 0.12 → 0.05`; face `linear-gradient(150deg, #1A1842 0%, #15133A 55%, #100E2C 100%)` with `inset 2k 3k 6k rgba(2,1,10,0.65)`; sunk by `translate(max(0.5, 0.5k), max(1, k))`; glyph muted at 0.8 |
| Progress arc | stroke = arc stroke (§4), round caps, from 12 o'clock clockwise; `#E4EAFF → #B4B3FF → #8C7BFF`, pale at the screen's top-left and violet at the bottom-right; track hairline `rgba(160,186,255,0.18)` 1px; never lit |
| Bead (glass) | `radial-gradient(circle at 32% 28%, #FFFFFF 0%, #E6E1FF 20%, #B2A8F0 52%, #6E62C8 84%, #4B3FA0 100%)`; cast `0.08d 0.12d 0.22d rgba(2,1,10,0.85)`; seat ring `0 0 0 max(1, 0.14d) rgba(12,9,40,0.62)`. Unlit (held, or tiers ahead): `radial-gradient(circle at 34% 30%, #C4BEE6 0%, #8A83B8 46%, #3A3380 100%)` |
| Level fill | `linear-gradient(90deg, #8C7BFF 0%, #C9D8FF 100%)` with `inset 0 1px 0 rgba(255,255,255,0.5)`; held hatch `repeating-linear-gradient(115deg, rgba(201,216,255,0.42) 0 2px, rgba(201,216,255,0.10) 2px 5px)`. The leaderboard switch's "on" groove uses the same fill |

**Type**
- **Points:** Red Hat Display 400 (500 in a chip), with the word "points" in Instrument Sans, in `numeral` or `text`. Credits keep Red Hat Display 300 numerals in wells. Points are never green, never in a well beside a credit numeral, never lit and never rolled.
- **Counts** (the track record and the info sheets): Red Hat Display 500 19/24 tabular, with "of 16" in 400 muted.
- **Tier names** in ladders: the 12/16 label style.

## Appendix B. How the run counts
- Sessions count in the order of their final decision.
- An accepted session on time adds 1 to the run. A late one, a rejection or a lost dispute sets it to 0.
- A rejection overturned after a dispute counts as accepted at the time of the overturn.
- A session beyond the builder cap (§8.3) earns nothing, and neither adds to nor breaks the run.
- Every 5th session of the run carries the clean run (+50). Tiers already held stay when the run restarts.
