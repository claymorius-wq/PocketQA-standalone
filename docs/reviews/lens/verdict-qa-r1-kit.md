# pqa-qa verdict r1: UI kit, glass, motion, theme and platform (PR #3, HEAD 75e009a)

This was a read-only review against `origin/main` 9461db5. It covers everything PR #3 changes in `apps/mobile/src/ui` (the kit, `StackHeader`, `patterns/*`), `src/glass`, `src/motion`, `src/theme` and `src/icons`. It also covers the kit tests (`shared.test.tsx`, `chrome.test.tsx`, `ui.test.tsx`, `__tests__/contrast.test.ts`) and ADR 0006. I used only `git diff/show/grep/log`, Read and Grep. I also read the installed react-native-web 0.21.3 and expo-blur sources to check web behaviour. Nothing was built, run or tested, because a verification run is in progress on this checkout. Every kit change only adds things: no prop, export, testID or accessibility prop was removed, so every caller still fits. That includes the PR #2 files PR #3 did not touch. Light and system themes still work, the contrast thresholds are unchanged, every new animation honours reduced motion, and no dependency or native config changed. I found no P0, P1 or P2 issues. There are eight P3s below (hardening, web accessibility and ADR accuracy), and two of them already exist on main. This area is safe to merge.

## Checked
- **Kit API against every call site.** `Screen`, `Field`, `Button`, `Card`, `Text`, `Notice`, `StatusPill`, `ConfirmSheet`, `Segmented`, `Checkbox`, `EmptyState`, `ErrorState` and the patterns only gain optional props or exports. The untouched consumers use only existing props: `apps/mobile/src/wallet/TransferCard.tsx`, `apps/mobile/src/evidence/EvidenceItem.tsx`, `apps/mobile/src/screens/TabsLayout.tsx` and `apps/mobile/app/_layout.tsx`.
- **`Screen` defaults match main.**
  - `headerGap` 22 minus `layout.listGap` 14 gives main's 8 (`apps/mobile/src/ui/index.tsx:163`).
  - Stack content starts at `headerHeight + 8` (`:197`), the same as main's SafeAreaView padding plus 8 (`origin/main:apps/mobile/src/ui/index.tsx:137,145`).
  - With no dock, the bottom padding is main's (`:199-200`).
  - Every dock caller passes `null` rather than leaving the prop out, so content never remounts.
- **`Notice` children** (`apps/mobile/src/ui/status.tsx:141`, unchanged from main). All 36 call sites pass one string, one template string or an element (`WordingBody`, `DateText`, `RNText`). Nothing renders raw text on native today.
- **`Text` " · " clause dots** (`apps/mobile/src/ui/text.tsx:77-95`).
  - The characters are unchanged (`apps/mobile/src/ui/__tests__/shared.test.tsx:573-590`).
  - Web font stacks resolve to their first family (`text.tsx:44-47`).
  - The bare `·` only ever renders inside a React Native Text (`apps/mobile/src/ui/patterns/SectionHeader.tsx:49`, `apps/mobile/src/ui/patterns/type.tsx:84`, `text.tsx:87`).
- **`ConfirmSheet` commit-pass lock** (`apps/mobile/src/ui/index.tsx:847-848`). It uses the same `glass.enabled && motion.play.uplightCommit` gate as both callers (`apps/mobile/app/builder/study/[id].tsx:78`, `apps/mobile/app/builder/review/[id].tsx:105`). So the light theme and reduced motion close the sheet at once. The 15 s pending escape is unchanged.
- **`Button`.**
  - The opaque `primaryDisabled` fill now sits over the lit glass (`apps/mobile/src/ui/button.tsx:77-84`), so the disabled label still shows on the colour pair the contrast test measures.
  - The blue glow follows `lit` (`:105`).
  - There is no sweep while disabled.
  - `locked` means disabled plus busy.
  - `compact` stays 48dp tall.
