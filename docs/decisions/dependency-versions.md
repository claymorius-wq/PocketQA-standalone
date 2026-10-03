# Dependency versions — PARTIALLY VERIFIED (2026-10-02)

Scope of verification: registry existence, exact version, engines/peer compatibility and Node runtime support. Raw command output for every row marked **E** is in `docs/reviews/phase0/evidence-registry.txt` (captured 2026-10-02 by the lead, pane `wX:p1`). Sources: npm registry (`https://registry.npmjs.org/<pkg>`), Expo SDK 57 pins (`expo@57.0.26/bundledNativeModules.json`, read from the published tarball, and `expo-template-default@sdk-57`), and the Node release schedule (`https://raw.githubusercontent.com/nodejs/Release/main/schedule.json`).

**Not yet verified, and blocking the phase that uses them** (plan §3 items 3–4):
- §3.3 MWA API surface, maintenance status and `@solana/kit` API: **open, blocks Phase 6.**
- §3.4 MediaProjection behavior on Android 14/15 against developer.android.com and on a real device: **open, blocks Phase 1/5.** No physical device is attached (`adb devices -l` is empty).

## Runtime / toolchain

| Tool | Exact | Evidence |
|---|---|---|
| Node.js | **24.21.0** (LTS "Krypton", supported until 2028-04-30) via nvm; `.nvmrc`; root `engines` `>=24.3.0 <25` | E: schedule.json v24; `node -v`. Node 25 was rejected: EOL 2026-06-01 per the same schedule. |
| pnpm | 10.32.1 (`packageManager`) | E |
| JDK for Gradle | 21.0.8 (Android Studio JBR) | `"/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/java" -version` |
| Android SDK | platforms android-36, android-37.0; build-tools 35.0.0 / 36.0.0 / 36.1.0; AVD `Medium_Phone_API_36.1` | `ls $ANDROID_HOME/...`, `emulator -list-avds` |

## Pinned now (in the foundation lockfile)

| Package | Exact | Evidence / reason |
|---|---|---|
| zod | 4.6.5 | E |
| typescript | ~6.0.3 → resolves 6.0.3 in lockfile | E: SDK 57 template pins `~6.0.3`; `typescript-eslint@8.71.0` peers `<6.1.0`, so TS 7.0.2 (registry latest) is excluded |
| vitest | 5.0.3 | E: engines `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0` includes Node 24.21.0 |
| eslint / @eslint/js / typescript-eslint | 10.11.0 / 10.0.1 / 8.71.0 | E (typescript-eslint peers) |
| @solana/wallet-standard-util (dev, contracts SIWS compatibility test) | 1.1.4 | E |

## Chosen for later phases (exact version to pin when the owning phase adds it)

| Package | Exact target | Evidence / reason |
|---|---|---|
| expo | 57.0.26 | E |
| react / react-dom | 19.2.3 | E: SDK 57 template. Registry latest 19.3.0 is **not** used |
| react-native | 0.86.3 | E: SDK 57; engines include `^24.3.0` |
| expo-router, expo-* modules, react-native-svg, safe-area-context, screens, jest-expo | exactly what `npx expo install` resolves for SDK 57; recorded here when Phase 4 scaffolds | `bundledNativeModules.json` ranges (`~57.0.x`, `react-native-svg 15.15.4`, `react-native-safe-area-context ~5.7.0`, `react-native-screens ~4.26.0`, `jest-expo ~57.0.5`) |
| lucide-react-native | 1.50.0 | E: peers checked in evidence file |
| fastify | 5.12.5 | E |
| better-sqlite3 | 13.0.3 | E: prebuilt binary ran `select sqlite_version()` → 3.53.4 on Node v24.21.0 |
| @node-rs/argon2 | 2.2.1 | E |
| @playwright/test | 1.63.0 | E |
| @noble/curves | 2.4.0 | E (server-side ed25519) |

## Mobile app (resolved in the lockfile at Phase 4)

`npx expo install` resolved these for SDK 57. `~` ranges are kept for Expo-managed modules, because that is Expo's own compatibility contract. The exact versions are pinned by `pnpm-lock.yaml`; the versions below were read from the installed `package.json` files.

| Package | Resolved |
|---|---|
| expo / expo-router | 57.0.26 / 57.0.24 |
| expo-secure-store, expo-document-picker, expo-video, expo-image, expo-file-system, expo-dev-client | 57.0.4, 57.0.3, 57.0.5, 57.0.5, 57.0.7, 57.0.19 |
| react-native-screens / react-native-safe-area-context / react-native-svg | 4.26.2 / 5.7.0 / 15.15.4 |
| react-native-web | 0.21.3 (exact) |
| @react-native-async-storage/async-storage | 2.2.0 (SDK 57 pin) |
| @tanstack/react-query | 5.104.1 (exact) |
| lucide-react-native | 1.50.0 (exact) |
| jest-expo / jest / @testing-library/react-native | 57.0.5 / 29.7.0 / 14.0.1 (exact) |
| @playwright/test | 1.63.0 (exact) |

