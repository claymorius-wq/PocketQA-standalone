# Freeze candidate: shared public demo convenience for the preview

**Branch:** `feat/preview-convenience`, staged and not committed until review. **Base:** `main` at `efabf42`. **Author:** lead (solo, claude-opus-5-5). **Reviewer:** `pqa-qa` (read-only).

**Authorization.** Hamza asked for easier access and confirmed it in-session after being told it removes meaningful access protection:
- the gate password changed to the simple value Hamza requested (not written in any repo file), prefilled on the gate page;
- the demo tester prefilled at sign-in;
- a Tester/Builder/Admin picker, with no auto-submit.

From now on the gate is a **publicly discoverable convenience, not privacy** (ADR 0004 addendum).

## Changes
- **`scripts/preview/gate-server.mjs`:**
  - optional `convenience` config: a gate prefill, HTML-escaped and labelled "not access protection";
  - `GET /__preview/bootstrap.json`, served **only after the gate check**, GET only, `no-store`, with a sandbox CSP;
  - `loadConvenience()`: the file must be 0600 and may list only `demo-{role}@pocketqa.example`;
  - the CLI refuses to start if the prefill doesn't match the scrypt hash;
  - a vanished static file now ends that one response instead of crashing the process.

  The limits, Origin, Host, path canonicalization, block list and revocation are all unchanged.
- **`apps/mobile/src/preview/demoAccounts.ts` and `app/(auth)/sign-in.tsx`:**
  - only when the build has `EXPO_PUBLIC_PREVIEW=1` and runs on web, the sign-in screen fetches the bootstrap, keeps only the synthetic accounts, prefills the tester and shows the role picker; the visitor presses Sign in;
  - the footer reads "Public demo preview · synthetic data" in the preview build;
  - native and local builds never fetch, and contain no credentials.
- **`init-preview.mjs --password-stdin`:** a chosen password through the same scrypt scheme, with a new salt and cookie key on `--rotate`, so old sessions are invalid. Nothing is printed.
- **`enable-convenience.mjs`:** writes the 0600 convenience file, after the password is verified against the hash. `--off` removes it.
- **`build-web.sh`:** sets the preview flag, builds beside the target and swaps it in, then runs `assert-no-secrets.mjs` (fails if any generated secret value appears in the bundle).
- **Scripts:** `start.sh` and `seed-demo.mjs` take state, data and web directory overrides, used for isolated tests in git-ignored `.preview-test/`. The scanner forbids `.preview-test/`.
- **Smokes:** a `PREVIEW_EXPECT_CONVENIENCE=1` mode. The browser smoke signs in as every role with **clicks only**.
- **Docs:** ADR 0004 addendum; activation doc section with the parent's restart requirement.

## Evidence (isolated `.preview-test/` instance; the live 3422/3423 preview, `.preview/` and `preview-data/` were untouched)
- **Tests:**
  - 35 root node tests: gate, scripts, scanner.
  - mobile `demo-accounts.test.ts`: 4 tests.
  - `pnpm verify` EXIT=0, secrets 393 files clean.
  - Mutations, each caught:
    - C1: bootstrap served without the gate;
    - C2: prefill not escaped;
    - C3: any account accepted;
    - C4: bootstrap accepts any method;
    - C5: rotation keeps the cookie key.
  - A first mutation run hung because a failing test left a server open. The test cleanup was fixed, the file was restored with `cmp`, and the reruns completed.
- **Web build:** the secret check found 0 occurrences of the 7 live values in 21 bundle files. A scan of all 393 repo files found 0 occurrences of 14 values (live plus test).
- **Smokes:**
  - `http-smoke-local.txt`: 21/21. Gate prefilled and labelled; bootstrap refused before the gate and lists the 3 roles after it.
  - `browser-smoke-local.txt`: 18/18. The gate was entered by a click on the prefilled form; tester was prefilled by default; tester, builder and admin each signed in via the picker plus Sign in; 0 foreign requests; 0 CSP violations.
  - Screenshots are in this folder.
- **Not yet done (after review):** the live web rebuild, the live rotation to the requested password, the live convenience file, and the parent's restart. Then public verification.

## Review r1 fixes (`verdict-qa-r1.md`: CHANGES_REQUIRED, 2×P2 and 3×P3; all addressed)
- **P2: password in a committed doc.** The value has been removed; the docs now say "the requested simple password". It was never committed, so it isn't in git history.
  - `pnpm verify` now also runs `assert-no-secrets.mjs --repo`, which scans every committable file for every generated secret value found in `.preview/` and `.preview-test/*/` (counts only).
  - Hamza should confirm the value isn't used for anything else.
- **P2: "Private preview" with the prefill on.** When the convenience is on, the gate page and its error pages read "Public demo preview … not access protection: treat everything here as public". The prefill is kept on the 401 and 429 pages. A test asserts there is no "Private" on the gate or wrong-password pages.
- **P3: docs disagreed.** The activation doc now says the live steps happen only after approval.
- **P3: open publishing.**
  - `POST /auth/register` is refused at the gate (403), and the preview build hides "Create an account".
  - ADR 0004 records the shared builder/admin publishing risk, with an exact takedown and reset procedure.
  - Mutation C6 (register unblocked) is caught.
- **P3: state-folder override.** `scripts/preview/paths.mjs`, `stateDir()` in the scripts and a check in `start.sh` allow only `.preview` or `.preview-test/*`.
  - `init-preview` now validates before creating anything.
  - Mutation C7 (any folder) is caught.
  - The first C7 run exposed a test-safety gap: the mutated script wrote a throwaway random secret into `docs/`. It was untracked and deleted at once, never staged, and was not a live value. The negative test now also passes an invalid password, so a regression writes nothing; the C7 rerun wrote nothing.

**r2 evidence:**
- 29 gate and script tests.
- Isolated instance (exact PIDs gate 39399 and API 39374/39375, ports 50995/50996), rebuilt and restarted after the fixes:
  - `http-smoke-local.txt`: 21/21, including self-registration getting 403;
  - `browser-smoke-local.txt`: 18/18, clicks only for every role;
  - the bundle secret check found 0 occurrences of 58 values.

## Incident during this candidate (disclosed)
- While restarting the isolated test instance, the lead ran `pkill -f "scripts/preview/start.sh"`. That pattern also matched the **parent-managed live preview** and killed it. The public URL returned 502 at 12:03.
- No live files were changed.
- The parent restored the approved `main` gate snapshot: gate PID 40210 on 3422, API on 3423.
- Rule from now on: never `pkill`; only exact PIDs recorded in `.preview-test/test-pids`.
