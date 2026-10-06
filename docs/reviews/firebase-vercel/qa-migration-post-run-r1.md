# pqa-qa: post-run check of the real migration (pocketqa-optijara, `b8018ae`, 2026-10-06T07:18Z)

## What I verified myself (read-only, no credentials)
| Check | Result |
|---|---|
| **Post-run manifest file** (`~/.local/share/pocketqa/migration/post-run-manifest-20261006T071831.json`, 0600) | sha256 **`4b8207ef…178e`**, and `cmp` is **IDENTICAL** to the approved dry-run manifest file `manifest-686c435d….json`, which I had independently reproduced byte for byte on the emulator earlier |
| **Report** (`post-run-report-…json`, 0600) | approved = planned = post = **`686c435d…39a7`**, `postMatchesApproved: true`. Pre-check: 573 planned, 0 identical, **0 conflicting, 0 unplanned users**. Objects: **10 uploaded, 1 server-copied, 11 verified and registered**, `failed: null`. Documents: **573 created**, 0 identical, 0 conflicting |
| **Durable backup** | still `3501bc9e…` |
| **Hosted, unauthenticated** | `POST /api/evidence/4aef8a84…/playback-token` without auth gives **401** |

## What that proves, and what it doesn't
**What it proves:**
- **Data and objects match the approved migration.** The run builds its post-run manifest by **reading back from production Firestore**: per-collection counts and checksums, the 19 relations, the ledger reconciliation, `migrated_link` on 77 users with 0 admins, and the Seeker flags. Its hash equals the approved one, so the production data matches the approved migration exactly. Each of the 11 objects was HEAD-size and full-GET sha256 verified before registration, and the Seeker object came from a server copy of the archive with the archive left unregistered.
- **The source was never touched.**

**What it doesn't prove:**
- **Who ran the reads.** The production reads were executed by the lead's process with the lead's credentials. I hold no production Firestore or R2 credentials, by design, so I haven't read production myself.
- **Live access control.** This is not yet tested with real accounts.

## Pending (blocked on accounts, not on code)
1. **Owner playback:** Hamza signs in on https://pocketqa.vercel.app with his verified email. That should claim his migrated account (§7(a)): one `user.identity_linked` audit row, `migrated_link` cleared. Then the Seeker evidence `4aef8a84…` playback-token gives a presigned GET whose download sha256 is **`3ee5d78c…a73`** (27,178,114 bytes).
2. **Denial for an unrelated tester:** a second, unrelated tester account gets **403/404** on that evidence's list, playback-token and findings. That needs an account on the production project, and I was told **not** to create Firebase accounts there. So either Hamza or the parent approves one synthetic `@example.test`-style account (or Hamza uses a second address), or the lead runs it with a disposable account and I review the transcript.
3. **Browser upload:** blocked by bucket CORS (known gap a). The native APK path is unaffected.

## Verdict
**The migration result is ACCEPTED at the data level:** the manifest is identical to the approved one, 0 conflicts, 0 failures, the source is untouched, and an unauthenticated request is denied.

**The live owner-playback and unrelated-tester denial checks are PENDING** on Hamza's sign-in and an approved second account. Until those pass, don't claim that "migrated submissions are accessible to their owners on hosted".
