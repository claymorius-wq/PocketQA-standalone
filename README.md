# Pocket QA

Usability tests on real phones, built for the Solana Seeker. Builders publish a study with tasks, the devices they need and a reward. Testers on Android or a Seeker join, record their screen and voice with consent, and send in what got in their way. Builders watch what really happened, write the findings and approve or reject the work.

- **Try it:** https://pocketqa.vercel.app (payments and rewards in the hosted app are simulated)
- **Demo video:** https://drive.google.com/file/d/14xZ9CcshwgowKu9pZfEl7wN2JQlVp3In/view
- **Deck:** https://drive.google.com/file/d/1KGA4G0P9DpsfQC_hKhhqoWSUMTmORvrc/view
- **Android APK:** https://pocketqa.vercel.app/downloads/pocketqa-e2e-v4.apk (direct download, 53 MB)

## What works today

| | |
|---|---|
| Android app | Expo SDK 57 and React Native 0.86. The APK runs on a Solana Seeker, and the web build comes from the same code. |
| Screen and voice recording | Our own Kotlin module, `modules/screen-capture`: MediaProjection, an H.264 MediaCodec pipeline and a microphone foreground service. |
| Wallet | Mobile Wallet Adapter links a devnet wallet with a signed one-time nonce. Linking is never a payment. |
| Payments | Simulated in the hosted app: test credits and simulated USDC, no real money. A Squads v4 escrow settles on devnet in a local-only mode (see Solana below). |
| Backend | Fastify API on Vercel, Firebase sign-in, Firestore, and evidence in a private Cloudflare R2 bucket. |
| Roles | Testers, builders, and admins for disputes, moderation, export and deletion. |
| Reputation | Points for accepted work, a quality score, four badges and an opt-in leaderboard. The profiles in the demo are synthetic. |

## Where to look

| Path | What's there |
|---|---|
| `apps/mobile` | The Expo Router app. Screens are in `app/` (tester, builder, admin). The wallet link is `src/wallet/link.android.ts`; escrow and payment state are `src/screens/EscrowPanel.tsx` and `src/screens/PaymentState.tsx`. |
| `modules/screen-capture` | The Kotlin recorder: `CapturePipeline.kt`, `ScreenCaptureService.kt`, `CaptureStart.kt`, `VoiceCheck.kt` |
| `apps/api` | The Fastify API. Evidence and playback: `src/handlers/evidence.ts`. Settlement: `src/settlement/simulated.ts` and `src/settlement/squads/` (devnet). |
| `packages/domain` | Business rules: state machines, the ledger, eligibility, transfer checks and the copy linter |
| `packages/contracts` | Zod schemas and the route table, shared by the API and the app |
| `docs/` | Decisions in `docs/decisions/`, command evidence in `docs/verification.md`, progress in `docs/progress.md` |

## Solana

**Mobile Wallet Adapter.** Linking happens in one MWA session. The wallet authorizes, the server issues a nonce bound to the user, the address, the domain, devnet and an expiry, and the wallet signs it (`apps/mobile/src/wallet/link.android.ts`). On a Seeker, the Seeker's own wallet approves. Wallet-first sign-in isn't enabled in the hosted release.

**Escrow.** Each study gets its own Squads v4 vault with a 2-of-3 multisig: the builder, Pocket QA and an arbiter for disputes. The API's settlement worker has three modes, set by `POCKETQA_SETTLEMENT`:
- `off`;
- `simulated`, which the hosted app uses;
- `squads_devnet`, which settles the same flow on devnet with test USDC.

Production and the shared demo refuse `squads_devnet`, because its test keys sit with one operator and play every role. It's for local runs only (`docs/decisions/0007-wallet-escrow-settlement.md`).

**The devnet pilot** ran on 5 October 2026:
- 26 transactions, all finalized;
- 3.31 test USDC funded, 2.00 paid to testers and 1.10 refunded to the builder;
- a payout with only one approval, and a repeat payout, were both refused on chain.

The receipts, with Solana Explorer links, are in `docs/reviews/wallet-rewards/devnet-pilot-receipt-run1.md`. The run log is in `docs/verification.md`.

## Privacy and evidence

- Android asks for consent before every recording, and a notification can stop it. Protected windows, like a wallet's approval screen, record black.
- Clips stay on the phone until the tester keeps or removes each one. Nothing uploads before that.
- Uploads go to a private R2 bucket through presigned URLs, and the storage keys stay on the server.
- Playback is checked on the server first: only people on that study session get a link, anyone else gets "not found", and the link expires after 5 minutes (`playbackToken` in `apps/api/src/handlers/evidence.ts`). Tests: `apps/api/test/authz.matrix.test.ts` and `apps/api/test/storage-playback.test.ts`.
- Deleting an account deletes its evidence (`DELETE /me`), and `POST /me/export` exports it (`docs/decisions/0002-retention.md`). Evidence isn't deleted on a timer.

## Build and run

You need Node 24.21 (see `.nvmrc`) and pnpm 10.32. Android builds also need JDK 21 and the Android SDK.

```sh
pnpm install
pnpm verify                              # secret scan, typecheck, lint and every test suite
pnpm --filter @pocket-qa/api dev         # local API on http://127.0.0.1:8787
pnpm --filter @pocket-qa/mobile web      # web preview
pnpm --filter @pocket-qa/mobile android  # Android dev build on a device or emulator
```

On a device, the local API is reached through `adb reverse tcp:8787 tcp:8787`. Secrets go only in a gitignored `.env.local` (see `.env.example`), and `pnpm check:secrets` runs before every commit.

To build a release APK against the hosted API:

```sh
cd apps/mobile
export EXPO_PUBLIC_API_URL=https://pocketqa.vercel.app/api EXPO_PUBLIC_POCKETQA_ENV=staging
npx expo prebuild --platform android --clean --no-install
cd android
./gradlew :app:createBundleReleaseJsAndAssets --rerun assembleRelease -PreactNativeArchitectures=arm64-v8a
```

Export the `EXPO_PUBLIC_*` variables in the same shell as Gradle, because Metro inlines them while it bundles. The full recipe and install checks are in `docs/reviews/android-icon/e2e-build-recipe.md`.

## Tests

At the independent refactor review (October 2026) the counts were 1,362 mobile, 645 API (2 skipped) and 222 domain tests, plus Playwright end-to-end tests against the real API. `pnpm verify` runs the unit suites, and `docs/verification.md` has the logs.

## Road to mainnet and SKR

None of this is built yet:

1. An external audit of the escrow and the settlement worker.
2. Real-wallet payment tests on a Seeker, with funding, approval and refund each signed in the Seeker's wallet.
3. Independent keys for each vault: the builder, Pocket QA and the arbiter each hold their own.
4. Mainnet USDC payouts, sent only to the wallet the tester confirmed at consent, with disputes going to the arbiter.

SKR and the Seeker Genesis Token live on mainnet, so they come after these steps. Two ideas we're weighing: letting builders fund a study in SKR as well as USDC, and a Seeker Genesis Token check so the leaderboard counts one tester per Seeker.