- **Light and system themes.** Every new token has a light value (`apps/mobile/src/theme/tokens.ts:81,597,612,619-620`). Each of these switches on `glass.enabled` before drawing anything Lens-only: HeaderScrim, GroundFade, SegmentRing, the lock shade, the Notice uplight, UplightMotes, CausticSweep and the commit lock. `ThemeProvider` is untouched.
- **`apps/mobile/__tests__/contrast.test.ts`.** The 4.5 and 3 thresholds are unchanged (`:78-83,140-142`). The diff only adds `textDim` (`:56,110`) and `wellDark` (`:117`), for the new palette key (ListRow `dim`) and the new recipe (Review's unlit AI well). Nothing was weakened.
- **Reduced motion.** The Field lock drops its sink (`apps/mobile/src/ui/index.tsx:448`). The dock's `hide` is a 120ms fade (`:334`). The StatusPill crossfade, the `land` grade (nothing), BalanceGlyph (final pose) and `sweepSignal` (CausticSweep off) all comply. New timings reuse `motion.timing.*` (ReduceMotion.Never) or use duration 0.
- **Reanimated and worklets.**
  - No shared value is read during render, and writes happen only in effects.
  - Worklets capture only shared values, numbers, the worklet `panShift` and the stable `motion` object.
  - There is no new `withRepeat`, and every new timer is cleared.
  - Only transform and opacity animate.
- **Web versus native.**
  - `BlurTargetView` is a plain View off Android (expo-blur).
  - `GlassBlur` falls back to an opaque fill when `backdrop-filter` is missing (`apps/mobile/src/glass/GlassBlur.tsx:27-29,70`).
  - `PRETTY_WRAP` applies only on web, and react-native-web drops `textBreakStrategy`.
  - The StackHeader clip frame stops the push from widening the mobile-web viewport (`apps/mobile/src/ui/StackHeader.tsx:64,123`).
  - The sheet title is only a tabindex −1 focus target (`apps/mobile/src/ui/index.tsx:921`).
- **Accessibility.**
  - New touch targets are at least 48 (compact Button, 48dp Segmented cells under a 44 tile, Checkbox). Back stays 44, as on main.
  - Decorative layers are hidden (HeaderScrim, SegmentRing, the outgoing pill, BalanceGlyph).
  - "Edit device profile" keeps the visible label inside its accessible name (`apps/mobile/app/(tester)/discover.tsx:90`).
  - Timeline keeps the full date in its accessibility label.
- **Tests.** The new kit behaviour is covered by `apps/mobile/src/ui/__tests__/shared.test.tsx`: dock, scrim, fill, commit lock, pill crossfade, land grade, clause dots and the disabled-primary glow. `chrome.test.tsx` covers the clip frame and shows Back only when there is history.
- **Dependencies.** `package.json`, `pnpm-lock.yaml`, `apps/mobile/app.json` and `apps/mobile/babel.config.js` are identical to main. `docs/decisions/dependency-versions.md` only renumbers the ADR.

## Findings
1. [P3] On web, keyboard focus can land under the header scrim or a dock. `apps/mobile/src/ui/index.tsx:197,211-216,232-239`.
   - The ScrollView now starts at the screen top, under the transparent header. On main the SafeAreaView was padded (`origin/main:apps/mobile/src/ui/index.tsx:145`), so the scroll area began below the header. It also runs under the absolutely positioned dock (`:990`), and the opaque HeaderScrim and the dock are drawn above it.
   - Browsers only scroll a focused control into view when it is outside the scroll area, and that area now includes those strips. So Tab (on New study, Builder study, Review, Session and Sign in), or Shift+Tab after scrolling, can focus a control that stays hidden (WCAG 2.2 SC 2.4.11, focus not obscured).
   - On desktop web, the top of the scrollbar also sits under the header.
   - Tab roots already had this under the floating tab bar on main.
   - I read this mechanism from the code and did not reproduce it in a browser.
   - Fix: on web, set `scrollPaddingTop: headerHeight + STACK_CONTENT_GAP` and a `scrollPaddingBottom` for the dock or tab-bar room on the ScrollView. Add a Playwright check that tabs through New study.
2. [P3] The HeaderScrim's cost is outside the ADR's performance budget. `apps/mobile/src/ui/index.tsx:239,273-284`, `apps/mobile/src/glass/Ground.tsx:177,192-199,201`.
   - Every scrolling stack screen gains two masked SVG canvases and up to five grain tiles.
   - The scrim's pool canvas shares the Ground's `poolStyle`, so it animates with every key-light change.
   - A commit sheet on Builder study or Review therefore animates the ground pool, the scrim pool and the sheet's floor together. ADR 0006:69 says "at most 2 animating SVG layers", and :72 still says the header "paints nothing … one ground, not two".
   - This has not been measured on the Seeker.
   - Fix: count the scrim in the budget and include it in the Seeker measurement.
3. [P3] The commit-pass lock has no escape when `onLeave` is missing. `apps/mobile/src/ui/index.tsx:847-852`.
   - While `passing` is true, Cancel, back, Escape and the backdrop are all ignored, and `usePendingEscape` (`:771-780`) only releases `pending`.
   - Both callers pass `onLeave` (`apps/mobile/app/builder/study/[id].tsx:229`, `apps/mobile/app/builder/review/[id].tsx:191`), so nobody can get stuck today.
   - But nothing in the API requires it, and `apps/mobile/src/ui/__tests__/shared.test.tsx:112-120` renders exactly that locked state.
   - Fix: make `onLeave` required whenever `status` is passed, or release `passing` after `PASS_LEAVE_AFTER` plus a margin.
4. [P3] `Notice` only wraps a lone string in Text. This already exists on main (`origin/main:apps/mobile/src/ui/status.tsx:81`). `apps/mobile/src/ui/status.tsx:141`.
   - Mixed children such as `Couldn’t save {name}` (an array), or a number, render raw inside a View. On Android and iOS that throws "Text strings must be rendered within a <Text> component". On web it shows unstyled text.
   - All 36 callers comply today; `apps/mobile/app/(auth)/sign-up.tsx:68-71` builds a single template string for exactly this reason.
   - Fix: wrap the children in Text when every child is a string or number.
5. [P3] On web, checkbox, radio and busy states are not exposed to assistive tech. This already exists on main (`origin/main:apps/mobile/src/ui/index.tsx:354,371`). `apps/mobile/src/ui/index.tsx:635,685`, `apps/mobile/src/ui/button.tsx:150`.
   - react-native-web 0.21.3 neither forwards nor maps `accessibilityState`. Its `forwardedProps` and `createDOMProps` accept only `aria-*` and `accessibilityX` props.
   - As a result, the Checkbox has no `aria-checked`, including the study consent box (`apps/mobile/app/study/[id].tsx:115`). No Segmented radio has one either (role, theme, top-up, dispute outcome). A busy or `locked` Button has no `aria-busy`.
   - Native is fine. `apps/mobile/src/ui/TabBar.tsx:120` and `apps/mobile/src/ui/patterns/LensShimmer.tsx:35` already pass `aria-*`.
   - Fix: add `aria-checked` and `aria-busy` alongside `accessibilityState`.
6. [P3] The StackHeader clip frame cuts the back tile's shadow, although its comment says it keeps it. `apps/mobile/src/ui/StackHeader.tsx:60-63,119,123`.
   - The back tile's cast shadow (`9px 13px 22px -9px`, `apps/mobile/src/theme/tokens.ts:437`) reaches about 26dp below the tile. The frame keeps only 12, on every platform.
   - What gets cut is a faint tail on the ground. I have not checked it on a device.
   - Fix: clip only on web (the viewport bug is web-only), keep about 28dp below the row, or correct the comment.
7. [P3] The kit has dead code. `apps/mobile/src/ui/screen.tsx:124-136`, `apps/mobile/src/ui/index.tsx:245-256`.
   - `useSwapFade` has had no caller since StatusPill moved to its crossfade.
   - `ScreenSpacer` has no caller in the app. Its doc cites A-SignIn, but Sign in uses the last-child rule instead (`apps/mobile/app/(auth)/sign-in.tsx:188-191`).
   - Fix: remove both, or keep `ScreenSpacer` and correct its doc.
8. [P3] ADR 0006 is out of date in places. `docs/decisions/0006-lens-visual-system.md:59,91,97,102,135`.
   - :91 says "only the drawing changed. Screens did not change", but PR #3 rebuilds every screen and adds kit behaviour.
   - :97 says ErrorState's tile has "the danger rim". It is now info, neutral or warning (`apps/mobile/src/ui/index.tsx:564,569-570`).
   - :102 lists `edge` placement for Sign in only. New study, Builder study and Review use it too.
   - :59 omits the new `textDim` and `wellDark` contrast cases.
   - The kit section never mentions:
     - the `Text` " · " rewrite (`apps/mobile/src/ui/text.tsx:77-95,128`)
     - the confirm glyph and the text-only generic confirm (`apps/mobile/src/ui/index.tsx:733-762,854`)
     - `glass.lockShade`
   - :135 Testing omits `apps/mobile/src/ui/__tests__/shared.test.tsx`.
   - Fix: update those lines.

## Verdict
APPROVE