## Lens visual system (added 2026-10-03, branch `feat/lens-ui`)

Installed with `cd apps/mobile && pnpm exec expo install react-native-reanimated react-native-worklets expo-blur expo-font @expo-google-fonts/red-hat-display @expo-google-fonts/instrument-sans @expo-google-fonts/dm-mono`. Expo modules keep Expo's `~` range (as above); everything else is pinned exactly. The SDK 57 pins come from `expo@57.0.26/bundledNativeModules.json` (`react-native-reanimated 4.5.1`, `react-native-worklets 0.10.1`, `expo-blur ~57.0.3`, `expo-font ~57.0.4`). Rationale: `docs/decisions/0005-lens-visual-system.md`.

| Package | Pinned | Resolved | Why |
|---|---|---|---|
| react-native-reanimated | 4.5.1 (exact) | 4.5.1 | UI-thread animation for the Lens motion system (press, entrances, sheets, Uplight, signature motions) and `useReducedMotion`. Before this change pnpm had auto-installed 4.7.1 (registry latest) as the peer of `react-native-drawer-layout`, an expo-router dependency; that version is outside the SDK 57 pin and needs worklets 0.13, which `expo-modules-core@57.0.20` does not accept (`^0.7.4 … ^0.10.0`). |
| react-native-worklets | 0.10.1 (exact) | 0.10.1 | Required peer of Reanimated 4. `babel-preset-expo` adds `react-native-worklets/plugin` automatically when the package resolves, so there is no `babel.config.js`. |
| expo-blur | ~57.0.3 | 57.0.3 | The L3 overlay only (tab bar or bottom dock, and sheets). Android needs `blurMethod="dimezisBlurViewSdk31Plus"` plus a `BlurTargetView`. |
| expo-font | ~57.0.4 | 57.0.4 | Runtime font loading (`useFonts`) in `app/_layout.tsx`; config plugin added to `app.json` by `expo install` (no embedded fonts configured). |
| @expo-google-fonts/red-hat-display | 0.4.1 (exact) | 0.4.1 | Display and numerals: weights 300, 400, 500 (spec §12). |
| @expo-google-fonts/instrument-sans | 0.4.2 (exact) | 0.4.2 | UI and body: weights 400, 600. |
| @expo-google-fonts/dm-mono | 0.4.2 (exact) | 0.4.2 | Labels and readouts: weights 400, 500. |

Only the seven weights above are imported, through per-weight subpaths (`@expo-google-fonts/<family>/<weight>`); each package's index would pull every weight into the Metro bundle. Already present and reused: `react-native-svg` 15.15.4 (gradients, rims, grain, Uplight floor, fluted lens).

Jest: `apps/mobile/package.json` sets `resolver: "react-native-worklets/jest/resolver.js"` (shipped by worklets: it stops Jest from loading the `.native` worklets entry, which needs the native module) and `setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"]`, which calls Reanimated's documented `setUpTests()`.

Lockfile side effect: with Reanimated back on the SDK 57 pin, its worklets peer no longer pulls the 0.87 React Native tooling. `@react-native/metro-config`, `@react-native/babel-preset` and `@react-native/metro-babel-transformer` resolve 0.86.3 (were 0.87.1), and the 0.87.1 entries of `@react-native/codegen` and `@react-native/babel-plugin-codegen` are gone (0.86.3 is used). All now match `react-native` 0.86.3. No package.json range changed for them.

Not added: `@shopify/react-native-skia` (see ADR 0005), `expo-linear-gradient` (SVG gradients cover it and also handle the radial layers), `react-native-shadow-2` (React Native's own `boxShadow` takes the spec's shadow lists, inset included).

## Candidates only (unverified; Phase 6 decides)

| Package | Candidate | Note |
|---|---|---|
| @solana-mobile/mobile-wallet-adapter-protocol | 2.3.0 (published 2026-08-17 per evidence-registry.txt; the 2026-10-01 timestamp is the package `modified` time and 3.0.0 canaries) | **Release-age rule:** no `minimumReleaseAge` guard is configured; Phase 6 must never pick a canary or a release newer than 7 days without a recorded reason. |
| @solana-mobile/mobile-wallet-adapter-protocol-kit | 0.4.0 | no evidence captured yet |
| @wallet-ui/react-native-kit | 4.3.0 | no evidence captured yet; optional |
| @solana/kit | 7.x to match MWA's `^7.0.0` dependency | exact version is decided in Phase 6 |

## Chain constants (verified live, E)

- Devnet genesis hash `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.
- Mainnet-beta `5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d` (from the 2026-10-02 probe in `docs/verification.md`). It's recorded only so the API can refuse it.

WalletConnect is excluded (plan §10) and was not researched.
