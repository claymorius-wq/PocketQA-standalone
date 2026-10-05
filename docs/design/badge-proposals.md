# Badge design (plan workstream F)

**Status:** the badge art is built (`feat/lens-badges`, 2026-10-05), on the rules that are live. It still needs Hamza's design sign-off. Badges have no cash value, aren't tokens or NFTs, and can't be traded. They are earned only from accepted work (`@pocket-qa/domain` `badgesFor`).

**In this build:** each badge is a Lens medallion (`src/ui/patterns/Medallion.tsx`), drawn from the reputation design (`docs/design/reputation-layer.md` §4 and Appendix A):
- **The socket** is a round recessed well, always drawn.
- **Earned:** lit violet glass with the brand lens's rim, a domed face and the lit glyph.
- **Not earned yet:** smoked glass sunk into the socket, with a muted glyph. The count toward the badge is drawn as an arc in the gap and written beside it ("1 of 3 helpful marks").
- **New:** an earned badge the device hasn't shown yet reads "Earned · NEW" on the visit it first shows.

It never uses gold, silver or bronze, a milled edge, a glow or a trophy. Nothing on the reputation screens is lit by an Uplight or animated.

| Badge | Rule (live) | Glyph |
|---|---|---|
| First accepted test | ≥ 1 accepted test (not reversed) | `accepted`: a round seal plate with a check cut through it |
| Reliable tester | ≥ 5 decided tests in 90 days, and quality score ≥ 60 | `reliable`: a tuning fork tilted 15°, the reference others are tuned against. Its arc shows the count or the quality bar, whichever is further behind |
| Helpful feedback | 3 helpful marks by builders, not reversed | `helpful`: a note bubble with two ruled lines |
| *Platform* specialist (Android, iOS, Web) | ≥ 3 accepted tests on one platform | `deviceSpec`: the device slab with a loupe; text names the platform once earned |

**Where they show:**
- **Reputation screen:**
  - the hero: the hardest badge earned at 96, or the first one to earn;
  - every badge in a list at 56, with its rule or what it was earned for, and its count;
  - the track record.
- **Leaderboard:** each row's lead badge at 40. The top three share the first card, nearest the key light, with no podium and no metals. Your own row is pinned under the board.

The count toward each badge comes from the API (`Reputation.progress`, domain `badgeProgress`, contract 0.6.1), counted by the same rules as `badgesFor`.

**Design rules:**
- No ranks by volume, deposit or money.
- Badges never imply earnings.
- Every badge has a text label; colour, light and the arc are never the only signal.
- The light theme draws the medallion flat from the palette:
  - the socket on surfaceAlt with a hairline;
  - the body on surface with a borderStrong rim;
  - the glyph and the arc in primary.

**Not built (proposals in `reputation-layer.md`, waiting for the decisions in its §9):**
- tiers and beads;
- levels and the level meter;
- held points;
- the U9 badge-earned moment;
- Sharp eye;
- the You tab;
- the builder's track-record card.
