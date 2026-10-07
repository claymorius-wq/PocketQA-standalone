# B2: preserve clips, TDD record (pqa-ios, 2026-10-07)

## Rules
Hamza's preserve rule: no recording is ever deleted automatically. The lead's B2 brief:
- (i) No age-based expiry. Only orphan temp files of non-active writes are dropped.
- (ii) Leaving the session screen never deletes a clip. Only an explicit Remove, with a confirm, deletes one.
- (iii) A 401, a restore failure or an ended Firebase session clears the session, never the clips. `clearAll` runs only on an explicit sign-out or account deletion, behind a confirm that states what is deleted.
- Plus the main-app P2: an offline local-mode start no longer signs out.
- versionCode 3.

## Changes
- **`modules/screen-capture/.../PendingStore.kt` `sweep`.** It never deletes a recording:
  - no TTL on clips (`TTL_MS` is removed);
  - a truncated MP4 is kept, and its session is still told once (`.rec` → `.lost`);
  - an unreadable meta is kept;
  - the only things dropped are `.tmp` files whose recording isn't active, markers or metas whose MP4 is gone, and `.lost` notices after `NOTICE_TTL_MS` (24 h). A notice is a message, not a recording.
- **`ScreenCaptureModule.kt` `OnCreate`.** It no longer deletes the legacy `cacheDir/recordings` directory.
- **`SessionProvider.tsx`.** `clear` becomes `endSession(opts)`, and `clearAllAsync` runs only with `{ deleteRecordings: true }`.
  - `signOut(opts?)` passes that option through.
  - A 401, an ended Firebase session, `resendVerification`, `discardUnverified` and a plain `signOut()` ("Use another account") keep the clips.
  - Local-mode restore: only `endsRestoredSession(e)` (UNAUTHENTICATED or EMAIL_UNVERIFIED) ends the saved session. Any other error keeps the token and sets `unreachable`, which shows "Can’t reach Pocket QA" with Try again. This fixes the main-app P2.
- **`SettingsScreen.tsx`.**
  - On a phone, Sign out opens a ConfirmSheet: "Recordings on this phone that you haven’t uploaded are deleted when you sign out." Its button is "Sign out and delete", and it calls `signOut({ deleteRecordings: true })`. On the web, Sign out signs out directly as before.
  - The account-deletion sheet now also states that recordings are deleted, and calls `signOut({ deleteRecordings: true })`.
- **`app/participation/[id].tsx`.**
  - Leaving in the foreground now calls `stopAsync()` on a live recording. The clip is finalised and kept natively. There is no `discardAsync`, `purgeAsync` or `deleteLocal` on native. Web blobs (page memory only) are still released.
  - Remove opens a ConfirmSheet: "It’s deleted from this phone and can’t be recovered."
- **`app.json`:** `android.versionCode` 3.

## Red (tests first, before any implementation)
Kotlin. The first run failed to compile (`Unresolved reference 'NOTICE_TTL_MS'`). After adding only that constant:
```
$ ./gradlew :pocketqa-screen-capture:testDebugUnitTest --no-daemon --max-workers=2 -Pkotlin.compiler.execution.strategy=in-process
PendingStoreTest > aTruncatedFileFromProcessDeathIsKeptAndItsSessionIsToldOnce FAILED
PendingStoreTest > anUnreadableMetadataFileNeverCostsTheClip FAILED
PendingStoreTest > tempFilesOfTheActiveRecordingAreKeptAndOthersDropped FAILED
PendingStoreTest > finishedClipsNeverExpire FAILED
34 tests completed, 4 failed, 1 skipped
```
JS:
```
$ npx jest --ci --verbose __tests__/participation-session.test.tsx src/screens/__tests__/settings.test.tsx __tests__/sign-out-recordings.test.tsx
  ✕ a plain sign-out (e.g. "Use another account") ends the session and keeps the recordings (2 ms)
  ✕ a 401 signs out but never deletes a recording (4 ms)
  ✕ local mode: a saved session the server rejects is cleared, its recordings kept (3 ms)
  ✕ local mode offline start (main-app P2): the saved session and the recordings are both kept, and the app says it can’t connect (2 ms)
  ✕ Firebase: a restored session that definitely ended signs out but keeps the recordings (3 ms)
  ✕ discarding an unverified sign-in keeps the recordings (2 ms)
    ✕ delete: the confirm waits for the phrase; a refusal shows "Couldn’t delete" in the sheet (231 ms)
    ✕ a deleted account signs out, and this device forgets which badges it showed that account (318 ms)
    ✕ phone: Sign out asks first and says the recordings not uploaded are deleted; Cancel keeps everything (146 ms)
    ✕ Remove deletes the clip before upload: the row leaves and nothing is pending (361 ms)
      ✕ a clip whose voice stops early is shown marked, can be removed, and can never be kept or uploaded (238 ms)
      ✕ leaving the session in the foreground stops the live recording and keeps every clip not uploaded (preserve rule) (179 ms)
Tests:       12 failed, 50 passed, 62 total
```

## Green
Kotlin:
```
$ ./gradlew :pocketqa-screen-capture:testDebugUnitTest --no-daemon --max-workers=2 -Pkotlin.compiler.execution.strategy=in-process
BUILD SUCCESSFUL in 13s
PendingStoreTest tests="13" failures="0" errors="0"; VoiceCheckTest 9 (1 skipped, pre-existing); PipelineLogicTest 10; CaptureMathTest 2
```
One test fix was made while going green: the truncated-file test's second sweep had passed `active = null`, which turns the still-active file into "interrupted". It now passes `active = active`.

JS:
```
$ npx jest --ci --verbose <the three files>     Test Suites: 3 passed, 3 total; Tests: 62 passed, 62 total
$ npx jest --ci                                  Test Suites: 68 passed, 68 total; Tests: 1401 passed, 1401 total
$ npx tsc --noEmit -p apps/mobile                exit 0
$ npx eslint <touched files>                     clean
$ pnpm check:secrets                             check:secrets passed: 1444 committable files scanned, no findings.
```

## Notes for review
- **P-13 fix.** This branch starts from `c39828b` (fix/android-icon) and does **not** contain the P-13 fix `27608e9`, nor its `CaptureStartTest`. The vc3 build checkout must merge `27608e9` again, as `a854ed7` did. The files don't overlap: P-13 touches the Service and CaptureStart, while this branch touches PendingStore, the Module's `OnCreate` and the `purgeAsync` doc.
- **Truncated MP4s** are now kept forever and are never listed. They stay on the device until a confirmed sign-out or account deletion. A tester-facing way to reach them is out of scope.
- **Web** recordings are page-memory blobs. Leaving the screen or ending the session still releases them, because they can't outlive the page anyway.
- **Privacy guardrail 1** still holds: `pending(tag)` lists clips only to their own participation, which the API authorises only for that account.
