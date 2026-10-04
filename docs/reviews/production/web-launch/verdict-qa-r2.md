# pqa-qa verdict: web-launch-qa-r2 (targeted re-review of the r1 P3s)

**Candidate:** code `4f9ae9d`, evidence and docs `cd98c74`, on `feat/web-launch-e2e`.
- Reviewed `git diff 5c63815..cd98c74`: 16 files.

**Rules held:**
- Read-only, and no other file changed. The worktree was clean apart from this file.
- No live runs and no Firebase or R2 contact.
- No subagents and no advisor.

## What I ran (Node v24.21.0)
- **`node --test scripts/production-web-server.test.mjs`:** 10/10 pass, including the new "states the client address itself and drops client-supplied forwarding headers" test.
- **`npx jest __tests__/auth-screens.test.tsx`:** 41/41 pass.
- **Evidence token scan** of every file in `docs/reviews/production/web-launch/*.txt` and `docs/reviews/production/live/web-live-e2e.txt`:
  - **0** JWT-shaped `eyJ…` strings;
  - **0** `X-Amz-Signature` or `X-Amz-Credential`;
  - **0** `Bearer <token>`;
  - **0** `AIza` or `AKIA`;
  - **0** 32-hex ids (so the R2 account id isn't printed either).
  
  The whole `5c63815..cd98c74` diff also has 0 added lines with `X-Amz-`, JWT or bearer patterns.

## r1 findings
| r1 | Change | Status |
|---|---|---|
| **P3-1: forwarding headers** | `web-server.mjs:43-58`, `:118-119`. `forwarded`, `x-forwarded-for`, `x-forwarded-host`, `x-forwarded-proto` and `x-real-ip` are deleted after the hop-by-hop strip. `x-forwarded-for` is then set by the front door: `CF-Connecting-IP` only when the socket peer is loopback (`127.0.0.1`, `::1`, `::ffff:127.0.0.1`) **and** `isIP(cf)` passes, otherwise the socket peer. With the API's production `trustProxy: loopback`, `req.ip` is therefore the visitor IP set by Cloudflare's edge, or the peer. A client can't steer it through the tunnel (Cloudflare overwrites `CF-Connecting-IP`). The new test covers the spoofed set, a valid CF IP and a garbage CF value | **fixed** |
| **P3-2: CSP detector** | `web-launch.spec.ts:109-113`. The builder page fetches `https://csp-probe.example.test/`. It's outside `connect-src` and isn't routed, so it's blocked by the CSP before any network. The run must see a console report naming the probe, then resets, and the final `seen.csp` is `[]`. The docs now say "**Enforcement** is negative-controlled", and that the detector is self-tested in each run (`web-launch.md` §1, `progress.md`) | **fixed** |
| **P3-3: seeking** | `web-launch.spec.ts:199-213`. `currentTime = 2`, waiting for `seeked`, requires ≥ 1.9 s. Then a page `fetch` of the same media URL with `Range: bytes=1000-1999` must give `{status: 206, content-range: bytes 1000-1999/<exact clip size>, length: 1000}`. That proves byte-exact mid-file ranges through the front door, API and R2. The S4 claim "with seeking" is now backed | **fixed** |
| **P3-4: wording** | "✅ §1, for the SHA named in `e2e-live.txt`"; the front door row says "r1 APPROVE; r2 pending" | **fixed** |
| **P3-5: guarded `signOut`** | `SessionProvider.tsx:219-221`: `.catch(() => {})` after a successful creation. A lingering unverified Firebase session is handled by the existing unverified-session discard on sign-in or restore | **fixed** |
| **P3-6: traces** | `playwright.live.config.ts:21-22`: `trace: 'off'`. The route handler try/catches `route.fetch` and aborts quietly; contexts `unrouteAll({ behavior: 'ignoreErrors' })` before closing | **fixed** (see P3-8) |
| **P3-7: bucket-scoped CSP** | `connectOrigins(account, bucket)` gives `https://<acct>.r2.cloudflarestorage.com/pocketqa-evidence/`. The bucket is validated, `appCsp` allows only one `/segment/` path, and the plist pins `WEB_R2_BUCKET=pocketqa-evidence`. A CSP source with a trailing slash matches every key under the bucket, and presigned URLs are path-style (`r2.ts:16` `forcePathStyle: true`). Live run 9 passed the PUT under the narrowed CSP | **fixed** |

## Specific checks
- **Can the quiet abort mask a real failure?**
  - `route.fetch` throws only on **network-level** failure to the loopback front door. HTTP errors such as 4xx, 5xx or 502 are returned as responses and fulfilled unchanged, so the app and the assertions still see them.
  - A network-level failure of the front door aborts the document or the API calls the app depends on, and the next `toBeVisible`, `toContainText` or status assertion fails the run.
  - CSP-blocked requests never reach the route handler, so they can't be swallowed.
  - The aborts during teardown are prevented by `unrouteAll` before `close`.
  - **What's left:** a network-level abort of a request **no assertion depends on** (for example a font or a background refetch) would pass silently. Low risk; P3-8.
- **Do the evidence files contain tokens or presigned query strings?** None (scan above).
  - **The run-7 incident** is recorded honestly in `web-live-e2e.txt`: a 1-hour ID token for one synthetic tester, in the lead's terminal only.
  - It was an ID token, not a refresh token. It has expired by now and belonged to a synthetic `@example.test` account. Nothing reached the repo, and the scratch traces were deleted.
- **Inventory:**
  - **26 users** = 17 + 9 (runs 7–9 × 3);
  - **24 objects** = 18 + 6 (3 uploads × quarantine plus evidence copies);
  - all synthetic, nothing deleted, all on the A5 cleanup list.

## Findings (no P0, P1 or P2)

### P3-8: make the quiet abort observable (`apps/mobile/e2e-live/web-launch.spec.ts:44-51`)
- Count aborts in `seen`, for example `seen.aborted += 1` in the catch, and assert `seen.aborted === 0` just before `unrouteAll`.
- Then even a request no assertion depends on can't fail silently, while teardown stays quiet.

### P3-9 (doc): note the trust assumption for `CF-Connecting-IP`
- Any **local** process can connect to the loopback front door and set `CF-Connecting-IP`.
- That's acceptable on a single-tenant host. Add one line to the cutover or runbook: the front door must stay loopback-only behind the tunnel, with no other local listener proxying to it.

## Verdict
**Every r1 P3 is fixed, with tests or live evidence.**
- Forwarding headers can no longer be spoofed through the tunnel.
- The CSP is narrowed to the bucket, with its detector self-tested and its enforcement negative-controlled.
- Seeking is proven with an exact mid-file 206.
- The sign-out is guarded, and no traces are kept.
- The evidence is free of tokens and presigned query strings.

**Live cutover stays blocked** by A5, A9, the Firebase plan and `IDENTITY_PLATFORM` console check, A7 and B4, as the docs state.

VERDICT: APPROVE
