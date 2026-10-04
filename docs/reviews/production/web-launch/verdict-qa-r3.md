# pqa-qa verdict: web-launch-qa-r3 (final exact-candidate confirmation)

**Final code candidate:** `184e0a23bb97a4433c9f3ae464cec9bce545f020`.
**Evidence commit:** `42215dde81d2035d11a92051dc0d65373ade204c` (HEAD; docs only), on `feat/web-launch-e2e`.

Reviewed `git diff cd98c74..HEAD`: 7 files.

**Rules held:**
- Read-only, and no other file written. The worktree was clean before this file.
- No live runs and no Firebase or R2 contact.
- No subagents and no advisor.

## Exact SHA and scope
- `git log cd98c74..HEAD` shows exactly two commits: `184e0a2` (fix: the r2 P3s) and `42215dd` (docs: evidence).
- **The only code change since my r2 APPROVE** (`cd98c74`, code `4f9ae9d`) is `apps/mobile/e2e-live/web-launch.spec.ts`, +7/−2:
  - `seen.aborted` added to the type and the initialiser;
  - `seen.aborted += 1` in the route catch;
  - `expect(seen.aborted).toBe(0)` before `unrouteAll`.
  
  This is exactly r2 P3-8.
- No change to `scripts/`, `deploy/`, `apps/api`, the app source or `package.json`.
- `42215dd` touches no file outside `docs/`.
- **P3-9:** `docs/production/web-launch.md:81` now states the trust assumption: any local process could set `CF-Connecting-IP`, so the front door stays loopback-only behind the tunnel, on a single-tenant host, with no other local listener proxying to it.
- **The committed `verdict-qa-r2.md`** is my r2 file, unchanged, ending `VERDICT: APPROVE`.

## Evidence
| File | SHA in the file | Result | Tokens (JWT `eyJ…`, `X-Amz-Signature` or `X-Amz-Credential`, `Bearer …`, `AIza`, `AKIA`, 32-hex) |
|---|---|---|---|
| `web-launch/pnpm-verify.txt` | `184e0a2` | EXIT=0. Scripts 57; contracts 17; domain 170; API 376 plus 2 skipped; mobile 1021 | all 0 |
| `web-launch/e2e-live.txt` | `184e0a2` | 1 passed, EXIT=0 | all 0 |
| `web-launch/playwright.txt`, `e2e-firebase.txt` | `4f9ae9d` (stated in `verification.md`) | 14/14 and 4/4 | all 0 |
| `live/web-live-e2e.txt` | runs 1–10 | run 10 PASS at `184e0a2` | all 0 |

- **Reusing the `4f9ae9d` Playwright and emulator outputs is justified.** `playwright.config.ts` uses `testDir: './e2e'`, the emulator config uses `testDir: './e2e-firebase'`, and jest ignores `/e2e-live/`. So the only changed code file isn't loaded by those suites.
- **`check-secrets` on HEAD:** 743 committable files, no findings.
- **Inventory after run 10:**
  - **29 users** = 26 + 3;
  - **26 objects** = 24 + 2 (one upload, quarantine plus evidence);
  - all synthetic `pqa-*` / `@example.test`, nothing deleted, all on the A5 cleanup list.

## Findings
None.

## Verdict
**`184e0a2` is the exact final web-launch code candidate**, with docs and evidence at `42215dd`.
- Every finding from r1 and r2 is fixed.
- The evidence is redacted, token-free, and tied to the stated SHAs.
- Nothing else changed.

**Live cutover remains blocked** by A5, A9, the Firebase plan and `IDENTITY_PLATFORM` console check, A7 and B4, as `docs/production/web-launch.md` §4 states.

VERDICT: APPROVE
