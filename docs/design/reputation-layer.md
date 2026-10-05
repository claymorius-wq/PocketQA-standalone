# Reputation layer: design proposal (Lens)

**Status: proposal, not a decision.** Contributor design, 2026-10-05. Hamza asked for points, badges and a leaderboard in the wallet, escrow and rewards direction. His plan (`docs/plans/wallet-escrow-rewards-leaderboard.md`) isn't in the repo yet, so this proposal waits for it. Every point value, threshold and level name below is **a proposal, not decided**. The product questions are in §9. This change adds no code, API, contract or data.

**Where the design lives.**
- **Boards.** The design canvas "Pocket QA Glass" (private; claymorius-wq shares access), page **"Next · reputation (proposal)"**:
  - `A-Badges`: the system board: principles, anatomy, states, the badge set, points and levels, components, U9, copy, anti-gaming, accessibility;
  - `A-BadgeEarned`: the moment in context;
  - `A-Profile`: the tester's "You" tab;
  - `A-Leaderboard`;
  - `A-ReviewTrust`: the builder's view.
- **Spec.** The canvas spec is the Lens reputation addendum (`REPUTATION.md`, beside `DIRECTION-A.md`). This document carries everything an engineer needs from it.
- **Related.**
  - [ADR 0006](../decisions/0006-lens-visual-system.md): the Lens visual system this builds on.
  - [`docs/research/usdc-escrow-and-anti-gaming.md`](../research/usdc-escrow-and-anti-gaming.md): the money side, and the anti-gaming research behind §8.

## 1. Concept
Credits pay for accepted work, and reputation records how well it was done. In Lens, light is the reward, so reputation is **earned glass**:
- **The badge.** A badge is a small lens element set in its mount. While it is being earned, it sits unlit in its socket and a thin arc fills around it.
- **Earned.** When it is earned, its glass lifts and lights. The Uplight rises under it **once**, in the badge sheet (U9, the ninth Uplight moment). After that the glass stays lit and carries no Uplight.
- **Never money.** Nothing about it reads as money: no coins, no gold, no milled edges, no flying counters.

## 2. Product rules
1. **Money and reputation never mix.**
   - Rewards (test credits today, USDC only if Hamza approves payments) pay for accepted work.
   - Points are reputation: never cash, never exchangeable, no token, no NFT, never a payout.
   - Points never share a row, a chip or a sentence with a currency. The Credits tab never shows points.
2. **Quality, not volume.**
   - Points come only from accepted tests, feedback a builder marks helpful (honest negative findings count), accepted findings and reliability (on time, no lost dispute).
   - Joining, consenting, submitting, recording time, clip count and note length earn nothing.
3. **Settled, then counted.**
   - Points count after approval **and** once the 7-day dispute window has passed.
   - Until then they are **held**: shown recessed and unlit, and the level doesn't move.
   - The badge itself is earned at approval (open question 1).
4. **Privacy.** The leaderboard shows display names only. A tester can hide themselves and still earns points and badges.
5. **Calm.** No confetti, trophies, ribbons, stars, sparkles, neon, exclamation marks or "Level up!". One moment of light per badge.

## 3. Badges, points and levels (proposal: values not decided)

**Badges.** Tiers are counted in glass beads, never in colour.

| Badge | Rule | Tiers I · II · III |
|---|---|---|
| First accepted test | Your first session a builder approves. | single level |
| Reliable tester | Accepted sessions submitted on time, in a row, with no lost dispute. A lost dispute restarts the run; tiers already held stay. | 3 · 10 · 25 |
| Helpful feedback | Accepted sessions whose notes the builder marked helpful. Honest negative findings count the same as praise. | 1 · 5 · 15 |
| Device specialist | 5 accepted tests on one device, from at least 3 builders, shown with that device ("Pixel 6a · Android 14"). Single level: a count ladder on a self-declared device would reward volume. | single level |
| Sharp eye | Findings a builder accepted from your sessions. A duplicate counts once, for whoever reported it first. | 3 · 10 · 30 |

