# ADR 0003: Android screen recorder and devnet wallet link

Status: proposed for Phase 5/6 review (2026-10-02). Owner: lead.

## Screen recorder (`modules/screen-capture`, Expo module `PocketQaScreenCapture`)

Primary source: https://developer.android.com/media/grow/media-projection, fetched 2026-10-02 with `curl`; I read the relevant sections directly. It states:

- Consent is required before **each** session, and a session is one `createVirtualDisplay()` call. On Android 14+, reusing the consent intent or creating a second virtual display throws `SecurityException`.
- Apps targeting Android 14+ must declare `FOREGROUND_SERVICE_MEDIA_PROJECTION` and a service with `foregroundServiceType="mediaProjection"`, and must call `startForeground()`.
- Android 14 adds app screen sharing: the user can share a single app or the entire screen. Single-app sharing excludes the status bar, notifications and other system UI.
- On Android 15 QPR1+, a status-bar chip lets the user stop the projection, and locking the screen stops it. Apps must register `MediaProjection.Callback.onStop()`.

Decisions:

1. **Consent every time.** `startAsync()` launches `createScreenCaptureIntent()` on every call. There is no token caching and no silent start. A decline resolves as `ERR_CONSENT_DENIED`, and the app says "Nothing was recorded".
2. **User's choice of scope.** Pocket QA does not opt out of app screen sharing. The tester decides whether to share a single app or the whole screen. That choice can omit wallet app-switches: a known limitation, per the research's capture-feasibility gate.
3. **Service order.** `ScreenCaptureService` calls `startForeground(..., FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION)` *before* `getMediaProjection()`, registers `onStop`, and creates exactly one virtual display. It records H.264 MP4 (≤ 1280 px long edge, 30 fps, 4 Mbps) to the app cache dir `recordings/`.
4. **System stop.** Stops from the chip or a lock go through `onStop`. The service finalizes the clip and emits `onStopped {reason:'system', clip}`. The app keeps the clip as an *unreviewed* segment and tells the tester it was stopped by the system.
5. **Nothing leaves the device automatically.** Clips enter the same review queue as attachments: keep or remove, then explicit upload. A removed clip's file is deleted.
6. **Secure screens.** Pocket QA never tries to bypass `FLAG_SECURE`. Secure windows record as black, by OS design.
7. **Visible indicator.** The ongoing notification reads "Pocket QA is recording your screen", alongside the OS's own projection indicator.

## Devnet wallet link (Mobile Wallet Adapter)

Primary sources, fetched with `curl` 2026-10-02:

- https://docs.solanamobile.com/get-started/react-native/invoke-mwa-sessions-directly
- https://docs.solanamobile.com/get-started/development-setup

Key points from them: `transact()` plus `authorize({chain:'solana:devnet', identity, sign_in_payload})` returns `sign_in_result`. Solana Mobile's dev wallet for emulators is `solana-mobile/mock-mwa-wallet`.

Package: `@solana-mobile/mobile-wallet-adapter-protocol@2.3.0`, published 2026-08-17, which passes the ≥ 7-day release-age rule. Its type definitions were read from `lib/types/index.d.ts`.

Decisions:

1. **Flow (revised after the emulator run).** Everything happens in **one** MWA session. The app authorizes, gets a server nonce bound to the returned address, then has the wallet sign the exact server-built SIWS text with `signMessages`. The wallet displays that text, including the domain, before approval. The server verifies the signature against its own stored message (ADR 0001 §8).
   - The first design used two back-to-back sessions: authorize, then re-authorize with `sign_in_payload`. On the emulator with the mock wallet, the second association never connected. The wallet log showed "Starting local mobile-wallet-adapter WebSocket server" with no client, and after about 45 s it ended with "Local association cancelled by user". That design was dropped.
   - Using MWA `sign_in_payload` in a single session would require issuing the nonce before the address is known. That is a contract change, recorded as a follow-up.
2. **One domain constant.** `DEFAULT_SIWS_DOMAIN` drives both the SIWS domain and the app identity URI, so they always match.
3. **Signature shapes.** `signMessages` results are normalized: a bare 64-byte signature (the mock wallet's format) or message‖signature are accepted, and anything else is rejected.
4. **Android only.** The web and iOS bundles get `link.ts`, which throws and is never offered in the UI. MWA is not WalletConnect: WalletConnect stays excluded.
5. **No devnet demo transfer UI in this build.** The API supports server-owned transfer intents (ADR 0001 §9). The client-side transfer needs a funded devnet key in the wallet, and the mock wallet regenerates its key on every launch. It is therefore not offered, and is reported as not built.

## Device and test environment

- **Emulator.** `Medium_Phone_API_36.1` runs Android 16 (API 36), arm64, google_apis_playstore. **No physical Android or Seeker device was available.** Real-device gates (S0, B1 on hardware, B2 with a real wallet) remain blocked, not passed.
- **Release build for local testing.** The release APK bundles its JavaScript. `plugins/withLocalhostCleartext.js` allows cleartext HTTP only to `127.0.0.1` and `localhost`, which the device reaches over `adb reverse`. Every other host stays HTTPS-only.
