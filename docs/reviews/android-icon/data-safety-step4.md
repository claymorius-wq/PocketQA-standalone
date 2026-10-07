# Step 4: data-safety check (code read at fix/android-icon `2124b70`), pqa-ios, 2026-10-07

Question: if the main package `com.reshareai.pocketqa` is updated in place (`adb install -r`, data kept) with a build whose baked API base is `https://pocketqa.vercel.app/api` (hosted Firebase) instead of the loopback `http://127.0.0.1:8787` (local auth), can its first launch lose local user data (un-uploaded clips, notices, the local session)?

## What deletes local recording data
- `apps/mobile/src/auth/SessionProvider.tsx:85-97` `clear()`. Line 90 is `nativeRecorder()?.clearAllAsync?.()`, and `ScreenCaptureModule.kt:63` `clearAllAsync` deletes **every clip and notice on the device**. Then it clears the token store and signs out of Firebase. `clear()` runs:
  - as `onUnauthenticated` on any API 401 (lines 116, 136);
  - when a restored Firebase session definitely ends (line 151);
  - in local mode, when restoring the saved token fails for **any** reason (lines 156-162: `try { setUser(await api('me')) } catch { await clear() }`);
  - on sign-out and account deletion (lines 255, 260, 299-301).
- `modules/screen-capture/android/.../ScreenCaptureModule.kt:46-51` `OnCreate`. It runs at **every app start, whatever the backend**:
  - `store.sweep(...)` deletes truncated recordings and **finished clips older than `TTL_MS` = 24 h** (`PendingStore.kt:180`);
  - it deletes the legacy `cacheDir/recordings`.

## First launch of the main package with the hosted build
1. `/config` from the hosted API reports `authMode: firebase`, so the Firebase branch runs (line 130) and **returns before** `restoreToken` (line 156). The old 8787 local token in the token store is neither sent nor cleared.
2. There is no persisted Firebase session in this app (it has only ever used local auth), so `onIdToken` reports `null`, no `resolveManaged`, and **no `clear()`** (line 151).
3. **But** the native module's `OnCreate` sweep runs at that first start and deletes any finished, unclaimed clip older than 24 h, and any truncated file. The installed main app was last updated 2026-10-06 01:16:50 (device time), so any clip it still holds from that day is past the TTL. That clip is lost on the first launch, **whatever the backend**. The same happens if the current build is simply launched.
4. Later: signing out on the hosted build calls `clear()`, which deletes all clips on the device.

## The main package kept on 8787 (fallback)
- If the main app is launched **without** `adb reverse tcp:8787` to the live USB API, the local branch's catch-all (lines 156-162) treats the network failure as a failed restore and calls `clear()`. That **wipes its clips and its saved local session**.
- This is a pre-existing defect: an offline start is handled like a sign-out in local mode. The Firebase branch keeps an offline session (line 151).
- So the main app must not be launched at all unless 8787 is reachable through adb reverse, which needs the lead's OK.

## What can't be checked from here
The app is a release build (not debuggable), so `run-as` is not possible and I can't list its `noBackupFilesDir/recordings`. App data was 1,257,472 B on 2026-10-06 (dumpsys diskstats). That doesn't prove whether a clip is present.

## The `.e2e` package
- It already uses the hosted API, so there is no backend switch.
- `adb install -r` keeps its data and does not start the app.
- Its two local clips (Hamza's own, recorded 2026-10-06 21:49:34Z and 21:50:35Z, never uploaded) reach the 24 h TTL at about **2026-10-07 21:49Z / 21:50Z**. A launch **before** then keeps them listed; the first launch after then sweeps them, by design and independent of this update.

## Verdict: STOP (local data could be lost)
- Main package to hosted: no session-switch wipe, but the first launch can expire any >24 h clip, and a later sign-out wipes all clips.
- Main package on 8787 without the reverse: the launch wipes the clips and the session.
- `.e2e` package (fallback): update + launch before ~21:49Z keeps everything.