Considered and cut, because they reward volume or speed: streaks of days, sessions per week, "first to join", time recorded.

**Points**

| Event | Points | Limit |
|---|---|---|
| Accepted test | +100 | per approved session |
| Helpful feedback | +40 | one mark per approved session |
| Accepted finding | +30 | each, up to 3 per session, deduplicated to the first reporter |
| On time | +20 | submitted before the study closes, then accepted |
| Clean run | +50 | every 5th session of the Reliable tester run (accepted, on time, no lost dispute), so a tier II or III session always includes it |

**Earns nothing:** joining or consenting, submitting, recording time, clip count, note length, rejected work. A lost dispute restarts the reliability run and never subtracts points, so an honest dispute costs nothing.

Examples:
- A first accepted test with one accepted finding, on time, is 100 + 30 + 20 = **150 points**, held until the dispute window closes.
- The boards' established tester, Elif K., completes her tenth on-time accepted session in a row with one finding and a helpful mark: 100 + 40 + 30 + 20 + 50 = **240 points**, held until Oct 10. That session earns Reliable tester tier II.

**Levels.** A good session is about 150–230 points, so level 2 takes about two accepted sessions and level 5 about thirty. A level is earned once and never drops. It shows on the profile and beside a display name, and never changes a reward or unlocks a payout.

| Level | Name | From |
|---|---|---|
| 1 | Observer | 0 |
| 2 | Examiner | 300 |
| 3 | Inspector | 1,000 |
| 4 | Analyst | 2,500 |
| 5 | Principal | 6,000 |

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

**Layers, back to front:**
- the **socket**, a circular L-1 well, always present;
- the **progress arc** in the gap, only while locked or in progress;
- the **body**: a cast plus the violet-tile caustic, the L2 violet bezel with the brand lens's 1px rim, the violet face dome with its specular, and for tiers II and III a stacked inner ring;
- the lit **glyph**;
- the **tier beads**, glass beads on the bezel at 4:30.

No new colours: everything reuses the ADR 0006 palette and the Uplight colours.

**States**

| State | Glass | Arc | Uplight |
|---|---|---|---|
| Locked | unlit body, sunk 1px into the socket, no cast, muted glyph | toward tier I | never |
| In progress | lit, with the beads already earned | toward the next tier | never |
| Earned | lit, beads = tier | none | never at rest |
| New | as Earned, plus a "New" label (DM Mono 500 12/16, primary) until its sheet is seen | none | U9 once, in the badge sheet |

**Never:** gold, silver or bronze; a knurled or milled edge (it reads as a coin); Uplight at rest; a glow on beads; stars, sparkles or confetti; a ribbon or trophy.

**Points type.** A points number is Red Hat Display 400 (500 in a chip) with the word "points" in Instrument Sans, in `numeral` or `text`. Credit numerals keep Red Hat Display 300 in wells. Points are never green, never in a well beside a credit numeral, and never lit: lit numerals stay with the U5 and U6 balances.

**Glyphs.** Five new glyphs in the Lens glyph language, each checked at 19 px beside the app glyphs it could be mistaken for:
- `accepted`: a round seal plate with a check cut through it;
- `reliable`: a tuning fork on a solid stem;
- `helpful`: a note bubble with two ruled lines;
- `deviceSpec`: the device slab with a loupe;
- `sharpEye`: a reticle around a finding pin.

