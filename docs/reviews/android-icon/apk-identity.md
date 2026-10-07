# Step 5: build and APK identity (pqa-ios, 2026-10-07)

## Build checkout
- `a854ed7`, detached, in `.worktrees/android-icon-build`. This is the icon commit `388ede9` merged with the P-13 fix `27608e9`, for the build only; no branch was merged.
- The only `apps/mobile` changes since `27608e9` are the icon assets, the render script and `app.json`.

## Commands
```
pnpm install --frozen-lockfile
EXPO_PUBLIC_API_URL=https://pocketqa.vercel.app/api EXPO_PUBLIC_POCKETQA_ENV=staging npx expo prebuild --platform android --clean --no-install
# then ONLY the two recorded edits (as in p11/p13):
#   android/app/build.gradle:92  applicationId 'com.reshareai.pocketqa' -> 'com.reshareai.pocketqa.e2e'
#   res/values/strings.xml:2     app_name "Pocket QA" -> "Pocket QA E2E"
export EXPO_PUBLIC_API_URL=https://pocketqa.vercel.app/api EXPO_PUBLIC_POCKETQA_ENV=staging   # same shell as gradlew: inlined at bundle time
./gradlew :app:createBundleReleaseJsAndAssets --rerun assembleRelease -PreactNativeArchitectures=arm64-v8a \
  --max-workers=2 --no-daemon -Pkotlin.compiler.execution.strategy=in-process   -> BUILD SUCCESSFUL in 40s
```

## Earlier attempts (none of them installed)
1. **Daemon build:** it hung on low memory, and the lead stopped PIDs 34136, 34147 and 34171. It had logged `:expo-dev-launcher:verifyReleaseResources FAILED`, but no cause was ever printed: the process was killed (exit 143) before Gradle's failure summary.
   - In the next run that same task passed.
2. **`1ea54848…`:** this APK had the env missing at gradle time, so its JS bundle had no API base. The lead said NO GO and it was not installed.

## APK: `~/.local/share/pocketqa/android-icon/pocketqa-e2e-icon-a854ed7-vc2-env.apk`
size 53070966
sha256 994eab1c2fdedf2b21b94be8f02d581e16a06e4ccf878ea9afe12eb15f26d7ae
bundle sha256 f44cf2ffc298874d746506c4614b16d87033e9f8c176f5063f062fdd17faaf07
Signer #1 certificate DN: CN=Android Debug, OU=Android, O=Unknown, L=Unknown, ST=Unknown, C=US
Signer #1 certificate SHA-256 digest: fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c
package: name='com.reshareai.pocketqa.e2e' versionCode='2' versionName='0.1.0' platformBuildVersionName='16' platformBuildVersionCode='36' compileSdkVersion='36' compileSdkVersionCodename='16'
application-label:'Pocket QA E2E'
application: label='Pocket QA E2E' icon='res/BW.xml'
native-code: 'arm64-v8a'

## Gates
- **Bundle sha256:** `f44cf2ff…faaf07`. This is byte-identical to the installed `.e2e` APK `3635ebad…`'s bundle, and the `strings -n 6` diff is 0 lines each way.
- **`https://pocketqa.vercel.app/api`:** 1 hit (the installed bundle: 1).
- **`8787`:** 0 hits.
- **`staging`:** 1 hit (the installed bundle: 1).
- **`EXPO_PUBLIC_*` keys:** the source uses `API_URL`, `POCKETQA_ENV` and `PREVIEW`. `PREVIEW` was unset in both builds, and the identical bundle shows the same values.
- **Icon:** `res/BW.xml` is an adaptive-icon. Its background is `@color/iconBackground` (`#0B0A1F`) and its foreground is the new `ic_launcher_foreground`. The installed APK used `res/d2.webp`, the default Expo icon.
- **Cert:** it equals the installed `.e2e` cert (`fac61745…3b9c`), so `adb install -r` keeps the app's data.
