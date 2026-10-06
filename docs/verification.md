# Verification log

This log records actual commands and their actual output only. Predicted results never go here. Each entry says who ran it, where (pane or worktree), and when. Long raw outputs live in `docs/reviews/<phase>/` files, and each entry links its file.

## 2026-10-02: Foundation round 2 (lead, `wX:p1`, main checkout, uncommitted tree)

Runtime: Node v24.21.0 (nvm), pnpm 10.32.1. For registry, schedule and genesis evidence, see `docs/reviews/phase0/evidence-registry.txt`.

### Toolchain probes (verbatim)
```
$ adb devices -l
List of devices attached

$ ~/Library/Android/sdk/emulator/emulator -list-avds
Medium_Phone_API_36.1

$ "/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java" -version 2>&1 | head -1
openjdk version "21.0.8" 2025-07-15

$ curl -s -m 15 https://api.mainnet-beta.solana.com -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"getGenesisHash"}'
{"jsonrpc":"2.0","result":"5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d","id":1}
```

### Email normalization: red, then green (post-approval P3 fix #6)
```
$ pnpm --filter @pocket-qa/contracts test   # new test added, schema not yet changed
     × normalizes emails with surrounding whitespace and case 2ms
 FAIL  src/index.test.ts > contracts > normalizes emails with surrounding whitespace and case
AssertionError: expected false to be true // Object.is equality
      Tests  1 failed | 13 passed (14)
```
After switching `Email` to `z.string().trim().toLowerCase().pipe(z.email().max(254))`, the final run below shows `Tests 14 passed (14)`.

### `pnpm verify` on the tree being committed (verbatim, blank lines and ANSI codes stripped)
```
$ pnpm verify; echo EXIT=$?
> pocket-qa@ verify /Users/hamzadiaz/Projects/pocket-qa
> pnpm check:secrets && pnpm typecheck && pnpm lint && pnpm test
> pocket-qa@ check:secrets /Users/hamzadiaz/Projects/pocket-qa
> node scripts/check-secrets.mjs
check:secrets passed: 31 committable files scanned, no findings.
> pocket-qa@ typecheck /Users/hamzadiaz/Projects/pocket-qa
> pnpm -r --if-present typecheck
> @pocket-qa/contracts@0.2.0 typecheck /Users/hamzadiaz/Projects/pocket-qa/packages/contracts
> tsc -p tsconfig.json
> pocket-qa@ lint /Users/hamzadiaz/Projects/pocket-qa
> eslint .
> pocket-qa@ test /Users/hamzadiaz/Projects/pocket-qa
> node --test "scripts/*.test.mjs" && pnpm -r --if-present test
✔ flags known token shapes (1.066792ms)
✔ flags credential-named identifiers regardless of prefix or case (0.065875ms)
✔ ignores ordinary code, empty env values and spaced passphrases (0.243042ms)
✔ allow marker covers only its own line (0.093875ms)
✔ forbidden paths (0.263292ms)
✔ CLI exits 1 on a planted secret and on a force-added sqlite file, 0 on a clean repo (146.744833ms)
✔ CLI still runs when invoked through a symlink (49.236042ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 229.986584
> @pocket-qa/contracts@0.2.0 test /Users/hamzadiaz/Projects/pocket-qa/packages/contracts
> vitest run
 RUN  v5.0.3 /Users/hamzadiaz/Projects/pocket-qa/packages/contracts
 Test Files  2 passed (2)
      Tests  14 passed (14)
   Start at  22:43:15
   Duration  114ms (import 47%, transform 43%, tests 7%, worker 3%)
EXIT=0
```

Notes:
- `lint` runs real ESLint (`eslint .` at the root, typescript-eslint recommended) over `scripts/` and `packages/`.
- So far, `typecheck` covers only `packages/contracts`. Each new package adds its own `typecheck` script.
- Superseded: the round-1 entry (Node 25.4.0, 2 scanner tests and 7 contract tests) was replaced after independent review. Node 25 is EOL.

## 2026-10-02: Phase 2-3, domain + API (lead, `wX:p1`, branch `feat/domain-api`)

- `pnpm verify` → EXIT=0. Full output: `docs/reviews/phase2-3/pnpm-verify.txt`.
  - check:secrets: 88 files clean.
  - Scanner self-test 7/7, contracts 14/14.
  - domain 156/156, with the coverage thresholds met.
  - api 238/238 across 8 files.
- Red runs before the fixes:
  - Domain: all 8 test files failed with "Cannot find module" before any implementation existed.
  - Review fixes: 7 of 8 tests in `review-fixes.test.ts` failed before the fixes.
  - The error-mapping test failed against the old mapping (`1 failed | 10 passed (11)`).
- Mutation checks, as listed in `docs/reviews/phase2-3/candidate.md`: M3 → 11 failures, M5 → 2, M6 → 1, M7 → 66, M8 → 1. Removing both evidence-freeze layers → 2 failures; removing both redaction layers → 1.
- Real server on `127.0.0.1:8799` with a scratch data dir:
  - `lsof` shows the server listening on `127.0.0.1:8799`.
  - `/health` returned ok.
  - register and `/me` returned the user JSON with no password fields.
  - `/ai/status` returned `available:false`.
  - Origin `https://evil.example` got no ACAO header; `http://localhost:8081` was allowed.
  - The server log had 0 matches for the token, "bearer", or the password.
- Redacted log lines captured for `/media/<token>` and `/%6Dedia/<token>`: both show `"url":"/media/[redacted]"`.
- `create-admin` with the password piped on stdin printed "Admin account created." A second run printed "An account with that email already exists." and exited 1.

## 2026-10-02: Phase 4, Gate A (lead, branch `feat/mobile`)

- `pnpm verify` → EXIT=0. Full output: `docs/reviews/phase4/pnpm-verify.txt`.
  - mobile jest 99/99: contrast in both themes, upload queue (including the in-flight removal race and cancellation), capability matrix, a banned-copy scan of all UI strings, and focus refetch.
  - api 238/238, domain 156/156, contracts 14/14; secrets 167 files clean.
- `cd apps/mobile && npx playwright test` → 4 passed. Output: `docs/reviews/phase4/playwright.txt`. Each run uses a fresh API on 127.0.0.1:8787 with a temp data dir and a fresh `expo export` web build on 127.0.0.1:8090.
- Red runs before the fixes:
  - focus-refetch with the old dependency: `Expected number of calls: 0 / Received: 5`.
  - The upload race test: `1 failed, 3 passed`.
  - The removeSegment test: `1 failed, 5 passed`.
- Earlier E2E passes against the Metro dev server were **discarded** after I found the dev bundle was stale.
- Screenshots: 23 PNGs in `docs/reviews/gate-a/`.
- Emulator `Medium_Phone_API_36.1` booted headless (Android 16, API 36). Solana Mobile's official `mock-mwa-wallet` (commit d444aff, built with `./gradlew :app:assembleDebug` in scratch) installed as `com.solana.mwallet`. These are used in Phases 5 and 6.

## 2026-10-03: Phases 5-6, Android recorder and MWA link (lead, branch `feat/native`). EMULATOR ONLY

Device: AVD `Medium_Phone_API_36.1` (`sdk_gphone64_arm64`, Android 16, API 36). No physical device. Wallet: Solana Mobile **mock** wallet `com.solana.mwallet`, built from mock-mwa-wallet commit d444aff.

### Build
```
$ ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a   (JAVA_HOME=Android Studio JBR 21)
BUILD SUCCESSFUL in 24s
$ ls -la app-release.apk && shasum -a 256 app-release.apk
51000412 Oct 3 00:36
cfa929c247cfaab60c5b49760e34d3cc409c461153d0f5b22b0ae0d88ce960b3
$ adb install -r app-release.apk → Success
```

### Recording state (during record-consent, first manual run)
```
$ adb shell dumpsys activity services com.reshareai.pocketqa
  * ServiceRecord{... com.reshareai.pocketqa/expo.modules.pocketqascreencapture.ScreenCaptureService ...}
    isForeground=true foregroundId=4711 types=0x00000020 foregroundNoti=Notification(channel=pocketqa-recording ... flags=ONGOING_EVENT|NO_CLEAR|FOREGROUND_SERVICE ...)
$ adb shell dumpsys notification --noredact → android.title=String (Pocket QA is recording your screen)
$ adb shell dumpsys media_projection → packageName: com.reshareai.pocketqa  type: TYPE_SCREEN_CAPTURE
```

### Uploaded clip (server side, after record-consent)
```
evidence: { kind: 'screen_recording', mime_type: 'video/mp4', size_bytes: 1361076, duration_ms: 5716, captured_on: 'android' }
$ file <media file> → ISO Media, MP4 v2 [ISO 14496-14]
```

### Screen lock on this image
```
$ adb shell input keyevent KEYCODE_SLEEP → mWakefulness=Asleep
$ adb shell dumpsys media_projection | grep -c packageName → 1        (projection still active)
logcat: VirtualDisplayAdapter: Changing state of virtual display PocketQaCapture from ON to OFF
```
Status-bar chip → "Stop sharing" → `dumpsys media_projection | grep -c packageName` → 0, and logcat shows `Release VirtualDisplay PocketQaCapture`.

### Wallet link (mock wallet)
```
API: /wallet/nonce 200 → /wallet/link 200
wallet_links: [{ address: 'D9XZLRBjngUfC2VoSjKX6LVgSkxUJfopvF2yF8GrD9wN', linked_at: '2026-10-02T22:20:40.340Z' }]
wallet_nonces (latest): [{ used: 1 }]
Same wallet key from a second test account → /wallet/link 409, UI "This wallet is already linked to another account."
```

