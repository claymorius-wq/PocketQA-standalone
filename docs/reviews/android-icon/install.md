# Step 6: install (pqa-ios, 2026-10-07): lead GO after pqa-qa PASS (qa-android-icon-r1.md)

```
$ shasum -a 256 ~/.local/share/pocketqa/android-icon/pocketqa-e2e-icon-a854ed7-vc2-env.apk     # 13:34:57Z, right before install
994eab1c2fdedf2b21b94be8f02d581e16a06e4ccf878ea9afe12eb15f26d7ae
$ adb -s SM02E4072811963 install -r ~/.local/share/pocketqa/android-icon/pocketqa-e2e-icon-a854ed7-vc2-env.apk   # 13:35:03Z
Performing Streamed Install
Success
exit=0
```

| com.reshareai.pocketqa.e2e (device time) | before (13:34:57Z) | after (13:36:23Z) |
|---|---|---|
| firstInstallTime | 2026-10-06 23:05:06 | 2026-10-06 23:05:06 (unchanged) |
| lastUpdateTime | 2026-10-07 00:39:09 | 2026-10-07 15:36:22 (changed) |
| versionCode | 1 | 2 |
| signatures | [51ed3f60] | [51ed3f60] |

The main package `com.reshareai.pocketqa` was not touched and not launched. Before and after: firstInstallTime = lastUpdateTime = 2026-10-06 01:16:50, versionCode 1.

None of the following happened: an uninstall, a `pm clear`, an adb reverse change, or a recording.
