# vc3 candidate APK identity (pqa-ios, 2026-10-07). NOT installed: waiting for the pqa-qa APPROVE and the lead GO

- **Build checkout:** `.worktrees/preserve-clips-build2` @ `183beca`, which is `bec9671` merged with the P-13 fix `27608e9`. Build only; no branch was merged.
- **Recipe:** `docs/reviews/android-icon/e2e-build-recipe.md`. Env exported in the same shell as gradlew, then `:app:createBundleReleaseJsAndAssets --rerun assembleRelease`, not debuggable.
- **Merged source:** `ScreenCaptureModule.kt:130-138` OnCreate runs the sweep only (no cacheDir wipe). CaptureStart is at `:53`, `:65`, `:72` and `:115-116`. `ScreenCaptureService.kt:168` and `:225` call `settle`.
- **Module tests on the merged checkout:** PendingStoreTest 17/17, CaptureStartTest 8/8, VoiceCheckTest 9 (1 skip, pre-existing), PipelineLogicTest 10/10, CaptureMathTest 2/2.

```
apk ~/.local/share/pocketqa/preserve-clips/pocketqa-e2e-vc3-183beca.apk
size 53072282
sha256 329740d2b4f74b16f1695b786d902eab02b1567b58a04e463c20ce4b2a9078c4
bundle sha256 655432728e5e1664ffd97f6b975068217ddcab2265939d602baaba83d6fe35dd
Signer #1 certificate SHA-256 digest: fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c
package: name='com.reshareai.pocketqa.e2e' versionCode='3' versionName='0.1.0' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36' compileSdkVersionCodename='16'
application-label:'Pocket QA E2E'
application: label='Pocket QA E2E' icon='res/BW.xml'
native-code: 'arm64-v8a'
bundle vercel/api: 1
bundle 8787: 0
dex hits CaptureStart: 7
dex hits PendingStore: 10
dex hits settle: 16
Sign out and delete: 1
staging: 1
Remove this clip?: 1
```

The first five gates (cert, package and versionCode, label, icon, bundle content) are the lead's. The badging has no `application-debuggable` line. The `dex hits` counts are byte grep counts (presence only). `Sign out and delete` and `Remove this clip?` are the new ASCII UI strings; the remove-sheet body contains a curly apostrophe, so Hermes stores it as UTF-16 and a byte grep is not used for it.