### Native gate run on the final APK
```
$ WALLET_PIN=<test AVD pin> apps/mobile/e2e/maestro/run-native.sh
record-consent EXIT=0
record-decline EXIT=0
remove-segment EXIT=0
system-stop EXIT=0
wallet-decline EXIT=0
wallet-link EXIT=0
JUnit (6 files): tests="1" failures="0"
```
Curated screenshots and JUnit: `docs/reviews/gate-b-emulator/`.

### Repo checks
- `pnpm verify` → EXIT=0. Output: `docs/reviews/phase5-6/pnpm-verify.txt`. mobile 111/111.
- Web regression: Playwright 4 passed (`docs/reviews/phase5-6/playwright.txt`).

### Phases 5-6 round 3: final APK and run (2026-10-03)
```
APK 51001144 bytes, sha256 1c941c781e9e4fa529c46f2b2ca7b47dec5d48eb2d1a170a3da4ea7a67c0b02b
$ WALLET_PIN=<test AVD pin> apps/mobile/e2e/maestro/run-native.sh     (run 20261003-012751)
record-consent EXIT=0 active_projections=0
record-decline EXIT=0 active_projections=0
notifications-denied EXIT=0 active_projections=0
remove-segment EXIT=0 active_projections=0
system-stop EXIT=0 active_projections=0
notification-stop EXIT=0 active_projections=0
leave-while-recording EXIT=0 active_projections=0
wallet-decline EXIT=0 active_projections=0
wallet-link EXIT=0 active_projections=0
```
Server side, same run. Rows since the run start; API request log filtered to wallet and evidence routes.
```
evidence: [{ kind: 'screen_recording', mime_type: 'video/mp4', size_bytes: 1367648, duration_ms: 5241, captured_on: 'android' }]   ← the only upload in 9 flows
file: ISO Media, MP4 v2 [ISO 14496-14]
POST /participations/:id/evidence 200   (exactly one)
POST /wallet/nonce 200 → POST /wallet/link 200 → DELETE /wallet 200   (wallet-decline requested no nonce)
wallet_nonces issued during run: [{ used: 1 }]
```

## 2026-10-03: Phase 8 fixes (lead, branch `fix/final-qa`)

**Copy rule (final QA P2).** The domain rules now cover `paid`/`payout`, "…to your wallet", and currency amounts, with negations allowed.
```
$ npx vitest run src/copy.test.ts (domain)           → Tests 3 passed (3)
$ npx jest --ci __tests__/copy.test.ts (all UI strings) → Tests: 46 passed, 46 total
$ apps/api review-fixes.test.ts with main's copy.ts → 1 failed | 9 passed (10)   (red)
$ apps/api review-fixes.test.ts with the fix        → 10 passed (10)
```

**Web E2E** (now including the account-deletion UI): 5 passed. Output: `docs/reviews/final/playwright.txt`.

**Final APK** (rebuilt with the domain change):
```
apps/mobile/android/app/build/outputs/apk/release/app-release.apk
51002616 bytes  sha256 82f214ece799d209ffac6ef7279977d68e9c10154ed4e040600b3fe90cbdce85
$ WALLET_PIN=<test AVD pin> apps/mobile/e2e/maestro/run-native.sh   (run 20261003-014123)
record-consent / record-decline / notifications-denied / remove-segment / system-stop /
notification-stop / leave-while-recording / wallet-decline / wallet-link → all EXIT=0, active_projections=0
```

## 2026-10-03: Remaining local scope (lead, branch `feat/remaining-scope`, uncommitted candidate)

Full raw outputs: `docs/reviews/remaining-scope/` (`pnpm-verify.txt`, `../remaining-scope-playwright.txt`, `native/`, `ios/`).

**`pnpm verify` (latest tree):** EXIT=0.
```
check:secrets passed: 299 committable files scanned, no findings.
packages/contracts Tests 14 passed (14) · packages/domain Tests 166 passed (166)
apps/api Tests 268 passed (268) · apps/mobile Tests: 120 passed, 120 total
```

**iOS simulator.** No paid services were used: Xcode 26.4, the iPhone 17 / iOS 26.4 simulator, and an ad-hoc signature (`CODE_SIGN_IDENTITY=-`, `codesign -dv` → `Signature=adhoc`).
```
$ xcodebuild ... -configuration Release -sdk iphonesimulator ... CODE_SIGN_IDENTITY=-   → ** BUILD SUCCEEDED **
$ maestro --device <sim> test --debug-output=<workspace>/.results/ios ... ios-smoke.yaml
[Passed] ios-smoke (30s)      27/27 commands COMPLETED
```
- **The first runs found a real crash** in the simulator log:
  ```
  Terminating app due to uncaught exception 'RCTFatalException: Unhandled JS Exception: Invariant Violation: TurboModuleRegistry.getEnforcing(...): 'SolanaMobileWalletAdapter' could not be found.
  ```
  Fixed by making the MWA importers `*.android.ts`; the guard is `__tests__/platform-modules.test.ts`, red then green.
- **A keychain session survived reinstall.** Fixed by `src/auth/restore.ts` and `__tests__/session-restore.test.ts`, red then green.
- **The back button showed "(tester)".** The Maestro assertion failed on the old build, then passed after the fix.

**Real devnet confirmation: BLOCKED.**
```
requestAirdrop (api.devnet.solana.com) → -32603 Internal error, then 429 "You've either reached your airdrop limit today or the airdrop faucet has run dry"
```

**iOS Settings crash, reproduced and then fixed.**
```
# fixed tree with only link.android.ts renamed back to link.native.ts
[Failed] ios-settings (38s) (No visible element found: id: wallet-unavailable)
tab-settings tapped 02:52:31.8 → log 02:52:32.735: Terminating app due to uncaught exception 'RCTFatalException: Unhandled JS Exception: Invariant Violation: TurboModuleRegistry.getEnforcing(...): 'SolanaMobileWalletAdapter' could not be found
# restored link.android.ts, rebuilt (main.jsbundle sha256 32385ba4…)
[Passed] ios-settings (19s)
[Passed] ios-smoke (31s)
```

**Android, frozen candidate.**
```
apps/mobile/artifacts/pocketqa-release-85ae621a.apk  51022844 bytes
sha256 85ae621a1d855651c2babca12e4d34fed304cdc063938bc8eafbf6109c860d04
$ WALLET_PIN=<test AVD pin> apps/mobile/e2e/maestro/run-native.sh   (run 20261003-024918)
record-consent / record-decline / notifications-denied / remove-segment / system-stop /
notification-stop / leave-while-recording / wallet-decline / wallet-link / devnet-transfer-unfunded
→ all EXIT=0 active_projections=0
  server transfer state: awaiting_signature signature=null
```

**Web E2E, frozen tree:** `npx playwright test` → `8 passed (45.2s)` (`docs/reviews/remaining-scope-playwright.txt`).

**Review r1 fixes: red, then green** (`docs/reviews/remaining-scope/verdict-qa-r1.md`).
```
domain copy.test.ts (tester money in study text)      → 1 failed | 8 passed (9)   then 9 passed
api review-fixes.test.ts (POST /studies 400)           → 1 failed | 11 passed (12) then 12 passed
api remaining-scope.test.ts (stuck tasks; deletion)   → 1 failed each, then 8 passed (8)
mobile report-signature.test.ts                        → Cannot find module, then passed
mutations: M15 M16 M17 M18 (domain) M19 M20 (api) M21 (guard probe) → each 1 failed; all restored (cmp)
```

**r2 tree.**
```
$ pnpm verify → EXIT=0; check:secrets 338 files, no findings; contracts 14, domain 168, api 271, mobile 124
$ npx playwright test → 8 passed (45.9s)
apps/mobile/artifacts/pocketqa-release-e758f321.apk  51026792 bytes
sha256 e758f321ba21615b9cc92bdaf00bebae9ea72493d033f6f06fe6139c7ec90198
$ WALLET_PIN=<test AVD pin> run-native.sh (run 20261003-030814) → 10/10 EXIT=0 active_projections=0; transfer awaiting_signature signature=null
iOS simulator r2 (main.jsbundle 8e801e70…) → [Passed] ios-settings (19s), [Passed] ios-smoke (30s)
```

## 2026-10-03: Review r2 P3 follow-ups (lead, branch `fix/r2-p3`, base `fac4d34`)

```
domain copy.test.ts (4 natural payout phrases)   → 1 failed | 8 passed (9), then 9 passed
api remaining-scope.test.ts (same-signature retry) → expected 409 to be 200, then 8 passed
mobile report-signature.test.ts (full signature)  → 1 failed, then 2 passed
mutations M22 M23 M24 M25 M26 → each 1 failed; restored (cmp)
$ pnpm verify → EXIT=0; check:secrets 342 files; contracts 14, domain 168, api 271, mobile 124
apps/mobile/artifacts/pocketqa-release-14ac0c9e.apk  51026972 bytes  sha256 14ac0c9e9297a51fff2a0ad69f3c3cc82ee6bbc5176b08f1f60b2e7b579b31e8
$ WALLET_PIN=<test AVD pin> run-native.sh (run 20261003-032219) → 10/10 EXIT=0 active_projections=0; transfer awaiting_signature signature=null
iOS simulator (main.jsbundle 32a4ebac…) → [Passed] ios-settings (19s), [Passed] ios-smoke (31s)
$ npx playwright test → 8 passed (44.6s)
```

## 2026-10-03: Lens UI review fixes (branch `feat/lens-ui`, uncommitted; Windows 11, node 24.21.0)

