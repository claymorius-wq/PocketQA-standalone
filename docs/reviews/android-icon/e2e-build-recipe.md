# Recipe: the `.e2e` APK variant (P3-I1)

The `com.reshareai.pocketqa.e2e` variant ("Pocket QA E2E") installs **next to** the main app and uses the hosted backend.

There is no repo config for it. It is made only from these steps, which are the same in the p11 (`7bda3ce`) and p13 (`27608e9`) records and in this build (`a854ed7`).

```
# clean checkout of the commit to build
pnpm install --frozen-lockfile
cd apps/mobile
export EXPO_PUBLIC_API_URL=https://pocketqa.vercel.app/api
export EXPO_PUBLIC_POCKETQA_ENV=staging
# EXPO_PUBLIC_PREVIEW: leave unset
npx expo prebuild --platform android --clean --no-install
# exactly two edits, nothing else:
#   android/app/build.gradle                      applicationId 'com.reshareai.pocketqa'  ->  'com.reshareai.pocketqa.e2e'
#   android/app/src/main/res/values/strings.xml   <string name="app_name">Pocket QA</string>  ->  Pocket QA E2E
cd android
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ANDROID_HOME=$HOME/Library/Android/sdk
./gradlew :app:createBundleReleaseJsAndAssets --rerun assembleRelease -PreactNativeArchitectures=arm64-v8a \
  --max-workers=2 --no-daemon -Pkotlin.compiler.execution.strategy=in-process
```

## Pitfall: export the EXPO_PUBLIC_* env in the same shell as `gradlew`
Metro inlines them when it bundles the JS, which happens inside `:app:createBundleReleaseJsAndAssets`, not at prebuild time.

That task's up-to-date check does not track the env. A rebuild without the env, or one reusing a stale bundle, produces an APK whose bundle has no API base. That happened with `1ea54848…`: the lead said NO GO and it was never installed. Rerun the bundle task (`--rerun`) whenever the env changes.

## Gates before install
- **Cert:** `apksigner verify --print-certs` must show the cert of the package already installed. This Mac's debug key is `fac61745…3b9c`.
- **Badging:** `aapt2 dump badging` must show package `com.reshareai.pocketqa.e2e`, label `Pocket QA E2E` and the intended versionCode.
- **Bundle:** `unzip -p <apk> assets/index.android.bundle | LC_ALL=C grep -a -c pocketqa.vercel.app/api` must be ≥ 1, and the count of `8787` must be 0.
- **Install:** `adb install -r` only. Never uninstall or clear, because that would destroy local clips.
