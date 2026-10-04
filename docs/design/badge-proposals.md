# Badge design proposals (plan workstream F)

**Status:** proposals for review. Badges have no cash value, aren't tokens or NFTs, and can't be traded. They are earned only from accepted work (`@pocket-qa/domain` `badgesFor`).

**In this build:** each badge uses an existing Lens glyph tile (`GlassTile`) beside its name and one-line description. Screenshot: `docs/reviews/wallet-rewards/browser/tester-reputation-dark.png`. Dedicated badge art is a later design task, and must be approved before any production assets exist.

| Badge | Rule | Glyph now | Proposal for dedicated art |
|---|---|---|---|
| First accepted test | ≥ 1 accepted test (not reversed) | `approve` (check) | A single lens ring with a check, in the primary tint |
| Reliable tester | ≥ 5 decided tests in 90 days, and quality score ≥ 60 | `consent` (shield) | A shield with three stacked arcs. The arcs stand for consistency, not volume |
| Helpful feedback | 3 helpful marks by builders, not reversed | `info` | A speech lens with a spark |
| *Platform* specialist (Android, iOS, Web) | ≥ 3 accepted tests on one platform | `device` | The device glyph with a small platform mark; text names the platform |

**Design rules:**
- No ranks by volume, deposit or money.
- Badges never imply earnings.
- Every badge has a text label; colour is never the only signal.
- Each badge passes the app's contrast tests in both themes.
