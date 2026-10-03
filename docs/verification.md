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
