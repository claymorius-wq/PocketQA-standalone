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