```
$ pnpm typecheck        → EXIT=0 (contracts, domain, api, mobile: Done)
$ pnpm lint             → EXIT=0 (eslint ., no problems)
$ cd apps/mobile && pnpm test → EXIT=0
Test Suites: 16 passed, 16 total
Tests:       557 passed, 557 total
$ cd apps/api && pnpm test → EXIT=1
 FAIL  test/config.bind.test.ts > local-only configuration > refuses a data directory inside the repo that git would track
 AssertionError: expected 'C:\Users\…\pq\apps\api\.data' to match /apps\/api\/\.data$/   (known Windows path-separator baseline)
 Test Files  1 failed | 8 passed (9)
      Tests  1 failed | 270 passed (271)
```

Baseline before the fixes, same machine: mobile `Tests: 553 passed, 553 total` (16 suites). The count moved by removing the
layout-animation `Entrance`/`LensPressable` tests with that API and adding the review tests (step gap, focus-error well, LED,
static loading, sheet padding and commit opt-out, commit pass outliving the sheet, key light following the brightest moment,
light press feedback).

Not run here (no device attached): `e2e/maestro/sheet-keyboard.yaml` (new), the Playwright web suite, and the ADR 0006 Seeker
budget (SVG canvases per screen, Perf Monitor UI/JS fps). Run them on the Seeker before the freeze candidate.


## 2026-10-04: Cloud activation, live provider checks (lead, worktree `feat/cloud-auth-wallet`)