**Shared pieces** (the boards' names):
- `pointsChip`: raised for settled points, recessed with an unlit bead when held ("+150 held");
- `levelMeter`: `role="meter"`; the held points are hatched after the fill and never move the level;
- `shelfItem`: a 56 medallion, the name and one readout (e.g. "Tier I · 7/10"), as one button;
- `badgeRow`: a 64-tall list row with a 40 medallion;
- `badgeSheet`: the U9 sheet.

## 5. U9 · Badge earned
**A proposed ninth Uplight moment.** Lens has eight. If accepted, U9 amends the Lens spec's list of light sources (§2), its table of moments (§10.2) and the rule that only balances roll (§11.5).

**Trigger.** The participation refetch returns new badges the tester hasn't seen (a `lastSeenBadgeAt`-style marker). The badge sheet opens after U5 has settled.

**Grade.** The Earned grade (`UPLIGHT.earned`): Mode A on the sheet's 120 medallion.

**Sequence** (milliseconds from the Approved notice appearing, full motion):

| Time | What | Duration · easing |
|---|---|---|
| +120 → 1380 | **U5**, Earned on the Approved notice (existing) | 560 ease-uplight, 700 ease-lens |
| 1380 → 2400 | **Reading beat.** In React Native the sheet also waits for 600 ms without a touch | — |
| 2400 | **The sheet rises.** Backdrop 0 → 1; key pool → 0.4 | `SPRING.sheet` (web 420 ease-lens); 320 ease-lens |
| 2400 → 2580 | **U5 hands over:** the notice's light goes to 0 | 180 ease-exit |
| 2940 | **The medallion lifts:** the lit layer translates (1, 2) → 0 and crossfades in | 560 ease-lens; 320 crossfade |
| 2940 → 4200 | **The U9 Earned grade** on the medallion: uplit layers and under-glow | 560 ease-uplight to 1, 700 ease-lens to 0.45 |
| 3360 | **One glint crosses the rim** (a 105° band masked to the bezel). On a tier-up, the newest bead seats as it passes | 560 ease-refract; seat 320 ease-lens |
| 4200 → | **At rest:** U9 at 0.45 while the sheet is open | static |

**The points never roll.** The sheet shows them as the recessed held chip ("+150 held"), present from the moment the sheet opens. Points from a fresh approval are held, and held points are never lit or animated. The number roll stays with credit balances (U5, U6).

**Tier-ups.** On a tier-up the medallion starts lit, showing the tier already held. Only the new bead, the stacked ring and the light mark the change; a badge the tester holds is never shown as locked.
| Done | The sheet leaves, U5 returns to 0.45, and the key pool returns to 0.72 | 240 ease-exit; 700 ease-lens |

**Timing rules.**
- Between the notice's light going out (2580) and the medallion's rising (2940) there are **360 ms of dark**, so the two lights never overlap.
- Every segment is 120–700 ms.

**Rules**
- **Once per badge.** If the tester leaves before the sheet appears, the badge stays "New" and plays U9 when they open it from the shelf. A revisit opens the sheet at rest.
- **Earned glass at rest carries no Uplight:** not on the shelf, the hero or in a row.
- **Never lit:** held points, a lost dispute, a voided session, an admin removing a badge or points (a plain notice), the leaderboard, a level change. A level reached is shown at rest, never celebrated.

**Reduced motion.** The sheet waits the same reading time, then fades in over 120 ms. The medallion appears raised and lit at 0.45, with no lift, glint or seat.

**React Native mapping** (UI thread only, matching ADR 0006):

| Effect | Implementation |
|---|---|
| Sheet | the existing sheet spring, with the BlurView crossfading in once it settles |
| Lift | the pre-rendered lit layer translates from (1, 2) with `withTiming(0, 560, ease-lens)`; lit and unlit opacity `withTiming(…, 320)` |
| U9 light | `u = withSequence(withTiming(1, 560, ease-uplight), withTiming(0.45, 700, ease-lens))`, starting 540 ms after the sheet; drives the uplit layer and the under-glow (scaleY 0.3 → 1) |
| Glint | a 105° gradient band translating under a ring mask, `withDelay(420, withTiming(…, 560, ease-refract))` |
| Budget | at most one masked canvas (the glint) while the sheet animates; no animated blur or shadow radius |

## 6. Screens

### 6.1 The tester's "You" tab (`A-Profile`)
**Proposal:** tab 4 changes from "Settings" to **"You"**, with a new glyph. Reputation sits on top, and the settings that live on that tab today become compact rows below it. Credits stays the money tab and never shows points.

**Top to bottom:**
- **Hero:**
  - the display name and "Tester since";
  - the latest badge at hero size (96, never lit), with its name, tier and date, and "New" until its sheet is seen;
  - the level meter ("Level 3 · Inspector", 1,910 points, "590 points to Analyst"), with the held points hatched after the fill;
  - the held chip ("+240 held") with its one sentence about when the points post, and the reputation line.
- **Track record:** accepted out of decided sessions ("14 of 16 accepted"), on time ("13 of 14") and lost disputes ("1"). Each opens a small sheet that says exactly how it is counted. Below it: "Builders see these counts and up to two badges when they review your work."
- **Badges:** the shelf, three per row, showing earned, in progress, locked and new. A badge opens its sheet:
  - an earned badge revisited: at rest, U9 at 0.45;
  - a new badge: it plays U9;
  - in progress or locked: unlit, with the rule and the progress as counts ("4 of 10 toward tier II").
- **Points activity:** grouped by when the points post. "Held until Oct 10" lists the Oct 3 session's points as held; earlier groups list posted points. Never a currency.
- **Leaderboard:** "Rank 12 of 240 · Last 90 days · 640 points", which opens the leaderboard. Below it, the switch "Show me on the leaderboard": "Shows your display name, level, 90-day points and one badge. Never your email, wallet or device."
- **Settings:** Appearance, Device profile, Devnet wallet, AI analysis, Your data, Sign out, then Delete account last.
- **Tab bar:** Discover, My work, Credits, You.

**States:**
- established tester;
- new tester (every badge locked: "Your first approved session earns your first badge.");
- points held;
- hidden from the leaderboard;
- session voided: a neutral notice and an unlit reversal row, with the level unchanged;
- loading;
- error.

Reputation loads separately, so Settings and Sign out keep working if it fails.

**The sample testers.** Every board derives its figures from one sample history:
- **Demo Tester** is the canvas's first-time tester: one approved session ("Demo: checkout flow", Oct 3), 150 points held until Oct 10, which earns First accepted test. Not ranked yet: 0 of 5 posted sessions.
- **Elif K.**, an established tester, carries the established views:
  - 16 decided sessions from 6 builders:
    - 14 accepted, one of them after a rejection was overturned;
    - one rejected;
    - one rejection upheld after a dispute, her one lost dispute;
  - 1,910 posted points, Level 3;
  - 640 points in the last 90 days, rank 12 of 240.

### 6.2 Leaderboard (`A-Leaderboard`), a stack screen opened from You
- **Window:** a rolling 90 days. It has no time-range switch, and old or inflated history falls out on its own.
- **No device filter:** it would reveal which device each tester uses, and the screen promises only a display name and a level.
- **Explainer:** points from approved work, helpful feedback and reliability over the last 90 days, shown once they post after the dispute window. "Submitting alone earns nothing." It also carries the reputation line.
- **Rows:** rank (DM Mono), display name, level, the 90-day points ("2,480 points") and one key badge at row size.
  - The top three share the first card, nearest the key light, with no podium and no metals.
  - Ties share a rank.
- **Your row:** pinned in a bottom dock: "You · Rank 12 of 240 · Level 3 · 640 points".
- **States:**
  - ranked;
  - scrolled to you;
  - hidden ("You're hidden. Your points still count.", with "Show me");
  - not ranked yet: "You'll appear after 5 sessions that have posted, from at least 2 builders." It counts posted sessions only, never held ones, so Demo Tester shows 0 of 5. The research also gates ranking on one strong identity signal (§9);
  - empty;
  - loading;
  - error;
  - offline.

### 6.3 Builder review: the track record and the helpful mark (`A-ReviewTrust`)
- **Track record card**, placed **below the evidence**, so the builder reads the work first:
  - the display name, then the record as of this review: accepted out of decided sessions ("13 of 15 accepted"), on time ("12 of 13") and lost disputes ("1");
  - at most two relevant badges: "Device specialist · Android" (the device class, not the model, until §9 questions 3 and 7 are decided) and "Sharp eye · tier I";
  - the closing line "Track record, not a verdict on this submission. Judge the evidence."
  - **A new tester** gets the same card in a neutral tone: "New tester · No track record yet. Judge the evidence on its own."
  - **Builders never see points, rank or level, an email or a wallet address.** A level is a band of points, and rank and points would bias the review toward whoever already leads and turn reputation into a lever. The tester's own profile says what builders see.
- **One helpful mark per session**, a toggle at the end of the task notes, where the builder has just read them.
  - Its line: "Counts toward the tester's reputation if you approve. Critical feedback counts too."
  - The first time it is used, a short explainer says the tester earns reputation points once the dispute window has passed, and never credits.
- **The Approve sheet (U7)** gains one quiet line and no second light: "Feedback marked helpful · adds reputation, not credits". If a mark is set, the Reject sheet notes that rejecting clears it.
- **After the decision:** the mark can change until the points post (7 days). Then it is read-only ("Points posted Oct 10"). On a rejected session it is off and disabled: "Helpful marks count on approved sessions."
- **Findings:** one line under the head: "Up to 3 findings from this session count toward the tester's reputation."

## 7. Copy and accessibility
**Say** (verbatim on the boards):
- "Badge earned", or "Tier II earned" on a tier-up;
- "Your first approved session.";
- "+150 held" while the points are held, and "+150 points" once they have posted;
- "Accepted test 100 · Accepted finding 30 · On time 20";
- "Held until Oct 10, when the dispute window closes. Then they count toward your level.";
- "Points are reputation, not cash. They can't be withdrawn, sold or turned into credits." This goes wherever points first appear on a screen.

**Rules**
- Sentence case.
- Points always carry the word "points", in ledgers, leaderboards and level thresholds too ("2,480 points", "from 300 points").
- A zero earns "nothing", never "0".
- Progress is written as counts ("2 of 3"), never as percentages.
- A tier is "tier II" in text and "Tier II" as a label.
- Dates read "Oct 3" on screen (DM Mono) and "October 3" when spoken.
- **Never:** "Congratulations!", "Level up!", "Unlocked", XP, score, coins, tokens, gems, "rewards" for points, "Rank #1", exclamation marks, emoji.

**Accessibility**
- **Medallions.** A medallion on its own is `role="img"` with one label, e.g. "Reliable tester, tier II, earned October 3", or "Sharp eye, locked. 2 of 3 accepted findings toward tier I". Its layers are hidden from assistive tech. In a shelf item the button carries the label; in a row or the sheet, the text does.
- **Never by light alone.** Tier and progress are always written; nothing depends on light, colour or beads alone.
- **The sheet** is `role="dialog"`, labelled by its kicker and title and described by the meaning, the points and the held line.
  - Focus moves to the title. Escape and the backdrop close it, the screen behind is inert, and focus returns to the session title.
  - The held chip is read as "Plus 150 points, held until October 10."
- **The level meter** is `accessibilityRole="progressbar"` with a value text such as "Level 2, Examiner. 640 points, 360 to Inspector. 150 points held until October 10."
- **Contrast:** names in `text` (15.6:1 on glass), metadata in `text-muted` (7.8:1), "New" in `primary` (9.8:1). Locked names use `text-muted`, never `text-faint`.

## 8. Anti-gaming
1. **Approval only.** Points and badge progress exist only for approved work.
2. **Held 7 days.** Points post after the dispute window. An admin can void a session found to be collusive; its points and badge progress go with it, with a plain notice and no public mark.
3. **Builder cap.** At most 3 sessions from one builder count toward a tester's points and badges in any 30 days.
4. **Findings** are capped at 3 per session and deduplicated to the first reporter.
5. **Helpful** is one mark per approved session.
6. **No volume metrics:** no streaks of days, no "sessions this week".
7. **Disputes stay safe.** A lost dispute restarts the reliability run and never subtracts points.
8. **Leaderboard.** It ranks a rolling 90 days, shows display names only, and leaves hidden testers out. A tester is ranked after 5 posted sessions from at least 2 builders. Whether ranking also needs an identity signal is open (§9).
9. **Points never unlock payouts or change rewards.** If levels ever gate studies, points gain indirect cash value and need stricter checks (§9).

The research adds measures for the build itself (`docs/research/usdc-escrow-and-anti-gaming.md` §6):
- tiered identity before ranking;
- recording hashes as review flags, never as automatic rejections;
- collusion signals between builder–tester pairs;
- a Wilson lower bound for reliability;
- an append-only points ledger with reversal entries.

## 9. Open questions for Hamza
1. **Do badges wait for the dispute window too?** This proposal earns the badge at approval and holds only its points. The alternative moves U9 to the day the points post.
2. **Is there a dispute window after an approval, and who can open it** (the builder, an admin)? If there is none, points can post at approval, and "held" and the 7-day edit window for the helpful mark both go away.
3. **Should builders ever filter or invite testers by level or badge** (for example Device specialist for a given device)? It is useful, but it gives points indirect cash value.
4. **What should builders see?** The proposal shows builders only the counts and up to two badges, never points, rank or level. Is that enough, or should they see the level too?
5. **Leaderboard default and window.** Is a tester shown by default (with "Hide me"), or hidden until they opt in? Is a rolling 90 days right?
6. **Which badge is a tester's key badge** on the leaderboard: the highest tier, the newest, or one the tester picks?
7. **How is a device verified** for Device specialist? It is self-declared today, and builders will read the badge as verified. It stays single-level until tiers can count a quality event on that device.
8. **If an admin overturns a rejection,** does the builder's helpful mark come back, and can the builder still set it?
9. **Should Helpful feedback need marks from at least 3 builders,** with a builder's marks capped at 30% of a study, as the research suggests?
10. **Identity before ranking.** Should the leaderboard require one strong identity signal (the research's Tier 1: a Seeker Genesis Token, World ID or a vetted attestation), on top of the posted-sessions threshold?
11. **Should points diminish for repeated approvals from the same builder** (research §6.3 and §6.5), on top of the builder cap?
12. **The values:** point amounts, the builder cap (3 sessions in 30 days), tier thresholds, level names and thresholds, the 7-day hold, and the ranking threshold (5 posted sessions from at least 2 builders).
13. **U9 as the ninth Uplight moment.** Accepting it amends the Lens spec as §5 says.

## 10. If this is approved: where it would land
These are suggestions to check against Hamza's plan. None of this exists yet.
- **API.**
  - A points ledger beside `apps/api/src/ledger.ts`. It must stay separate from the credits ledger, so points can never post to a credit account. It is append-only, with reversal entries for voided sessions, and every entry carries its rule (accepted test, helpful, finding, on time, clean run) and its `participation_id`.
  - Badge awards with their tier and `earnedAt`, plus the tester's `lastSeenBadgeAt`.
  - A 90-day leaderboard view that excludes hidden testers.
- **Contracts.** Points, badges and the level go on the tester's own profile response. The builder's review response carries only the track record counts and up to two badges (§6.3), never points, rank or level.
- **Mobile.**
  - A `reputation` kit beside `src/ui`: medallion, points chip, level meter, shelf item, badge row, badge sheet.
  - A `UPLIGHT`-style entry for U9's timings in `src/theme/motion.ts`.
  - The five new glyphs in the Lens glyph set.
- **Tests.** Tests that points never reach a credit account; the held → posted transition at the window; a reversal on a voided session; the builder cap; the U9 once-per-badge rule; and reduced motion.
