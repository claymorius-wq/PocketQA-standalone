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

## r2: hosted wiring and synthetic-tester checks (the lead's transcript at `cb4844d`, plus my own independent run)
**The lead's transcript** (`docs/verification.md`, last section) has been reviewed:
- **Auth domains:** the authorized domains went from 3 to 4, with every previous one kept (read back).
- **R2 CORS:** add-only. The `pocketqa.optijara.ai` PUT rule is kept verbatim, and the `pocketqa.vercel.app` PUT rule was appended (read back).
- **The synthetic tester:** one labelled tester (an `@example.test` address, not Hamza's).
- **The e2e run:** a real-Chromium PUT of a **6,914,699-byte** file (above 4.5 MB) from the Vercel origin returned 200; complete returned 200; own playback had a matching sha; cross-user access to the Seeker evidence gave 404; no token gave 401; UI sign-in persisted across a reload; 0 CSP violations.

**My independent run** (as the synthetic tester; credentials loaded from `~/.config/pocketqa/qa-synthetic-tester.env` (0600) into the process, **never printed**; read-only plus a playback-token request):
| Check | Result |
|---|---|
| `GET /me` | 200, tester, "QA synthetic tester (hosted)" |
| **Cross-user, the Seeker submission:** `POST /evidence/4aef8a84…/playback-token`, plus `GET /participations/<seeker participation>` and its `/evidence`, `/findings` and `/devnet-transfers` | **404 NOT_FOUND** on all 5, with no URL in any body. That's **indistinguishable** from a nonexistent id (a random evidence id also gives 404 NOT_FOUND), so existence doesn't leak |
| Own evidence `8c6db250…` playback-token | 200, a URL present, no token |
| Presigned GET | Host `8e2ef86d….r2.cloudflarestorage.com`, path `/pocketqa-evidence/evidence/<id>`, **`X-Amz-Expires=300`** (≤ 5 min, as planned). Download **200, 6,914,699 bytes, sha256 `a5e20d7bdf52bc55…`**, equal to the transcript |
| The same URL with `Origin: https://evil.example` | no `access-control-allow-origin` (CORS is narrowed to the app origins) |

**P3 (data hygiene):** to complete the e2e, the synthetic tester **joined a migrated study** (synthetic builder) and uploaded evidence. Production now carries one labelled synthetic participation and evidence object (it counts toward that study's slots). That's acceptable and labelled. Record it in the progress notes so later counts or exports aren't mistaken for real activity. Any removal waits for Hamza's decision; there's no automatic deletion.

**Status:**
- **Unrelated-tester denial: PASSED,** verified independently.
- **A browser upload over 4.5 MB, playback and expiry: PASSED** (my P3-3 is closed).
- **Still PENDING:** owner playback of the Seeker recording (sha `3ee5d78c…`). It needs Hamza's own sign-in, which claims his migrated account.