**How the evidence was produced.** These runs are not part of `pnpm verify` or CI; `test-live/` is excluded and runs only through `pnpm test:live`.
- **R2.** A scratchpad runner (not in the repo) read `R2_ENDPOINT`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` from the authorized `optijara-website/.env.local` inside its own process.
  - It derived the account id from the endpoint host and set `POCKETQA_R2_BUCKET=pocketqa-evidence` explicitly (never `R2_BUCKET_NAME`, the blog bucket).
  - It ran `vitest run --config vitest.live.config.ts test-live/r2.live.test.ts`.
  - It replaced every credential value in the output with `<redacted>`, and the saved output was then scanned for the raw values: 0 found.
- **Firebase.** The runner wrote the Firebase CLI login as a temporary `authorized_user` credential (0600, in the session scratchpad), removed it in `finally` and on SIGINT/SIGTERM, and redacted the refresh token, web key and client secret from the output.
- **Objects created:** a read-only `ListObjectsV2` on `pocketqa-evidence` printed keys and sizes only.

```
R2 live:        Tests 5 passed (5)                 objects created: 5 (listed in docs/reviews/cloud/live/r2-objects-created.md); deletions: 0
Firebase live:  Error: accounts:signUp: CONFIGURATION_NOT_FOUND   users created: 0
Guards (fake credentials, no requests sent): wrong account → "refusing: not the expected Cloudflare account"; bucket blog-assets → "refusing to run against bucket blog-assets"
```

### Post-approval safety corrections (2026-10-04, after `live-verdict-qa-r1` APPROVE; uncommitted)
- **Personal Firebase token withdrawn.** The Firebase runner above used the CLI's personal login as a temporary credential. That's no longer allowed. The runners `run-live-fb.cjs` and `gapi.cjs` were deleted from the scratchpad. A by-name check found no `fb-adc.json` and no `authorized_user` file in the scratchpad, the worktree or `/tmp/*.json` (values not printed). Future Firebase server tests use only the dedicated `pocketqa-api` service account (`docs/deploy/cloud-backend.md`, user action 2).
- **Firebase Auth is still not initialised.** A read-only `GET identitytoolkit v1/projects` (getProjectConfig) with the public web key was run twice:
  ```
  2026-10-04T01:44:39Z  400 CONFIGURATION_NOT_FOUND
  2026-10-04T01:47:22Z  400 CONFIGURATION_NOT_FOUND
  ```
- **No R2 deletion.** All lifecycle and expiry recommendations were removed from the deploy guide, the PR body and the candidates. The r2 adapter now refuses every delete unless `POCKETQA_R2_ALLOW_DELETE=1`; refused deletes stay in the `storage_deletions` outbox. Tests: `test/identity-config.test.ts` (off by default) and `test/storage.test.ts` (deletion off: after completion and the sweep, both the quarantine and evidence objects remain and the outbox is non-empty).
- **pqa-qa r1 fixes (`safety-verdict-qa-r1` CHANGES_REQUIRED, 2 P2s and 2 P3s).**
  - r2 refuses to start without a deletion policy.
  - Account deletion fails closed (409, nothing changed) while R2 deletion is off.
  - The bucket is pinned to `pocketqa-evidence`.
  - `pnpm verify` → EXIT=0 (`docs/reviews/cloud/live/safety-pnpm-verify.txt`): API 342 passed, 2 skipped.


## 2026-10-04: Production readiness (lead, worktree `feat/production-readiness`, base `9461db5` = `origin/main`)
The per-increment evidence files are in `docs/reviews/production/` (`inc*-pnpm-verify.txt`, `inc*-playwright.txt`, `inc*-e2e-firebase.txt`, Maestro folders). Node 24.21.0 throughout.

### Read-only provider probes (no mutation, no secrets printed)
```
GET identitytoolkit v1/projects (public web key, pocketqa-optijara)
  2026-10-04T09:18:20Z 400 CONFIGURATION_NOT_FOUND
  2026-10-04T09:45:42Z 400 CONFIGURATION_NOT_FOUND
  2026-10-04T10:22:53Z 400 CONFIGURATION_NOT_FOUND
GetBucketCors pocketqa-evidence → NoSuchCORSConfiguration (404)
gcloud --account admin@… projects describe pocketqa-optijara → needs interactive re-authentication
```

### `pnpm verify` (EXIT=0 at each increment's freeze)
| Increment | scripts | contracts | domain | api | mobile |
|---|---|---|---|---|---|
| 1 `a350118` | 42 | 17 | 170 | 355 + 2 skipped | 714 |
| 2 `90a5ddd` | 42 | 17 | 170 | 358 + 2 skipped | 722 |
| 3 `16378f4` | 42 | 17 | 170 | 360 + 2 skipped | 729 |
| 4 `4028884` | 47 | 17 | 170 | 369 + 2 skipped | 731 |

### Browser
- `cd apps/mobile && npx playwright test`:
  - inc1/inc2: 11/11;
  - inc3/inc4: 12/12, adding the two-wallet chooser test.
  
  `PW_EXIT=0` each time. The screenshots the suite rewrites were restored with `git restore`.
- `pnpm test:e2e:firebase` (Auth emulator, `demo-pocketqa`): 4/4 from inc2 on, covering sign-up/verify, the local-login refusal, resending verification, and the password reset round trip.
- `PROD_API_URL=/api bash scripts/production/build-web.sh`: EXIT=0. The secret check found 0 values in 29 files; no loopback API origin and no demo account in the bundle.

### Native (EMULATOR ONLY: AVD `Medium_Phone_API_36.1`, `sdk_gphone64_arm64`, Android 16; no physical device)
| Run | APK sha256 | Result |
|---|---|---|
| I8 green: `maestro test e2e/maestro/firebase-persistence.yaml` (dev prebuild; API in firebase mode plus the Auth emulator via `adb reverse`) | `b19367895794a00a2ea725f94c6e7689df4105cee399eacbc4107b81057ce81d` (rebuilt: same hash) | MAESTRO_EXIT=0: signed in after force-stop and relaunch |
| I8 red: same flow, native `getAuth` (memory only) | `a233bde4c5ff654bbeff19d6ee6d2fbec88b6983a0a1d6ebee18263f11a3d0a7` | MAESTRO_EXIT=1 at "discover-screen visible" after relaunch |
| W3: `wallet-login-mwa.yaml` (Solana mock wallet; local API with `POCKETQA_WALLET_LOGIN=1`) | `d061f40d8cf3a14195baa6d10490937f9cfab25538a1b6548dc9dffbfa3fb8f2` | MAESTRO_EXIT=0: the wallet showed the `pocketqa.local` SIWS text ("…never on a website… not a payment") → account created → Discover |
| W3: `wallet-login-mwa-decline.yaml` | same | MAESTRO_EXIT=0: "declined or closed. You are not signed in." |
| N1: production prebuild (`EXPO_PUBLIC_POCKETQA_ENV=production`, `EXPO_PUBLIC_API_URL=https://api.pocketqa.example`) | `1ba399a61d5837157b3293caa7906036a84bc4a91459685bc902e2497354b543` | No cleartext domains; the manifest references the network config. The bundle has the https API, 0 × `127.0.0.1:8787` and 0 demo accounts. The unreachable API is shown honestly (`native-production-build/launch.png`) |

The two earlier red-run attempts are not evidence. One reused an account. In the other, the mock wallet was in the foreground on the shared AVD. The test AVD PIN was passed through an env variable and redacted from the Maestro command logs; a scan of `docs/reviews/production` found 0 occurrences.

### Operations (inc4)
- **Real-process test** (`apps/api/test/operations.test.ts`):
  - register;
  - `db:restore` is refused while the API runs, by port and by pid file;
  - SIGTERM exits 0, the port is closed and the pid file is removed;
  - restart, then log in as the same user.
- **Backup drill** (`backup.test.ts`, `db-scripts.test.ts`): an online backup of a live WAL database, mutate, restore, and the backup state returns, with the pre-restore files kept.

## 2026-10-04: Lens screens, PR #3 (contributor session, claymorius-wq; Windows 11 clone of `feat/lens-ui` at `ad99009`)

**Where the output is.** The raw output of every command below is in `docs/reviews/lens/`, with local paths shortened to `<repo>` and `<tmp>` and the emulator's one-time codes masked. `candidate.md` there explains each file. Node v24.21.0, pnpm 10.32.1.

**How Playwright was run.** Both suites ran through a git-ignored mirror of the repo's configs:
- ports 8788, 8091 and 8900;
- `env:` instead of the POSIX `VAR=x cmd` syntax;
- screenshots written outside `docs/reviews`.

```
$ pnpm verify                                   EXIT=1 at the root scripts tests: tests 37, pass 33, fail 4
                                                (the 4 POSIX 0600 file-mode checks; same on main d358a05 here; code unchanged by PR #3)
  check:secrets passed: 590 committable files scanned, no findings.   secret check: 18 values, 590 files, 0 occurrences
  typecheck: 4 projects Done.   lint: no output.
$ pnpm -r --if-present test                     contracts Tests 15 passed (15); domain Tests 170 passed (170)
                                                API Tests 1 failed | 341 passed | 2 skipped (344)
                                                (config.bind expects a POSIX path; same on main d358a05 here; code unchanged by PR #3)
$ pnpm --filter @pocket-qa/mobile test          Test Suites: 42 passed, 42 total   Tests: 983 passed, 983 total
$ playwright test (mirror of playwright.config.ts)            11 passed (1.9m)
$ firebase emulators:exec ... test/firebase-emulator.test.ts  Tests 2 passed (2); the file failed in afterAll: rmSync EPERM (Windows)
$ firebase emulators:exec ... playwright.firebase.config.ts   2 passed
$ the offline test alone                        origin/main: 1 failed (strict mode: two empty-states); 75e009a: 1 failed; ad99009: 1 passed
```

Not run here, because no device was attached: the Maestro native flows, the iOS flows and the Seeker performance check.

## 2026-10-04: Lens follow-ups, sheet binding and web focus (contributor session, claymorius-wq; Windows 11 clone of `fix/lens-followups` at `fdb92e4`)

Raw output is in `docs/reviews/lens-followups/`, made the same way as the PR #3 entry above.

```
$ pnpm verify                                   EXIT=1 at the root scripts tests: tests 37, pass 33, fail 4 (the same 4 POSIX 0600 checks)
  check:secrets passed: 600 committable files scanned, no findings.   secret check: 18 values, 600 files, 0 occurrences
$ pnpm -r --if-present test                     contracts 15 passed; domain 170 passed; API 1 failed | 341 passed | 2 skipped (the same config.bind path test)
$ pnpm --filter @pocket-qa/mobile test          Test Suites: 42 passed, 42 total   Tests: 989 passed, 989 total
$ playwright test (mirror of playwright.config.ts)            13 passed (1.9m)   (the 11 from PR #3, plus focus-visible in dark and light)
$ firebase emulators:exec ... test/firebase-emulator.test.ts  Tests 2 passed (2); the file failed in afterAll: rmSync EPERM (Windows)
$ firebase emulators:exec ... playwright.firebase.config.ts   2 passed
$ focus-visible.spec.ts alone, scroll-padding switched off      2 failed: "scroll-padding-top covers the header scrim", Received 0 (expected >= 105 dark, >= 97 light)
```

## 2026-10-04 (afternoon): integrated release candidate (main `4bd307a` merged, plus inc5); details in `docs/reviews/production/rc-candidate.md`
- **`pnpm verify`:** EXIT=0. Test counts: scripts 47, contracts 17, domain 170, API 376 plus 2 skipped, mobile 1018.
- **Browser:** Playwright 14/14; Firebase emulator E2E 4/4; production web export EXIT=0.
- **Android EMULATOR, final APK `6f9208cd…`:**
  - `run-native.sh`: 12/12;
  - the MWA sign-in and decline flows with the **mock** wallet: both pass;
  - Firebase persistence: passes;
  - crash buffer: 0 entries.
- **iOS SIMULATOR, `main.jsbundle a9f23a2f…`:** `ios-smoke` and `ios-settings` pass. They failed on `09092f15…` before fix N-4.
- **R2 CORS on `pocketqa-evidence`:**
  ```
  plan create → readback matches
  PUT preflight from https://pocketqa.optijara.ai → 204; from https://evil.example → 403; GET → 403
  ```

## 2026-10-04 (evening): web launch closure, candidate `2f5cec4` (`feat/web-launch-e2e`)
Full outputs are in `docs/reviews/production/web-launch/`; the live run log and fixture inventory are in `docs/reviews/production/live/web-live-e2e.txt`.
- **`pnpm verify`:** EXIT=0. Secrets: 737 files, no findings. Tests: scripts 56, contracts 17, domain 170, API 376 plus 2 skipped, mobile 1021.
- **Browser:**
  - Playwright 14/14, EXIT=0;
  - Firebase emulator E2E 4/4, EXIT=0;
  - `pnpm test:e2e:live` 1/1, EXIT=0 (real Firebase and R2, non-production API, production web build and front door).
- **Live UIDs created by the passing run:** `RFi7fev9SWeNwFpcSvLwMhsHGxm1`, `ePOMhvhO5sYIN8F2nr0fk12nue13`, `VoI4XAAtX5XmIDlMvySefI1z5Ts1`.
- **Inventory after all runs:** 17 synthetic Firebase users and 18 objects in `pocketqa-evidence`. Nothing deleted.
- **Not run:** the billing read. A read-only Cloud Billing GET via the Firebase CLI login was **denied** by the session's permission system and not retried by any route.

## 2026-10-04 (evening): web launch, review-fix candidate `4f9ae9d`
This applies pqa-qa web-launch-qa-r1 (APPROVE, P3s only). Outputs are redacted for tokens and are in `docs/reviews/production/web-launch/`. They replace the `2f5cec4` files.
- **`pnpm verify`:** EXIT=0. Tests: scripts 57, contracts 17, domain 170, API 376 plus 2 skipped, mobile 1021.
- **Browser:** Playwright 14/14, Firebase emulator E2E 4/4, and `pnpm test:e2e:live` 1/1, all EXIT=0. The live run now also covers a seek to 2 s, a mid-file 206 for the exact bytes, and the CSP detector self-test.
- **Inventory after run 9:** 26 synthetic Firebase users and 24 objects in `pocketqa-evidence`. Nothing deleted (`docs/reviews/production/live/web-live-e2e.txt`).
- **Incident:** run 7 printed one synthetic user's 1-hour ID token to the lead's terminal, through Playwright's error output. It is not in the repo. Fixed in `4f9ae9d`.

## 2026-10-04 (evening): web launch, final candidate `184e0a2` (pqa-qa r2 APPROVE, plus the r2 P3s)
- **`pnpm verify`:** EXIT=0.
- **`pnpm test:e2e:live`:** 1/1, EXIT=0. Quietly aborted routes are now asserted to be 0.
- **Playwright 14/14 and emulator 4/4:** these outputs are from `4f9ae9d`. `4f9ae9d..184e0a2` changes only `e2e-live/web-launch.spec.ts` and docs, which those suites don't load.
- **Inventory after run 10:** 29 synthetic Firebase users and 26 R2 objects. Nothing deleted.

## 2026-10-04 (night): scoped R2 deletion, A5, candidate `2adea53`
- **`pnpm verify`:** EXIT=0. API 382 plus 2 skipped, including 6 new scoped-deletion tests; mobile 1021; scripts 57 (`docs/reviews/production/scoped-delete/pnpm-verify.txt`).
- **Live scoped deletion on `pocketqa-evidence`:** EXIT=0. The run created 3 objects and deleted exactly those 3. The listing was 26 objects before and 26 after, identical in keys, ETags and sizes. Deleting a pre-existing key by name was refused (`docs/reviews/production/live/r2-scoped-delete.txt`).
- **Production start smoke:** health 200; `/config` gives firebase, r2, `testCredits: false` and `devnetTransfers: false`. It was stopped afterwards and created no data (`docs/reviews/production/live/prod-start-smoke.txt`).

## 2026-10-04 (night): scoped deletion review-fix candidate `4fd0071` (pqa-qa scoped-delete-qa-r1 CHANGES_REQUIRED P2-1, fixed)
- **`pnpm verify`:** EXIT=0. API 382 plus 2 skipped; mobile 1021; scripts 57.
- **Live scoped deletion at `4fd0071`:** EXIT=0. Before 26 and after 26 objects, identical; only the run's 3 objects were deleted.
- **Production start smoke at `4fd0071`:** EXIT=0. Firebase, r2, test credits and devnet transfers off.

## 2026-10-04 (night): scoped deletion, literal A5 scope, candidate `ddb8b0d` (no `upload_staging`)
- **`pnpm verify`:** EXIT=0. API 385 plus 2 skipped, including the regression tests; mobile 1021; scripts 57.
- **Live, fresh synthetic objects only:** EXIT=0.
  - The failed upload's object was deleted.
  - The successful upload's quarantine copy was kept after completion.
  - Account deletion then deleted the recording and that copy.
  - 26 objects before and 26 after, identical (`live/r2-scoped-delete.txt`).
- **Production start smoke:** EXIT=0 (`live/prod-start-smoke.txt`).

## 2026-10-05: wallet-funded escrow and reputation, local simulated slice (`feat/wallet-rewards`)
Full outputs are in `docs/reviews/wallet-rewards/`.
- **`pnpm verify`:** EXIT=0. Secrets: 802 files, no findings. Tests: scripts 57, contracts 17, domain 215, API 470 plus 2 skipped, mobile 1069.
- **Playwright:** 15/15 EXIT=0, including `e2e/wallet-rewards.spec.ts` with the API on `POCKETQA_SETTLEMENT=simulated`. The wallet-rewards spec alone ran 5/5 after the navigation fix.
- **Firebase emulator E2E:** 4/4, EXIT=0.
- **No network, devnet, key or cloud access** was used by any of this.

## 2026-10-05: Squads v4 devnet pilot, adapter and runner (ADR 0007 §10; lead, `feat/wallet-rewards`, commits `5d5d431`, `a58ec6b` and the C10 test)
Full outputs are in `docs/reviews/wallet-rewards/`.
- **Adapter TDD** (`pilot-adapter-tdd.txt`):
  - **RED:** the module was missing.
  - **Mutation check:** I removed each of ten guards in turn (transfer match, claimed index, executed re-drive, pins, amount, index gap, config, recorded settlement, vault balance, builder key). Every removal fails at least one test.
  - **GREEN:** 40/40 across the fake-chain adapter and API suites.
- **Offline RPC chain round trip** (`test/squads-rpc-chain.test.ts`): 6/6. What `RpcSquadsChain` proposes decodes, through the Squads SDK codecs, to exactly the planned TransferChecked. Nothing is signed off devnet.
- **`pnpm verify`:** EXIT=0 (`pilot-verify.txt`).
  - Secrets scan: 835 files, no findings.
  - Tests: contracts 17, domain 216, API 527 plus 2 skipped, mobile 1075.
- **Network calls made:**
  - Read-only public devnet RPC: genesis, balances, program-data account.
  - No faucet call since the recorded 429s. No transaction was sent.
- **Live runner dry run with the test keys:**
  ```
  $ POCKETQA_LIVE_SQUADS_DEVNET=1 POCKETQA_LIVE_SQUADS_KEYS_DIR=~/.config/pocketqa-devnet-pilot npx vitest run --config vitest.live.config.ts test-live/squads-devnet.pilot.live.test.ts
  Error: BLOCKED: needs ≥ 0.2 devnet SOL on Pocket QA DoUXiXfn7dU5sL6NAWX4aiy9mJU9Nqy5edzCzoFFijwS (has 0 lamports) and ≥ 3.4 devnet test USDC on builder 6XoDNcAjSscq5bGhZoEX7q8kUfjkJHJb1YuDeEFgdudn (has no token account). Nothing was sent.
  ```
  - Receipt: `devnet-pilot-receipt.md` (outcome: failed, BLOCKED).
  - Squads program data at that time: last deploy slot 446638068; upgrade authority `HM5y4mz3Bt9JY9mr1hkyhnvqxSH4H2u2451j7Hc2dtvK`; account sha256 `5c866bde37d21edfcc92b630aa593a438f0d824be9d176e5904684996a4c0d37`.
- **Not yet evidenced:** every on-chain step (R1 to R8 live). They wait for faucet funding (`faucet-request.md`).

## 2026-10-05: pilot offline r1 fixes (P1-1 operation id, P2-1, P3-1 to P3-4); lead, `feat/wallet-rewards`
Full outputs are in `docs/reviews/wallet-rewards/`. **No live devnet run** was made (parent hold).
- **RED, against the pre-fix adapter `3023657`:** 9 failing tests. They cover lost-mapping recovery after create, approve and execute, plus a completed payout; claim ownership; ambiguity; claim release; and an off-curve funding source.
- **Mutation check:** 23 mutants, each of the 23 guards removed in turn (operation-id matching, creator, recovery scan, ambiguity, ownership, release, memo pin, rent collector, chain-state copy and the earlier guards). **All 23 fail at least one test.**
- **GREEN:** the three Squads suites pass 78/78 (`pilot-adapter-tdd.txt`).
- **P3-3, symlinked key directory:** RED on the old `config.ts` ("expected … outside the repository", got the chmod error), then GREEN.
- **`pnpm verify`:** EXIT=0 (`pilot-verify.txt`).
  - Secrets: 836 files, no findings.
  - Tests: scripts 58, contracts 17, domain 216, API 558 plus 2 skipped, mobile 1075.
- **Playwright** (`playwright.txt`): **15/15 passed (1.9 min), EXIT=0**, including `e2e/wallet-rewards.spec.ts` with the P2-1 fix.
  - The run regenerated the `browser/` screenshots; they are committed as this candidate's evidence.
  - The `gate-a` and `remaining-scope` screenshots it touched were restored from Git.
- **Read-only devnet RPC calls** (for the source check in ADR 0007 §10.1): `getAccountInfo` of `MemoSq4gq…` (executable, BPFLoader2) and of `Memo4c2p…` (executable, upgradeable; not used).

## 2026-10-05: live devnet pilot run 1 (partial) and the harness fix (lead, `feat/wallet-rewards`)
- **Live run 1, code `dc76870`, before the run** (re-read by the lead):
  - devnet genesis;
  - Pocket QA held 5,000,000,000 lamports;
  - the builder held 20,000,000 test-USDC units;
  - the key files are 0600 in a 0700 directory.
- **What happened** (`docs/reviews/wallet-rewards/devnet-pilot-receipt-run1.{md,json}`, raw; `devnet-pilot-run1-readback.md`, the lead's supplement):
  - 26 transactions landed, all finalized.
  - These checks passed: R0, R1, R2, R3, R4, R5, R6, R7, R8, P1-1, C2 and C8.
  - **The expected on-chain threshold refusal passed:** signature `4KNLFE1e…` at slot 507704742, error Custom 6008.
  - **It stopped on a harness error:** under public-RPC 429s, web3.js `confirmTransaction` rejects with the raw error instead of returning it.
- **`pnpm verify` after `cc2f746`: EXIT 1.** `check:secrets` flagged the raw receipts' base58 transaction signatures (secret-key shape). **That commit went in despite the failed scan, because a pipe hid the exit code.**
  - All 27 long tokens were checked: each is a transaction signature, 26 from receipt steps read back as finalized, plus the refusal signature.
  - Fixed with a hash-pinned evidence allowance (`scripts/check-secrets.mjs` `PINNED_EVIDENCE`, tested) and a per-line marker in the readback (`59f721d`).
- **Read-only readback** (`apps/api/scripts/squads-pilot-readback.ts`; output in `devnet-pilot-run1-readback.json`):
  - program data unchanged;
  - multisig config intact, rent collector null;
  - proposals 1–3 Executed with 2 approvals each, proposal 4 Active with 1;
  - balances reconcile exactly;
  - Pocket QA spent 39,999,760 lamports in all (fees 170,000 across 27 transactions, including the failed one).
- **Fix:**
  - `RpcSquadsChain.send` states a failure as finalized only when the chain status is finalized; otherwise it reports "outcome unknown". The runner does the same.
  - RED (2 tests against `rpcChain.ts` at `dc76870`), then GREEN 15/15 (`pilot-confirm-mapping-tdd.txt`).
- **`pnpm verify`:** EXIT=0 (`pilot-verify.txt`): secrets 844 files, no findings; scripts 59; contracts 17; domain 216; API 560 plus 2 skipped; mobile 1075.
- **Playwright not re-run** for this delta: no app code or simulated-mode path changed (it changes `rpcChain.ts`, live tests, the read-only script and the scanner).
- **No further sends.** The targeted double-execute refusal (`test-live/squads-devnet.pilot-run1-complete.live.test.ts`) waits for pqa-qa's re-review.

## 2026-10-05: run 1 completion send, fixes for pqa-qa harness-delta r1 P2-1/P2-2 (lead)
- **The send logic is now `apps/api/test-live/run1Completion.ts`, tested offline:** `apps/api/test/pilot-run1-completion.test.ts`, 12/12 (`pilot-completion-tdd.txt`).
  - Only `{InstructionError:[0,{Custom:6008}]}` counts as refused-as-expected. Any other error is `unexpected-error`; a finalized result with no error is `NOT-refused`.
  - The signature comes from the signed transaction and is recorded before broadcast. Any exception after the attempt, or a status that isn't finalized, gives `unknown` with that signature, never "Nothing was sent".
  - Mutation check: each of the four defects, put back alone, fails 3 or 4 tests.
- **The live test now records** a clean-tree flag and requires the tree to be clean. `rpcChain.ts` gets the comment pqa-qa asked for (finalized with no error after a confirm rejection maps to unknown).
- **`pnpm verify`:** EXIT=0. Secrets: 847 files, no findings. Tests: scripts 59, contracts 17, domain 216, API 572 plus 2 skipped, mobile 1075.
- **pqa-qa reviews** (exact copies): `qa-devnet-pilot-live-verdict-r1.md` and `qa-devnet-pilot-harness-delta-verdict-r1.md`.
- **No send has been made.**

## 2026-10-05: run 1 completion send (pqa-qa harness-delta r2 APPROVE of `0b66267`; lead)
**Command** (one send, no retry), from a clean tree at `0b66267`:
```
$ cd apps/api && POCKETQA_LIVE_SQUADS_RUN1_COMPLETE=1 POCKETQA_LIVE_SQUADS_KEYS_DIR=~/.config/pocketqa-devnet-pilot npx vitest run --config vitest.live.config.ts test-live/squads-devnet.pilot-run1-complete.live.test.ts
Test Files  1 passed (1)   Tests  1 passed (1)   EXIT=0
```

**Result:** outcome `refused-as-expected` (`devnet-pilot-run1-completion.{md,json}`).
- Signature `3zNWsdDxaSwMxx9Y…` at slot 507709054: finalized, err `{"InstructionError":[0,{"Custom":6008}]}`, fee 5,000 lamports.
- Pre-checks equal post-checks: tester A 1,000,000 and vault 210,000; program data at slot 446638068 with sha256 `5c866bde…0d37`.
- The multisig is still autonomous: threshold 2, time lock 0, rent collector null.

**Scanner:** the completion receipt's hashes are pinned (`PINNED_EVIDENCE`), since it lists a public signature.

**Pilot cost to date:** 39,999,760 + 5,000 = **40,004,760 lamports** of devnet SOL. Test USDC used: 3.31, of which 2.00 went to testers, 1.10 was refunded, and 0.21 stays in the vault (fee plus the unmatched deposit).

**pqa-qa verdict copied exactly:** `qa-devnet-pilot-harness-delta-verdict-r2.md`.



## 2026-10-05: Reputation design proposal and USDC escrow research, docs only (contributor session, claymorius-wq; Windows 11 clone of `docs/reputation-escrow-proposal` at `5a39a77`)

Raw output is in `docs/reviews/reputation-proposal/` (`checks.txt`, `research-recheck.txt`). Local paths are shortened to `<repo>`.

```
$ pnpm check:secrets                                   check:secrets passed: 769 committable files scanned, no findings.
$ node scripts/preview/assert-no-secrets.mjs --repo    secret check: 18 values, 769 files, 0 occurrences
$ pnpm typecheck                                       contracts, domain, api, mobile: Done (exit 0)
$ pnpm lint                                            exit 0
$ bash docs/reviews/reputation-proposal/research-recheck.sh   (read-only JSON-RPC, no transaction)
  rent 0 B = 650240 and 165 B = 1488440 lamports on mainnet and devnet
  Squads v4 program data: mainnet authority null (deploy slot 302582236); devnet authority HM5y4mz3… (deploy slot 446638068)
  USDC mints (mainnet EPjF…, devnet 4zMM…): owner Tokenkeg…, decimals 6, freeze authority set
Tests: not run (no code changed).
```

## 2026-10-05: combined candidate for user testing (merge of origin/main `8cc03dc`, plus preview guards); lead
- **Merge `a85c674`** (parents `23b9221` and `8cc03dc`). Main brought only docs: the reputation design proposal and escrow research.
  - Conflicts were only in `docs/progress.md` and `docs/verification.md`, two sections added at the same place. Both were kept in full, and every line each side added was checked as present (progress 21/21 and 52/52; verification 16/16 and 98/98).
- **Preview guards** (in `9dfb376`):
  - **Config A1c:** the shared demo refuses `squads_devnet`. RED ("expected to throw"), then GREEN, 40/40 in `escrow.test.ts`.
  - **`start.sh`:** `PREVIEW_SETTLEMENT` is pinned to `simulated` or `off` on the API command, and the pilot key-dir variable is removed. RED (1 fail), then GREEN, 5/5 in `preview-scripts.test.mjs`.
- **`pnpm verify`:** EXIT=0 (`pilot-verify.txt`). Secrets: 872 files, no findings. Tests: scripts 60, contracts 17, domain 216, API 573 plus 2 skipped, mobile 1075.
- **Playwright:** 15/15, EXIT=0 (`playwright.txt`). The `gate-a` and `remaining-scope` screenshots were restored from Git afterwards.
- **Preview rehearsal** (isolated `.preview-test/merge-smoke*`, ports 3591/3592, stopped by PID 53055 with no listeners left):
  - `init-preview` OK; `build-web.sh` secret check found 0 occurrences.
  - `/config` reported `settlement: 'simulated'`.
  - `seed-demo` OK; `smoke.mjs` passed all 20 checks.
- **Database upgrade check:** a database created by main's `db.ts` (`87e09d4`, schema v4) with rows, opened by the new code, went to v7 with rows intact, integrity `ok`, and no foreign-key violations.
- **Backup command check:** the guide's `db:backup` form, run against the rehearsal database into the scratchpad, printed the file and its sha256.

## 2026-10-05: desktop web screen recording with narration (lead, `feat/screen-recording` from `6028f08`)
Full outputs are in `docs/reviews/screen-recording/`.
- **Feasibility probe:** real Chromium 1.63 with fake devices produced `video/webm;codecs=vp9,opus`. ffprobe showed vp9 1280×720 plus opus 48 kHz; volumedetect mean −21.5 dB.
- **TDD** (`tdd.txt`):
  - controller: 39 tests, RED (module missing), then GREEN;
  - card: 12 tests, RED, then GREEN;
  - headers: RED 2 failing, then GREEN 36/36;
  - **14/14 controller mutants caught.**
- **Real browser** (`playwright.txt`, `ffprobe.txt`): the desktop-recorder project passed 4/4.
  - The screen request ran inside the click (`userActivation.isActive` true), with the mic after it.
  - The downloaded file had 1 VP9 1280×720 stream and 1 Opus 48 kHz stream; ffmpeg decoded it with exit 0 and an empty stderr; mean volume −21.3 dB.
  - Replay ran 3.94 s; playback advanced.
  - No POST or PUT, and no request with a body. Discard revoked the blob URL.
  - Stop sharing kept the draft; a refused mic ended the screen track; leaving the session released both tracks.
- **Full Playwright:** 19/19, EXIT=0 (15 mobile-web plus 4 desktop-recorder). The `gate-a`, `remaining-scope` and `wallet-rewards/browser` screenshots the run rewrote were restored from Git.
- **`pnpm verify`:** EXIT=0 (`verify.txt`). Secrets: 888 files, no findings. Tests: scripts 60, contracts 17, domain 216, API 573 plus 2 skipped, mobile 1129.
- **Not exercised:** the real share dialog, a real microphone, Safari and Firefox, and a deployed HTTPS origin (`usability-guide.md`).

## 2026-10-05: screen recording, fixes for pqa-qa r1 (CHANGES_REQUIRED on `9b9d631`); lead
- **P2-1:** Cancel in both asking states; a "Stop sharing" listener from the moment a screen is chosen.
  - Unit and card tests: RED (6 failing), then GREEN.
  - Real Chromium: a never-settling microphone prompt can be cancelled, and the browser's Stop sharing ends it. Both release the screen track.
- **P3:** the closed card offers Start over, with fresh consent.
- **P2-2:** decode gate `apps/mobile/e2e/ffmpegCheck.ts`. Only the exact null-muxer DTS line is tolerated, which 9 unit tests prove (decoder and demuxer errors, other muxers, near-misses and nonzero exits all fail).
- **Mutation:** all 7 r1-fix mutants caught.
- **Full Playwright:** 3 consecutive runs, **21/21 each**, EXIT=0 (`docs/reviews/screen-recording/playwright.txt`). The known DTS note occurred 0 times in those runs.
- **`pnpm verify`:** EXIT=0 (`verify.txt`). Secrets: 897 files, no findings. Tests: scripts 60, contracts 17, domain 216, API 573 plus 2 skipped, mobile 1145.
- **WebM duration limitation documented:** `duration=N/A` in the header (`usability-guide.md`).
- **Public preview recorder smoke** (`scripts/preview/recorder-smoke.mjs`): synthetic and non-destructive. Rehearsed on an isolated local preview: the existing smoke passed before and after two recorder-smoke runs (`preview-smoke-rehearsal.txt`).
  - An earlier join-and-withdraw mode was **dropped**: withdrawing doesn't let the tester join that study again, so the demo tester was left with no studies. This happened only in the isolated rehearsal data.


## 2026-10-05: native screen + voice recording across apps (lead, `feat/native-voice-recording`). EMULATOR/SIMULATOR ONLY
Freeze candidate **`c5e629d`**. Gate ledger: `docs/reviews/native-recording/gates.md`. Install/backend guide: `docs/handoff/native-recording-device-install.md`.
**Not "mobile ready"**: no physical Android, Seeker or iPhone was used, and no real speech was recorded.

### Android APK (built at c5e629d)
```
$ ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --max-workers=4   (JAVA_HOME=Android Studio JBR)
BUILD SUCCESSFUL in 35s
apps/mobile/android/app/build/outputs/apk/release/app-release.apk  52416705 bytes
sha256 074157921a1ea38662df280364b17c6bd6c36167cc5c3d84e24df4b2a4515c75
apksigner: Signer #1 certificate DN: CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US
aapt2: package com.reshareai.pocketqa versionCode 1 versionName 0.1.0; targetSdkVersion 36
on-device base.apk (emulator-5556) sha256 = 074157921a1ea38662df280364b17c6bd6c36167cc5c3d84e24df4b2a4515c75
```

### Unit tests and mutation
- Kotlin (`./gradlew :pocketqa-screen-capture:testDebugUnitTest -Dpqa.voiceClips=<private dir>`): PendingStoreTest 10, VoiceCheckTest 8 (0 skipped: it ran on the real emulator clips), CaptureMathTest 2. RED first: the classes were missing, then the PendingStore API.
  - VoiceCheck on the preserved emulator failure clip (sha256 f221c20c…cbccd): video 391.72 s, voice 202.69 s, so incomplete. Run 5 clip: complete.
- Jest: participation-session 40, sign-out-recordings 1. RED: 6 failing, then the Android AppState race (1 failing), then GREEN.
- Mutants: 8/8 Kotlin and 5/5 JS caught. One Kotlin survivor (empty-tag listing) was found, then caught by a new test.

### Emulator evidence (emulator-5556: own AVD PocketQA_Recorder_API36, Android 16 / API 36; host mic OFF)
- **r3 cross-app** (APK 07415792…): `voice-cross-app.yaml` rc=0.
  - `check-voice.py`: video 276.108 s, audio 275.505 s, |a−v| 0.604 s; 56 × 5 s windows from −3.0 to −3.2 dBFS; PASS (`docs/reviews/native-recording/android-r3/`).
- **Run 5 cross-app** (earlier APK): 230.366 / 229.645 s; PASS (`android-cross-app/probe.txt`).
- **Signal:** the emulator HAL's 220 Hz built-in-mic tone fallback. The HAL logged "failed to create alsa source for 'AUDIO_DEVICE_IN_BUILTIN_MIC'; creating a tone source instead", observed live; the source is AOSP `device_port_source.cpp`. This is a **synthetic non-silent signal, not speech verification**. The gRPC `injectAudio` route crashed the emulator (`inject-tone.py`, KNOWN BLOCKER).
- **r2 found a regression**, fixed in cc70f3c: Android's consent dialog returned the app to `active` before the service flagged itself, so the card showed Start while recording.
- **mic-denied:** PASS ("…needs the microphone… Nothing was recorded.", no consent dialog, no projection).
- **Lifecycle (rotation, lock, call, micoff, dka, death):** BLOCKED (infra) in r3 after one retry each.
  - The cause was a new Maestro session failing to attach while a projection was live: "driver did not start up in time" and gRPC UNAVAILABLE (`android-r3/infra-blocked.txt`).
  - pqa-qa has an exclusive emulator slot queued after the heavy builds.

### Workspace checks (HEAD 8345bfd = c5e629d + one eslint ignore line + docs-only merges)
- **`pnpm verify`** EXIT=0 (`docs/reviews/native-recording/verify.txt`), Node v24.21.0.
  - Secrets: 963 committable files, no findings.
  - Tests: scripts 60, contracts 17, domain 216, API 573 plus 2 skipped, mobile 55 suites / 1178 tests.
  - The first attempt failed lint only on Gradle's JVM test HTML report (`modules/screen-capture/android/build/`, git-ignored). Fixed by ignoring native module build outputs in `eslint.config.mjs` (8345bfd).
- **Playwright** `pnpm --filter @pocket-qa/mobile exec playwright test`: **21/21 passed**, EXIT=0 (`playwright.txt`). The screenshots it rewrote (gate-a, remaining-scope, screen-recording, wallet-rewards/browser) were restored from Git.

### iOS (pqa-ios, frozen combined code c5e629d; `ios-build.txt` §12)
- `expo prebuild --platform ios --clean`, `pod install`, `xcodebuild … -sdk iphonesimulator -configuration Debug -jobs 4 CODE_SIGNING_ALLOWED=NO build`: **BUILD SUCCEEDED**.
  - 0 errors. 543 compiler warnings and 2 script warnings, all third-party; 0 in our sources.
- Lead's check of the bundle: `PlugIns/PocketQaBroadcast.appex` is `com.reshareai.pocketqa.Broadcast`, broadcast-services-upload, SampleBuffer, x86_64 and arm64. The App Group is in both generated entitlements; the build is unsigned.
- Swift tests: 27, 0 failures. **No broadcast was run:** the Simulator can't run one, and there's no iPhone or team.
## 2026-10-05: intro before Sign in, its opening and pager motion, intro reviews r1 and r2 (contributor session, claymorius-wq; Windows 11, Node v24.21.0, pnpm 10.32.1)
Branch `feat/intro-walkthrough` at `1f33290` plus the r2 fixes (the working tree of the commit after this entry). Playwright ran through a git-ignored mirror of `playwright.config.ts` on private ports (API 8788, web 8091, fake RPC 8900), against a fresh `expo export` of the tree.
- **Checks** (verbatim summary lines):
  ```
  $ pnpm check:secrets
  check:secrets FAILED (89 finding(s) in 911 files):
  ```
  All 89 are in the devnet pilot receipts already on main: `devnet-pilot-receipt-run1.md` (29), `devnet-pilot-receipt-run1.json` (29), `devnet-pilot-run1-readback.json` (27), `devnet-pilot-run1-completion.json` (2), `devnet-pilot-run1-completion.md` (1) and `qa-devnet-pilot-live-verdict-r2.md` (1), all under `docs/reviews/wallet-rewards/`. None is in this change.
  ```
  $ node scripts/preview/assert-no-secrets.mjs --repo
  secret check: 18 values, 911 files, 0 occurrences
  $ pnpm typecheck        exit=0 (contracts, domain, api, mobile: Done)
  $ pnpm lint             exit=0
  ```
- **Unit tests:**
  ```
  $ pnpm --filter @pocket-qa/mobile test
  Test Suites: 57 passed, 57 total
  Tests:       1229 passed, 1229 total
  $ pnpm -r --if-present test
  packages/contracts: Tests 17 passed (17)
  packages/domain:    Tests 216 passed (216)
  apps/api:           7 failed (admin-scripts, db-scripts, backup, config.bind, admin-grant, escrow A1b, operations SIGTERM)
  ```
  The 7 API failures are the same on a clean checkout of main `ae0b501` on this machine (Windows paths and process signals); none touches this change.
- **Playwright:** 27 passed (3.6m), EXIT=0, all specs of the branch: 21 mobile-web, including the 6 in `intro.spec.ts`, plus 6 desktop-recorder.
- **An earlier full run** of `0f9135e` failed one spec, 26/27: on the web, Back from Sign up returned to the intro. expo-router ran the same-tick `replace` and `push` as one history step. Commit `1f33290` opens Sign up over the intro on purpose. Re-run of `intro.spec.ts` alone: 6 passed.
- **Not run here:** Maestro flows on a device (no emulator on this machine; `__tests__/maestro-flows.test.ts` parses all 26 and checks each cleared-state launch skips the intro), and the Seeker frame budget for the intro's swipe.

## 2026-10-05: intro review r3 fixes (contributor session, claymorius-wq; Windows 11, Node v24.21.0, pnpm 10.32.1)
Branch `feat/intro-walkthrough` at `d8310ed` plus the r3 fixes (the working tree of the commit after this entry). Same harness as the entry above: API 8788, web 8091, fake RPC 8900, a fresh `expo export` for every Playwright run.
- **Checks:**
  ```
  $ pnpm check:secrets
  check:secrets FAILED (89 finding(s) in 912 files):
  $ node scripts/preview/assert-no-secrets.mjs --repo
  secret check: 18 values, 912 files, 0 occurrences
  $ pnpm typecheck        exit=0 (contracts, domain, api, mobile: Done)
  $ pnpm lint             exit=0
  ```
  The 89 findings are the same devnet pilot receipts as above, and their cause is this checkout: `core.autocrlf=true` writes them with CRLF line endings, so their sha256 no longer matches `PINNED_EVIDENCE`. `devnet-pilot-receipt-run1.md` has 127 CRs on disk and hashes to `e680ba0c…`; with them removed it hashes to the pinned `373a8ca5…`, as the committed blob does.
- **Unit tests** (full parallel run):
  ```
  $ pnpm --filter @pocket-qa/mobile test
  Test Suites: 1 failed, 57 passed, 58 total
  Tests:       1 failed, 1233 passed, 1234 total
  $ pnpm -r --if-present test
  packages/contracts: Tests 17 passed (17)
  packages/domain:    Tests 216 passed (216)
  apps/api:           Tests 7 failed | 566 passed | 2 skipped (575)
  ```
  The one mobile failure is `src/icons/__tests__/icons.test.tsx` "renders every tile size, active and tinted, in both themes": it exceeded Jest's 5 s timeout while suites took up to 143 s in that run. The branch doesn't touch it, and alone it passes (`npx jest src/icons/__tests__/icons.test.tsx`: 13 passed). The 7 API failures are the Windows baseline listed above.
- **Playwright** (full run): 27 passed, 1 failed (4.2m). The failure is `web-recorder.spec.ts:97` (desktop recorder, untouched here): ffmpeg reported the null muxer's "non monotonically increasing dts" note, which `e2e/ffmpegCheck.ts` tolerates only in the `[null @ 0x…]` form. Windows ffmpeg prints the pointer without `0x` (`[null @ 000001f24aa07f40]`), so on this machine the intermittent note fails the check. Re-run alone on the same export: 6 passed.
- **After the full run:** the first-frame check in `intro.spec.ts` was made strict, and the ResizeObserver re-align added for r3 P3-1 was removed again, with its comment (both below). On that final tree:
  ```
  $ pnpm typecheck        exit=0
  $ pnpm lint             exit=0
  $ npx jest __tests__/welcome.test.tsx __tests__/auth-layout.test.tsx __tests__/root-layout.test.tsx src/ui/__tests__/chrome.test.tsx
  Test Suites: 4 passed, 4 total
  Tests:       54 passed, 54 total
  $ playwright test e2e/intro.spec.ts   (fresh expo export of the final tree)
  7 passed (46.3s)
  ```
- **The new checks fail on the old behaviour** (each fix undone in `welcome.tsx`, then restored):
  - Jest, three at once (no drag release, the fallback settling where Next was heading, the rising words as kit display Text): "its title as one heading", "the fallback settles where the pager rests" and "a drag takes over from Next" failed.
  - Playwright, per-slot focus undone (every swapped-in control takes focus whenever the page has it): 2 failed. The keyboard check got no focus on Create an account (its `toBeFocused`), and after a swipe with nothing focused, Sign in had taken focus (the swipe test's `not.toBeFocused`).
  - Playwright, the 0×0 guard undone (the pager unmounts while Sign up covers the intro): the first-frame check failed (received −1, no pager in the first frame after Back). The first version of that check passed here, because a later resize healed it. It now records the first frame only.
  - Playwright, the ResizeObserver re-align undone: all 7 passed. A throwaway probe in the harness read the pager's offset at the moment the intro is shown again, from a mutation observer that runs before any rendering step and so before the screen's own scripts. Chromium read 1504, Firefox 1503.9 and WebKit 1504, against a page width of 752 (Playwright 1.63's desktop devices). Every engine restores a re-shown scroller's offset itself (while hidden it reads 0). So the observer was dead code and is removed. The `onLayout` re-align stays as a fallback for an engine that doesn't restore it, and the comment says what was checked.
- **Not run here:** Maestro on a device, the Seeker frame budget, and the specs themselves in Firefox and WebKit (only the probe above ran there).

## 2026-10-05: badge medallions and the leaderboard in the Lens design (contributor session, claymorius-wq; Windows 11, Node v24.21.0, pnpm 10.32.1)
Branch `feat/lens-badges` at `3ba55de`, from main `ae0b501`. Playwright ran through a git-ignored mirror of `playwright.config.ts` on private ports (API 8789, web 8094, fake RPC 8901), against a fresh `expo export` of the tree.
- **Checks:**
  ```
  $ pnpm check:secrets
  check:secrets FAILED (89 finding(s) in 909 files):
  ```
  All 89 are in the devnet pilot receipts on main (`docs/reviews/wallet-rewards/`), none in this change. The cause is this Windows checkout (`core.autocrlf=true`): git writes the pinned receipts with CRLF line endings, so their sha256 no longer matches `PINNED_EVIDENCE` and they are scanned as unpinned files. The committed blobs are unchanged: `devnet-pilot-receipt-run1.md` hashes to `e680ba0c…` on disk and to the pinned `373a8ca5…` as committed.
  ```
  $ node scripts/preview/assert-no-secrets.mjs --repo
  secret check: 0 values, 909 files, 0 occurrences
  $ pnpm typecheck        exit=0
  $ pnpm lint             exit=0
  ```
- **Unit tests:**
  ```
  $ pnpm --filter @pocket-qa/mobile test
  Test Suites: 55 passed, 55 total
  Tests:       1164 passed, 1164 total
  $ pnpm -r --if-present test
  packages/contracts: Tests 17 passed (17)
  packages/domain:    Tests 221 passed (221)
  apps/api:           Tests 7 failed | 566 passed | 2 skipped (575)
  ```
  The 7 API failures are the Windows baseline that main `ae0b501` also shows on this machine (admin-scripts, db-scripts, backup, config.bind, admin-grant, escrow A1b, operations SIGTERM). `test/reputation.test.ts`, with the new `progress` assertions, passes. `domain/src/reputation.ts` coverage: 100% statements.
- **Playwright:** 21 passed (3.7m), EXIT=0. That is 15 mobile-web specs, including `wallet-rewards.spec.ts`, which drives the new Reputation and Leaderboard screens end to end against the real local API (points, a badge row, the opt-in, "Not ranked yet", the leaderboard). That run checked only that the badge row was visible, which every badge row is; that the approval earned the badge is asserted from `0ea26a0` on (the entry below), plus 6 desktop-recorder specs.
- **Screenshots:** `docs/reviews/lens-badges/browser/`. They come from a throwaway local API seeded with synthetic testers (aliases only), signed in as one of them.

## 2026-10-05: badges review fixes, on the branch merged with main (contributor session, claymorius-wq; Windows 11, Node v24.21.0, pnpm 10.32.1)
`feat/lens-badges` at `20060a6`. That is the r1 and r2 review fixes (`0ea26a0`, `42b431b`), then main merged in (`79340fa`, which brings the intro, #10), then the intro review r4's P3s (`20060a6`). Same harness as the badges entry above (API 8789, web 8094, fake RPC 8901, a fresh `expo export`), now with main's start-past-the-intro storage state.
- **Checks:**
  ```
  $ pnpm check:secrets
  check:secrets FAILED (89 finding(s) in 921 files):
  $ node scripts/preview/assert-no-secrets.mjs --repo
  secret check: 18 values, 921 files, 0 occurrences
  $ pnpm typecheck        exit=0
  $ pnpm lint             exit=0
  ```
  The 89 findings are the devnet pilot receipts, converted to CRLF by this checkout (explained above).
- **Unit tests** (full parallel run):
  ```
  $ pnpm --filter @pocket-qa/mobile test
  Test Suites: 7 failed, 53 passed, 60 total
  Tests:       10 failed, 1275 passed, 1285 total
  $ pnpm -r --if-present test
  packages/contracts: Tests 17 passed (17)
  packages/domain:    Tests 222 passed (222)
  apps/api:           Tests 7 failed | 566 passed | 2 skipped (575)
  ```
  - Nine of the ten mobile failures exceeded Jest's 5 s per-test timeout. Their suites took 115–143 s in that run: builder-study, review-screen, new-study, icons, admin-screens, participation-session and auth-screens.
  - The tenth, new-study "shows the server failure above the dock", failed right after its suite's timeout.
  - The badges commits touch none of these suites, and since main `ae0b501` only auth-screens changed (three lines, in the intro, #10). The API failures are the Windows baseline.
  - Re-run of the seven suites with `npx jest --maxWorkers=2`: 7 suites, 141 tests passed.
- **Playwright** (full run): 26 passed, 2 failed (4.2m).
  - `wallet-rewards.spec.ts` passed, including the new assertions that the approval earned the first badge: "A builder accepted your first test.", "Earned", and the hero's "TOP BADGE". This is the condition review r2 set for merging.
  - The two failures:
    - `intro.spec.ts` "on a short screen…": "Target page, context or browser has been closed" mid-test.
    - `remaining-scope.spec.ts:99`: the devnet demo transfer's "CONFIRMED ON DEVNET" did not appear in time.
  - Both passed in every earlier run. Re-run alone on the same export: 10 passed (1.0m): intro.spec.ts 7 and remaining-scope.spec.ts 3.


## 2026-10-06: native recording, new capture pipeline + main merged (lead, `feat/native-voice-recording` @ fe89787). EMULATOR/COMPILE ONLY
Gate ledger: `docs/reviews/native-recording/gates.md`. Research and design: `docs/plans/native-capture-pipeline.md`.
- **Pipeline** (`fdc8e95`, `30a98d9`): AudioRecord, MediaCodec (AAC, H.264 from a surface) and MediaMuxer replace MediaRecorder.
  - Kotlin tests: PendingStore 10, VoiceCheck 9 (ran on the real emulator clips), PipelineLogic 10, CaptureMath 2; RED, then GREEN.
  - pqa-qa's pipeline review r1 P2-C, P2-D and P3s were fixed, and r2 confirmed them.
- **UI fix** (`44fea59`): entrances that start while the app is off screen render settled. Jest background-entrance 5, RED (3 failing), then GREEN.
- **Emulator** (`-no-audio`: the guest mic is near-silence (codec noise floor), so the verdicts are **structure only**). Details: `docs/reviews/native-recording/android-pipeline/`.
  - control, stress, call, dka and death PASS;
  - micoff did not exercise mic loss;
  - combined cross-app run with main's intro: rc=0, video 49.009 s, audio 49.017 s, gaps 0, `PqaCapture` gaps 0 / lost 0, overruns 0.
- **Merge of origin/main `daf0c85`** (`fe89787`):
  - conflicts in `_open-session.yaml` (intro skip plus the native mic permission) and docs; kept both sides;
  - `pnpm install --frozen-lockfile` clean;
  - **`pnpm verify` EXIT=0**: secrets 1017 files, no findings; scripts 60, contracts 17, domain 222, API 573 plus 2 skipped, mobile 63 suites / 1344 tests (`docs/reviews/native-recording/verify.txt`);
  - **Playwright 28/28** (`playwright.txt`); the rewritten gate-a, remaining-scope, screen-recording and wallet-rewards/browser screenshots were restored from Git.
- **APK** at fe89787: `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`, sha256 `277e8744837819958af2e57acd37685bdc712e46c50755bc3224274e4b8b91a9`, 52483457 bytes, Android Debug cert.
- **Not proven:** a non-silent signal through the new pipeline (BLOCKED (infra) on the emulator), speech, any real phone, the Seeker, or an iPhone broadcast.

## 2026-10-06: Firebase/Firestore/R2/Vercel refactor, hosted entry (lead, `feat/firebase-vercel` @ 5c9d29d). EMULATOR ONLY
```
$ node scripts/vercel/build.mjs --skip-web
secret check: 0 values, 3 files, 0 occurrences
built .vercel/output (staging): api.func maxDuration 60s in fra1; 3 files; secret scan clean (0 server-only values checked)
$ EMU_CONFIG=../../firebase.emu-lead.json EMU_FILES="test/emulator/hosted.test.ts test/emulator/bundle.test.ts test/emulator/core.test.ts test/emulator/tx-foundation.test.ts" pnpm test:emulator
      Tests  32 passed (32)
$ (apps/api) npx vitest run
      Tests  637 passed | 2 skipped (639)
$ (apps/mobile) npx jest --ci            # at e53f978
Test Suites: 65 passed, 65 total
Tests:       1361 passed, 1361 total
$ firebase firestore:databases:list --project pocketqa-optijara --json
  "error": "... HTTP Error: 403, Cloud Firestore API has not been used in project pocketqa-optijara before or it is disabled. ..."
$ gcloud billing projects describe pocketqa-optijara --account=admin@optijara.ai
ERROR: (gcloud.billing.projects.describe) There was a problem refreshing your current auth tokens: Reauthentication failed. cannot prompt during non-interactive execution.
```

## 2026-10-06: live USB API database after the lead's pkill incident (pqa-qa r4 request): read-only check
The local API (`127.0.0.1:8787`, data `scratchpad/nv-api-data`) was SIGTERMed by a lead `pkill -f` for about 2 minutes. That signal goes through its clean-stop handler. It was restarted from the native-voice worktree with the same command and data dir.
```
$ python3 (sqlite3 'file:…/nv-api-data/pocketqa.sqlite?mode=ro', compared with ~/.local/share/pocketqa/backups/20261006T000054Z/manifest.json)
integrity_check: ok
tables compared: 31 | below manifest: none
  users: backup 77 live 77
  studies: backup 39 live 39
  participations: backup 30 live 30
  evidence: backup 11 live 11
seeker evidence present: 1
$ curl -s http://127.0.0.1:8787/health
{"ok":true,"contractVersion":"0.6.1"}
```
From now on, stops are PID-scoped only (`$!` captured at start). Test servers use `POCKETQA_API_PORT` away from 8787.
