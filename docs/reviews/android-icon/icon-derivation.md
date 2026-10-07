# Android launcher icon: derivation (pqa-ios, 2026-10-07)

No icon image file existed in the repo. The asset is the exact vector render of the code-drawn landing-page FlutedLens (rest pose, dark). This was the lead's choice and Hamza can override it.

Source: `<FlutedLens size={104} drift={drift} />` in `apps/mobile/app/(auth)/welcome.tsx:305`, from `apps/mobile/src/glass/FlutedLens.tsx`.
- `FLUTE_SIZES[104]`: radius 30, 12 ribs.
- Dark theme, `reducedMotion: reduce`, which gives the rest pose with no shimmer and no drift.

No new image was generated and nothing was redrawn. Only mechanical capture, resize, pad and convert steps were used, in headless Chromium (Playwright) only.

## Commands (worktree `.worktrees/android-icon`, base `b8eb928`)
```
cd apps/mobile
pnpm install --frozen-lockfile
npx expo export --platform web --output-dir dist-web --clear      # local, log: ~/.local/share/pocketqa/android-icon/export.log
PORT=8091 node e2e/serve-web.mjs &                                # loopback only, PID 31071 recorded in serve.pid
R=~/.local/share/pocketqa/android-icon/render
node scripts/icon/render-flutedlens.mjs extract http://127.0.0.1:8091/welcome $R/flutedlens-104-dark.html
cp $R/flutedlens-104-dark.html assets/icon/flutedlens-104-dark.html
node scripts/icon/render-flutedlens.mjs raster assets/icon/flutedlens-104-dark.html assets/icon
npx expo prebuild --platform android --clean --no-install         # check only (android/ is gitignored)
```
- **Legacy icon:** the 104x104 tile at DPR 1024/104, on `#0B0A1F`.
- **Adaptive foreground:** the tile centred on a transparent 158 css px canvas at DPR 1024/158. The tile spans 104/158 = 65.8 %, inside the 66 % safe zone.
- **Adaptive background:** `#0B0A1F`.
- **Densities:** Expo prebuild generated every density, for `ic_launcher`, `ic_launcher_round` and `ic_launcher_foreground` (mdpi through xxxhdpi), plus the `mipmap-anydpi-v26` XML.
- **Version code:** `android.versionCode` was set to 2.

## Outputs (sha256)
| file | sha256 |
|---|---|
| assets/icon/flutedlens-104-dark.html (canonical asset, 224,463 B, self-contained, grain inlined) | 7372b6350dfa380a40979c049d3609a85975e681f589666785d38e3e18168639 |
| assets/icon/icon-1024.png (1024x1024 RGB) | 233794b7c3e566b41bccac0a06f22f0bce279917d24bf7d072dd5b9254deb688 |
| assets/icon/adaptive-foreground-1024.png (1024x1024 RGBA) | a8767613d972eb3ae8dce32290653b0c725cfd6f1052519055bae1edf6d8b79d |
| render/flutedlens-104-dark.landing-ref.png (the element as the landing page shows it) | 0f37e323966273bf8647d1ae15dab1b9054cd079d8adf956fd6da35c2c95b54a |
| render/asset-1x-check.png (the asset at 1x) | 298b3ce458335eac11ee1215bb467eea5c5a730f7aba55ec62b531736815238b |

**Fidelity** (asset at 1x compared with the landing reference):
- max channel diff 11;
- mean 0.764;
- grain and antialiasing only, no visible change.

## Checks
- `npx eslint apps/mobile/scripts/icon/render-flutedlens.mjs`: clean.
- `npx jest --ci __tests__/broadcast-extension-plugin.test.ts` (reads app.json): 14/14 passed.
- `tsc --noEmit`: exit 0.
- `check:secrets`: passed, 1440 files.
