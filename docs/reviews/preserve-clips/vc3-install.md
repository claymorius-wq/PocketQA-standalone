# vc3 install (pqa-ios, 2026-10-07): parent GO via the lead; pqa-qa code APPROVE r2. NOT launched

```
$ shasum -a 256 ~/.local/share/pocketqa/preserve-clips/pocketqa-e2e-vc3-183beca.apk     # 14:20:12Z
329740d2b4f74b16f1695b786d902eab02b1567b58a04e463c20ce4b2a9078c4
$ adb -s SM02E4072811963 install -r ~/.local/share/pocketqa/preserve-clips/pocketqa-e2e-vc3-183beca.apk   # 14:20:12Z -> 14:21:32Z
Performing Streamed Install
Success
install-exit=0
$ adb shell sha256sum <pm path com.reshareai.pocketqa.e2e>/base.apk
329740d2b4f74b16f1695b786d902eab02b1567b58a04e463c20ce4b2a9078c4
```

| com.reshareai.pocketqa.e2e (device time) | before | after |
|---|---|---|
| versionCode | 2 | 3 |
| firstInstallTime | 2026-10-06 23:05:06 | 2026-10-06 23:05:06 (unchanged) |
| lastUpdateTime | 2026-10-07 15:36:22 | 2026-10-07 16:21:31 |
| pkgFlags | HAS_CODE ALLOW_CLEAR_USER_DATA ALLOW_BACKUP | unchanged (not debuggable) |
| process (`pidof`) | none | none: not launched |

The main package `com.reshareai.pocketqa` was not touched: versionCode 1, 2026-10-06 01:16:50. There was no uninstall, no clear, no adb reverse change and no recording. The B1 backup build was never installed; it is superseded.

## Launcher icon
- **Screenshot: not taken. The device is locked** (`isKeyguardShowing=true`, `deviceLocked=1`, `mWakefulness=Asleep`). I did not wake it and entered no PIN.
- **The launcher's view of the icon:**
  - `cmd package resolve-activity -c LAUNCHER -a MAIN com.reshareai.pocketqa.e2e` returns `com.reshareai.pocketqa.e2e/com.reshareai.pocketqa.MainActivity` with `icon=0x7f0f0000`.
  - In the installed APK, `aapt2 dump resources` maps `0x7f0f0000` to `mipmap/ic_launcher`, whose `(anydpi-v26)` entry is `res/BW.xml`. That file is the adaptive icon: background `#0B0A1F`, foreground `ic_launcher_foreground`. On Android 8+ (the Seeker runs Android 16) the launcher uses it.
  - The density fallbacks are new too. The mdpi `res/d2.webp` has sha256 `b5dd503b…`; the `3635ebad` build had `eef20f25…`, the default Expo icon.
