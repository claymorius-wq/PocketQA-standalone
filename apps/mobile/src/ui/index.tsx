import { BlurTargetView } from 'expo-blur';
import { HeaderHeightContext, NavigationContext, NavigationRouteContext } from 'expo-router/react-navigation';
import { BottomTabBarHeightContext } from 'expo-router/tabs';
import { Children, createContext, isValidElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type Ref, type RefObject } from 'react';
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Path, Rect } from 'react-native-svg';
import { ApiError } from '../api/client';
import { BlurTargetContext, GlassBlur, GlassSurface, Ground, GroundFade, useKeyLight, useUplight, Well } from '../glass';
import { GradientDef, GradientRule, HIDDEN, useSvgId } from '../glass/paint';
import { GlassTile, TabGlyph, type GlyphName } from '../icons';
import { useCrossfade, useSheetMotion, useTabTile } from '../motion';
import { ENTRANCE_WINDOW, useArrival, type InitialArrival } from '../motion/entrance';
import { useSheetFocus } from '../motion/sheet';
import { DUR } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { layout, radius, space, touch, TOUCH, type Tone as GlassTone } from '../theme/tokens';
import { FocusPressable } from './focus';
import { type KitIcon } from './icon';
import { HEADER_ROW_BOTTOM } from './StackHeader';
import { CommitUplight, useCommitUplight, type CommitStatus } from './patterns/light';
import { SheetActions, SheetFailure } from './patterns/DecisionBar';
import { EmptyPanel, ErrorPanel } from './patterns/EmptyPanel';
import { LensShimmer } from './patterns/LensShimmer';
import { SectionHeader } from './patterns/SectionHeader';
import { ArrivalContext, arrivalOf, Enter, ScreenContext, type ScreenInfo } from './screen';
import { Text } from './text';

// The shared UI kit in the Lens visual system (docs/decisions/0006-lens-visual-system.md;
// Direction A v2 §8). Every export keeps its pre-Lens props, testIDs, accessibility and copy;
// only the drawing changed. Dark is the Lens look; light degrades every glass recipe to a flat
// surface (TODO(light-lens): the light Lens theme replaces those recipes in tokens.ts).
//
// One implementation per shared element (CONSISTENCY): Text, Button, Card, StatusPill, Notice
// and the spinner live in leaf modules (text, button, card, status, spinner) that the patterns
// import too; the kit's states, Section, Divider and ConfirmSheet are thin wrappers over the
// patterns (LensShimmer, EmptyPanel, ErrorPanel, SectionHeader, GradientRule, SheetActions,
// useCommitUplight), so nothing here draws a second version of them.

export { glyphNameFor, KitIconView, type KitIcon } from './icon';
export { LensStackHeader, lensStackScreenOptions } from './StackHeader';
export { LensTabBar } from './TabBar';
export { FocusPressable, FocusRingStyles, focusRingCss, useFocusRing } from './focus';
export { ArrivalContext, useScreenFocused, type ArrivalSpec } from './screen';
export { Text } from './text';
export { Button, type ButtonProps, type ButtonSize } from './button';
export { Card } from './card';
export { Notice, StatusPill } from './status';
export { Spinner } from './spinner';

const PASS: ViewStyle = { pointerEvents: 'none' };
const WEB = Platform.OS === 'web';

export function Screen({ children, title, subtitle, scroll = true, fill = false, testID, right, entrance, dock, dockPlacement = 'float', dockKeyboard = 'stay', dockClearance = space.xl, scrollRef, headerGap = HEADER_GAP }: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  /**
   * Ground between the title block's last line and the first content (default 22: the admin
   * boards' 20 under the 44dp status band). The tester boards leave more: Discover 28, My work 26,
   * Settings 30.
   */
  headerGap?: number;
  scroll?: boolean;
  /**
   * The content fills the viewport (at least its height; taller content still scrolls), so a
   * layout can anchor content to the bottom (A-SignIn's card above its footer, A-Discover's footer
   * above the tab bar). The free room goes to the `ScreenSpacer` children, split evenly; without
   * any, the last child takes it, so a View in it with `marginTop: 'auto'` (or a `flexGrow: 1`
   * spacer) sits at the bottom. Off by default: a screen that does not pass it lays out unchanged.
   */
  fill?: boolean;
  testID?: string;
  right?: ReactNode;
  /**
   * How this screen opens (§11.3, CONSISTENCY §M3). Default: the layout's ArrivalContext, else
   * `tab` inside the role tabs and `push` anywhere else. `launch` (the light dip and the
   * staggered steps) belongs to Sign in alone. Returns to the screen play `back` or `tab` by themselves.
   */
  entrance?: InitialArrival;
  /**
   * The screen's bottom dock (A-NewStudy Save draft, A-BStudy's actions, A-Review's Decision bar,
   * A-Session's Start session, A-SignIn's primary). It floats over the content inside the Ground
   * and the content root, so it arrives (and returns) with the screen and an Uplight in it dims the
   * key light; content mounted after the arrival rises in by itself. The scroll content ends
   * `dockClearance` above it, so nothing rests under it. The content sits in a BlurTargetView, and
   * every GlassBlur in the dock without its own target blurs it (Android).
   *
   * A screen whose dock comes and goes passes `null` while it has none (never leaves the prop
   * out): whether the prop is passed at all decides the content's wrapper, so the content (its
   * state, scroll position and any open sheet) is never remounted when the dock changes.
   */
  dock?: ReactNode;
  /**
   * `float` (default): the L3 position, 12dp in from the edges and above the bottom inset; the dock
   * draws its own glass (GlassBlur, DecisionBar `docked`). `edge`: full width, flush with the
   * screen's bottom edge; the dock pads itself (Sign in, whose Mode B floor is anchored to that edge).
   */
  dockPlacement?: 'float' | 'edge';
  /**
   * While the software keyboard is up: `stay` (default) leaves the dock where it is, `hide` fades
   * it out and stops its touches so it never covers the field being typed in (A-NewStudy), `ride`
   * lifts it onto the keyboard (A-SignIn: the primary stays reachable). Native only.
   */
  dockKeyboard?: 'stay' | 'hide' | 'ride';
  /** Ground left between the end of the content and the dock's top edge (default 24). */
  dockClearance?: number;
  /**
   * The scroll view, for a screen that scrolls itself (e.g. to bring a decision into view). Tab
   * roots also scroll to the top when their tab is pressed again (C3), with or without it.
   */
  scrollRef?: RefObject<ScrollView | null>;
}) {
  // A stack screen draws under the transparent Lens header (app/_layout.tsx): its content starts
  // below the header and scrolls up under it, where the HeaderScrim fades it into the ground; tab
  // screens sit above the floating tab bar, which reports its height.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const tabBar = useContext(BottomTabBarHeightContext);
  const tabBarHeight = tabBar ?? 0;
  const insets = useSafeAreaInsets();
  const { motion } = useTheme();
  const stack = headerHeight > 0;
  const spec = useContext(ArrivalContext);
  const layoutArrival = arrivalOf(spec);
  const navigation = useContext(NavigationContext);
  const route = useContext(NavigationRouteContext);
  const arrival = useArrival(entrance ?? layoutArrival ?? (tabBar !== undefined ? 'tab' : 'push'), navigation, route?.key);
  const { staggered, duration } = arrival.plan;
  const [mountedAt] = useState(() => Date.now());
  // A root arrival leaves no wave open: the first step that mounts after it starts a fresh one.
  const [wave] = useState(() => ({ start: staggered ? mountedAt : -Infinity }));
  // U1's hand-off (§M3): the first tab after Sign in finishes the Commit tail Sign in started.
  // Consumed once, on mount; nothing under reduced motion (Commit shows nothing there).
  const [handoff, setHandoff] = useState(() => typeof spec === 'object' && spec?.handoff === 'u1' && motion.play.uplightCommit);
  const info = useMemo<ScreenInfo>(
    () => ({ wave, mountedAt, stack, staggered, settledAt: mountedAt + duration, causticAt: mountedAt + duration }),
    [wave, mountedAt, stack, staggered, duration],
  );
  const ownScroll = useRef<ScrollView>(null);
  const scrollView = scrollRef ?? ownScroll;
  useScrollToTopOnRetap(tabBar !== undefined ? navigation : null, scrollView);
  const blurTarget = useRef<View>(null);
  const [dockHeight, setDockHeight] = useState(0);
  // Stack screens: the content scrolls under the header and fades into the ground there (the
  // HeaderScrim), so it is never cut with a hard edge. Static: no scroll events, no animation.
  const scrim = stack && scroll;

  const header = title ? (
    <View style={[styles.header, { marginBottom: headerGap - layout.listGap }]}>
      <View style={styles.headerText}>
        <Enter step="title">
          <Text variant="display">{title}</Text>
        </Enter>
        {subtitle ? (
          <Enter step="subtitle">
            <Text tone="muted">{subtitle}</Text>
          </Enter>
        ) : null}
      </View>
      {right ? <Enter step="title">{right}</Enter> : null}
    </View>
  ) : null;
  // Launch: content enters top to bottom from t=80, 40ms apart, at most five steps (§11.3); on
  // every other arrival the steps stay still and the root below moves as one. Each step
  // wrapper is a column with the screen's gap, so a fragment (QueryState's content) keeps its
  // spacing; a step that lays out empty (a closed ConfirmSheet) gives back the gap it would take.
  const list = Children.toArray(children);
  // `fill`: the steps that take the free room (the ScreenSpacers, else the last step).
  const spacers = fill ? list.filter(isScreenSpacer).length : 0;
  const grows = (child: ReactNode, i: number) => fill && (spacers > 0 ? isScreenSpacer(child) : i === list.length - 1);
  const items = list.map((child, i) => (
    <Enter
      key={isValidElement(child) && child.key != null ? child.key : i}
      step={i}
      style={grows(child, i) ? [styles.step, styles.grow] : styles.step}
      collapse={header || i > 0 ? styles.collapseTop : i < list.length - 1 ? styles.collapseBottom : undefined}
    >
      {child}
    </Enter>
  ));
  // Tab roots: the boards reserve a 44dp status band and put the title 14 below it, whatever the
  // device's own inset (Android's is 24), so the header text sits where the boards put it.
  const top = stack ? headerHeight + STACK_CONTENT_GAP : Math.max(insets.top, layout.statusBarReserve) + layout.headerTextTop - layout.statusBarReserve - insets.top;
  // With a dock, the content ends `dockClearance` above the dock's top edge (never less than the usual bottom room).
  const dockRoom = dock && dockHeight > 0 ? dockHeight + (dockPlacement === 'float' ? layout.tabBarInset + insets.bottom : 0) + dockClearance : 0;
  const pad = { paddingTop: top, paddingBottom: Math.max(space.xxl * 2 + tabBarHeight, dockRoom) };
  // Web: keyboard focus scrolls a control into view only when it is outside the scroll area, and
  // that area runs under the header scrim and the dock or tab bar. The same room the content keeps
  // becomes the area's scroll-padding, so a focused control never comes to rest under them (WCAG 2.2
  // 2.4.11). Stack screens only at the top: a tab root has nothing over its title.
  const focusRoom = WEB && scroll ? webScrollPadding(stack ? top : 0, pad.paddingBottom) : undefined;
  return (
    <ScreenContext.Provider value={info}>
      {/* The light dips only on a launch (Sign in); the ground never moves with an arrival. */}
      <Ground enter={staggered}>
        {handoff ? <HandoffTail onDone={() => setHandoff(false)} /> : null}
        <Animated.View style={[styles.fill, arrival.style]}>
          {/* By whether `dock` is passed, not whether it is set: see the prop. */}
          <ContentTarget target={dock !== undefined ? blurTarget : null}>
            <SafeAreaView edges={stack ? ['left', 'right'] : ['top', 'left', 'right']} style={styles.fill} testID={testID}>
              {scroll ? (
                <ScrollView
                  ref={scrollView}
                  style={focusRoom}
                  contentContainerStyle={[styles.content, pad, fill ? styles.grow : null]}
                  keyboardShouldPersistTaps="handled"
                  scrollIndicatorInsets={stack ? { top: headerHeight } : undefined}
                >
                  <View style={[styles.column, fill ? styles.grow : null]}>
                    {header}
                    {items}
                  </View>
                </ScrollView>
              ) : (
                <View style={[styles.content, pad, styles.fill]}>
                  <View style={[styles.column, styles.fill]}>
                    {header}
                    {items}
                  </View>
                </View>
              )}
            </SafeAreaView>
          </ContentTarget>
          {dock ? (
            <ScreenDock placement={dockPlacement} keyboard={dockKeyboard} blurTarget={blurTarget} mountedAt={mountedAt} onHeight={setDockHeight}>
              {dock}
            </ScreenDock>
          ) : null}
        </Animated.View>
        {/* Over the content root, not in it: it is ground, so it stays put while the content arrives. */}
        {scrim ? <HeaderScrim header={headerHeight} /> : null}
      </Ground>
    </ScreenContext.Provider>
  );
}

/**
 * Free room in a `fill` Screen: a direct child of Screen that grows to take the room left below
 * the content (several split it evenly), never shorter than `minHeight`. It pushes what follows it
 * to the bottom of the viewport. No screen uses it yet: Sign in relies on the default instead (the
 * last step takes the free room). Outside a `fill` Screen it is just `minHeight` of ground.
 */
export function ScreenSpacer({ minHeight = 0, testID }: { minHeight?: number; testID?: string }) {
  return <View testID={testID} style={[styles.grow, { minHeight }, PASS]} />;
}

const isScreenSpacer = (child: ReactNode) => isValidElement(child) && child.type === ScreenSpacer;

/** The title block's default gap to the content (dp): the admin boards' 20, rounded to the 22 the screens settled on. */
const HEADER_GAP = 22;
/** Where a stack screen's content starts below its header (dp). */
const STACK_CONTENT_GAP = space.sm;

/**
 * The ground behind the stack header (§10.1: no hard-edged band): a strip of the screen's own
 * ground repainted over the content from the top edge. It is opaque through the whole Back / title
 * row (down to the row's bottom edge, HEADER_ROW_BOTTOM above the header's), so nothing scrolled
 * up under the header ever shows through the controls, and it fades out only below the row: over
 * the header's 4dp bottom pad and the 8dp gap to where the content starts, so content at rest is
 * never veiled and content scrolling up dissolves into the ground instead of being cut (GroundFade).
 * Drawn once: no blur, no animation, no scroll events (Seeker). Light (flat): the background colour
 * to the header's bottom edge with a 1px hairline under it.
 */
function HeaderScrim({ header }: { header: number }) {
  const { glass, colors } = useTheme();
  if (!glass.enabled) {
    return <View {...HIDDEN} testID="header-scrim" style={[styles.scrim, styles.scrimFlat, { height: header, backgroundColor: colors.background, borderBottomColor: colors.border }, PASS]} />;
  }
  const { height, solid } = headerScrimGeometry(header);
  return (
    <View {...HIDDEN} testID="header-scrim" style={[styles.scrim, { height }, PASS]}>
      <GroundFade top={0} height={height} solid={solid} />
    </View>
  );
}

/**
 * CSS scroll-padding for a web scroll container: the insets that keyboard focus and
 * scrollIntoView keep clear. React Native's style types have no such keys, and react-native-web
 * passes unknown keys through to the DOM as they are.
 */
export function webScrollPadding(top: number, bottom: number): ViewStyle {
  return { scrollPaddingTop: top, scrollPaddingBottom: bottom } as unknown as ViewStyle;
}

/** The dark scrim for a header `header` tall: solid to the control row's bottom, faded out by the content's top (header + 8). */
function headerScrimGeometry(header: number): { height: number; solid: number } {
  return { height: header + STACK_CONTENT_GAP, solid: Math.max(0, header - HEADER_ROW_BOTTOM) };
}

/** Android blurs only what a BlurTargetView holds: with a dock, the content is the dock's target. */
function ContentTarget({ target, children }: { target: RefObject<View | null> | null; children: ReactNode }) {
  if (!target) return <>{children}</>;
  return (
    <BlurTargetView ref={target} style={styles.fill}>
      {children}
    </BlurTargetView>
  );
}

/** Whether the software keyboard is up, as the Screen's dock sees it (false outside a dock, and while it `stay`s). */
const DockKeyboardContext = createContext(false);

/**
 * Inside a Screen `dock` with `dockKeyboard` 'hide' or 'ride': whether the keyboard is up, so the
 * dock can step parts aside (Sign in drops its footer and rides on the keyboard with the primary).
 */
export function useDockKeyboard(): boolean {
  return useContext(DockKeyboardContext);
}

/** Keyboard behaviour that lifts a riding dock (Android runs edge-to-edge, so the window does not resize). */
const RIDE_BEHAVIOR = Platform.OS === 'ios' || Platform.OS === 'android' ? 'padding' : undefined;

/**
 * The dock's frame (Screen `dock`): absolute at the bottom of the content root, so it moves with
 * the arrival; it reports its height so the content can end above it. Content that mounts after
 * the screen's entrance window (a dock that waits for its data) rises in by itself.
 */
function ScreenDock({ placement, keyboard: mode, blurTarget, mountedAt, onHeight, children }: {
  placement: 'float' | 'edge';
  keyboard: 'stay' | 'hide' | 'ride';
  blurTarget: RefObject<View | null>;
  mountedAt: number;
  onHeight: (h: number) => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const { motion } = useTheme();
  const keyboard = useKeyboardShown(mode !== 'stay');
  const [late] = useState(() => Date.now() - mountedAt > ENTRANCE_WINDOW);
  const away = useSharedValue(0);
  useEffect(() => {
    if (mode === 'hide') away.value = withTiming(keyboard ? 1 : 0, motion.timing.tick);
  }, [mode, keyboard, away, motion]);
  const awayStyle = useAnimatedStyle(() => ({ opacity: 1 - away.value }));
  const float = placement === 'float';
  const hidden = mode === 'hide' && keyboard;
  const frameInset = float
    ? { marginLeft: layout.tabBarInset + insets.left, marginRight: layout.tabBarInset + insets.right, marginBottom: layout.tabBarInset + (mode === 'ride' && keyboard ? 0 : insets.bottom) }
    : null;
  const body = float ? <View style={[styles.dockColumn, styles.boxNone]}>{children}</View> : children;
  const frame = (
    <Animated.View
      testID="screen-dock"
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      style={[frameInset, hidden ? PASS : styles.boxNone, mode === 'hide' ? awayStyle : null]}
    >
      {late ? (
        <Enter step={0} delay={0}>
          {body}
        </Enter>
      ) : (
        body
      )}
    </Animated.View>
  );
  return (
    <BlurTargetContext.Provider value={blurTarget}>
      <DockKeyboardContext.Provider value={keyboard}>
        {mode === 'ride' ? (
          <KeyboardAvoidingView behavior={RIDE_BEHAVIOR} style={[styles.dockHost, styles.boxNone]}>
            {frame}
          </KeyboardAvoidingView>
        ) : (
          <View style={[styles.dockHost, styles.boxNone]}>{frame}</View>
        )}
      </DockKeyboardContext.Provider>
    </BlurTargetContext.Provider>
  );
}

/** The navigation events a tab root listens to (the role tab bar emits `tabPress`, C3). */
type TabPressNavigation = { isFocused: () => boolean; addListener: (event: 'tabPress', cb: (e: { defaultPrevented?: boolean }) => void) => () => void };

/**
 * C3: pressing the current tab again never navigates; its screen scrolls to the top. (The boards
 * also refetch there; that stays each screen's own decision.)
 */
function useScrollToTopOnRetap(navigation: unknown, scroll: RefObject<ScrollView | null>) {
  useEffect(() => {
    const nav = navigation as Partial<TabPressNavigation> | null;
    if (!nav?.addListener || !nav.isFocused) return;
    const isFocused = nav.isFocused.bind(nav);
    return nav.addListener('tabPress', (e) => {
      const focused = isFocused();
      requestAnimationFrame(() => {
        if (focused && !e.defaultPrevented) scroll.current?.scrollTo({ y: 0, animated: true });
      });
    });
  }, [navigation, scroll]);
}

/** The tail and its last mote are done by then (700ms fall; motes from +160, 40 apart, 700 each). */
const TAIL_MS = 2 * DUR.settle;

/**
 * U1's tail on the first tab (§M3, CONSISTENCY U): a Mode B floor at the screen's bottom edge, x
 * 50%, from u = 1 down to 0 over 700ms ease-lens with the motes, then it unmounts.
 */
function HandoffTail({ onDone }: { onDone: () => void }) {
  const light = useUplight('tail', true);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const t = setTimeout(() => done.current(), TAIL_MS);
    return () => clearTimeout(t);
  }, []);
  return <CommitUplight light={light} x={0.5} />;
}

export function Field({ label, value, onChangeText, error, hint, secure, multiline, rows, keyboardType, testID, placeholder, autoCapitalize, invalid = false, numeral = false, locked = false, lockDelay = 0, returnKeyType, onSubmitEditing, ref }: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  error?: string | null;
  hint?: string;
  secure?: boolean;
  multiline?: boolean;
  /**
   * A multiline well sized for this many 22dp lines of the 15/22 body: 13 + 22 × rows + 13 inside
   * the 1dp rim (A-NewStudy's consent, rows 5: 138). Never below the default 3-row well (96).
   * Multiline only; without it the well is unchanged.
   */
  rows?: number;
  keyboardType?: 'default' | 'email-address' | 'number-pad';
  testID?: string;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words';
  /** The error rim and the danger label without a message (the screen names the problem elsewhere, A-NewStudy's "To save" hint). */
  invalid?: boolean;
  /** A field that takes a number: the value in Red Hat Display 300 28/32 tabular (A-NewStudy Reward, Slots). */
  numeral?: boolean;
  /**
   * The Lock (U4, §11.5): the well sinks into the pressed look, 120ms ease-press after `lockDelay`
   * (1dp down-right, not under reduced motion, and the pressed shade over it), and the field takes
   * no more text (its value is already final).
   */
  locked?: boolean;
  lockDelay?: number;
  /** The keyboard's return key: its label and what it does (Sign in submits from the password field). */
  returnKeyType?: 'done' | 'go' | 'next' | 'send';
  onSubmitEditing?: () => void;
  /** The TextInput, so a screen can move focus to the field (React 19 ref prop). */
  ref?: Ref<TextInput>;
}) {
  const { colors, glass, type, motion } = useTheme();
  const lock = useSharedValue(0);
  useEffect(() => {
    lock.value = locked ? withDelay(lockDelay, withTiming(1, motion.timing.pressIn)) : 0;
  }, [locked, lockDelay, lock, motion]);
  const sink = useAnimatedStyle(() => ({ transform: [{ translateX: motion.reduced ? 0 : lock.value }, { translateY: motion.reduced ? 0 : lock.value }] }));
  const shade = useAnimatedStyle(() => ({ opacity: lock.value }));
  const [focused, setFocused] = useState(false);
  // The focus well mounts on the first focus and stays for the fade-outs.
  const [focusArmed, setFocusArmed] = useState(false);
  const focus = useSharedValue(0);
  useEffect(() => {
    focus.value = withTiming(focused ? 1 : 0, motion.timing.tick);
  }, [focused, focus, motion]);
  const focusStyle = useAnimatedStyle(() => ({ opacity: focus.value }));
  // Dark: the focus glow fades in over the rest/error well (dur-tick); an errored field keeps its
  // error fill and rim under the glow while it is being fixed. Light wells are flat and switch rim
  // colour, with the pre-Lens 1.5dp outline so the edge keeps 3:1 at a readable width.
  const bad = !!error || invalid;
  const state = bad ? 'error' : !glass.enabled && focused ? 'focus' : 'rest';
  const flatEdge = glass.enabled ? null : styles.flatEdge;
  const wellHeight = multiline && rows ? { minHeight: multilineWellHeight(rows) } : null;
  return (
    <View style={styles.field}>
      <Text variant="label" tone={bad ? 'danger' : 'muted'}>{label.toUpperCase()}</Text>
      <Animated.View style={[multiline ? styles.inputBoxMultiline : styles.inputBox, wellHeight, locked ? sink : null]}>
        <Well state={state} style={[styles.layer, PASS, flatEdge]} />
        {glass.enabled && focusArmed ? (
          <Animated.View style={[styles.layer, PASS, focusStyle]}>
            <Well state={bad ? 'focusError' : 'focus'} style={styles.layer} />
          </Animated.View>
        ) : null}
        <TextInput
          ref={ref}
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => {
            setFocused(true);
            setFocusArmed(true);
          }}
          onBlur={() => setFocused(false)}
          // A locked field (U4: submitted notes) takes no more text: nothing typed is silently dropped.
          editable={!locked}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          secureTextEntry={secure}
          multiline={multiline}
          keyboardType={keyboardType}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          autoCapitalize={autoCapitalize ?? (secure || keyboardType === 'email-address' ? 'none' : 'sentences')}
          accessibilityLabel={label}
          // The well's focus glow is the focus ring, so web drops the browser's rectangular outline.
          style={[styles.input, numeral ? [type.inputNumeral, styles.inputNumeral] : type.body, { color: colors.text }, multiline && styles.inputMultiline, wellHeight, Platform.OS === 'web' ? styles.noOutline : null]}
        />
        {glass.lockShade && locked ? <Animated.View {...HIDDEN} style={[styles.layer, styles.lockShade, { backgroundColor: glass.lockShade }, PASS, shade]} /> : null}
      </Animated.View>
      {/* The hint takes the error colour while the field is bad (A-NewStudy: the helper under a rose-rimmed well). */}
      {error ? <Text variant="disclaimer" tone="danger" testID={testID ? `${testID}-error` : undefined}>{error}</Text> : hint ? <Text variant="disclaimer" tone={bad ? 'danger' : 'muted'}>{hint}</Text> : null}
    </View>
  );
}

/** The input's vertical padding and line height (styles.input, type.body 15/22) and the well's 1dp rim. */
const INPUT_PAD_Y = 13;
const INPUT_LINE = 22;
const WELL_RIM = 1;

/** A multiline well that shows `rows` lines (Field `rows`): 2 × 13 + 22 × rows + 2, never below the 3-row default. */
function multilineWellHeight(rows: number): number {
  return Math.max(touch.inputMultiline, 2 * INPUT_PAD_Y + INPUT_LINE * Math.max(1, Math.round(rows)) + 2 * WELL_RIM);
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Section({ title, children, right, testID }: { title: string; children: ReactNode; right?: ReactNode; testID?: string }) {
  // The one section header (patterns/SectionHeader), then the section's content.
  return (
    <View style={styles.section} testID={testID}>
      <SectionHeader title={title} right={right} />
      {children}
    </View>
  );
}

/**
 * The empty state is the one EmptyPanel (A-States 02, §8, §9): an L1 card at k = 0.8 with the 72dp
 * fluted lens and the state's glyph, the text beside it, the action under them.
 */
export function EmptyState({ icon, title, body, action, actionStretch, testID }: {
  icon: KitIcon;
  title: string;
  body: string;
  action?: ReactNode;
  /** The action fills the card's width (A-Work "Find studies"). */
  actionStretch?: boolean;
  testID?: string;
}) {
  return <EmptyPanel icon={icon} title={title} body={body} action={action} actionStretch={actionStretch} variant="card" testID={testID ?? 'empty-state'} />;
}

/**
 * Loading is the one LensShimmer (CONSISTENCY C7, §11.6): the 18dp spinner row with the label,
 * `aria-busy`. No skeleton cards and no placeholder bars, ever. `brand` (the root "Starting Pocket
 * QA…" alone) adds the 72dp fluted lens above the row, resolving once (S1); the lens is never twice
 * on a screen (§9).
 */
export function LoadingState({ label = 'Loading…', brand = false }: { label?: string; brand?: boolean }) {
  return <LensShimmer label={label} lens={brand} />;
}

/**
 * A failed load is the one ErrorPanel (A-States 04: "no lens for a failure"): the 54dp glyph tile
 * whose rim carries the kind (offline info, not allowed neutral, not found and other failures
 * warning), the title, the server's message, and Retry only where it can help.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  const offline = e?.code === 'OFFLINE';
  const notFound = e?.code === 'NOT_FOUND';
  if (e?.code === 'FORBIDDEN_ROLE') {
    // Unauthorized: retrying can't help, so no Retry button.
    return <ErrorPanel testID="forbidden-state" glyph="lock" tint="neutral" title="Not allowed" body={e.message} />;
  }
  return (
    <ErrorPanel
      testID={offline ? 'offline-state' : notFound ? 'not-found-state' : 'error-state'}
      glyph={offline ? 'offline' : 'warning'}
      tint={offline ? 'info' : 'warning'}
      title={offline ? 'You’re offline' : notFound ? 'Not found' : 'Something went wrong'}
      body={offline ? 'Can’t reach the local Pocket QA server. Check that the API is running, then retry.' : notFound ? 'This item doesn’t exist or you don’t have access to it.' : (e?.message ?? 'Please try again.')}
      onRetry={onRetry && !notFound ? onRetry : undefined}
      retryTestID="retry-button"
    />
  );
}

/** Renders loading / error / offline / empty states around a react-query result. */
export function QueryState<T>({ query, empty, children }: {
  query: { isLoading: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
  empty?: (data: T) => ReactNode | null;
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data === undefined) return <LoadingState />;
  const e = empty?.(query.data);
  return <>{e ?? children(query.data)}</>;
}

export function Segmented<T extends string>({ options, value, onChange, testID, labelVariant = 'segment' }: {
  /** `glyph`: a lit/muted pair beside the label that crossfades in 120ms with the selection (A-SignIn roles). */
  options: { value: T; label: string; glyph?: GlyphName }[];
  value: T;
  onChange: (v: T) => void;
  testID?: string;
  /** `numeral`: segments that choose an amount, Red Hat Display 500 18/22 tabular (A-Budget top-up). */
  labelVariant?: 'segment' | 'numeral';
}) {
  const { colors, glass } = useTheme();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  // Segments sit on a 4dp grid gap (the board's seg); the tile is exactly one cell wide. The board's
  // track is 52 (4 + a 44 tile + 4): each cell is the 48dp touch target, 2 in from the track's
  // top and bottom, and the tile is drawn 44 tall inside it, so the hit area never shrinks.
  const n = options.length;
  const tile = n ? (width - SEGMENT_GAP * (n - 1)) / n : 0;
  const step = tile + SEGMENT_GAP;
  // The selected tile is one L2 violet sheet that slides between segments (spring-tab, §11.4).
  const tileStyle = useTabTile(index, step);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth((prev) => (prev === w ? prev : w));
  };
  const selected = options.some((o) => o.value === value);
  return (
    <Well radius={radius.segmentTrack} accessibilityRole="radiogroup" testID={testID} style={[styles.track, glass.enabled ? null : styles.flatEdge]}>
      <View style={styles.segments} onLayout={onLayout}>
        {selected && tile > 0 ? (
          <Animated.View style={[styles.segmentTile, { width: tile }, tileStyle]}>
            <GlassSurface recipe={glass.violetTile} radius={radius.segment} grain={false} style={styles.layer} />
            {glass.enabled ? <SegmentRing width={tile} /> : null}
          </Animated.View>
        ) : null}
        {options.map((o) => {
          const on = o.value === value;
          return (
            <FocusPressable
              key={o.value}
              ringRadius={radius.segment}
              testID={testID ? `${testID}-${o.value}` : undefined}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              // react-native-web maps no accessibilityState: the radio's state reaches the DOM as aria-checked.
              {...(WEB ? { 'aria-checked': on } : null)}
              style={[styles.segment, o.glyph ? styles.segmentWithGlyph : null]}
            >
              {o.glyph ? <TabGlyph name={o.glyph} focused={on} size={SEGMENT_GLYPH} /> : null}
              <Text variant={labelVariant === 'numeral' ? 'segmentNumeral' : 'segment'} style={{ color: on ? colors.text : colors.textMuted }}>{o.label}</Text>
            </FocusPressable>
          );
        })}
      </View>
    </Well>
  );
}

/**
 * The selected segment's second sheet (the boards' inner ring): a 1px hairline 3 inside the tile's
 * padding box, radius 11, lit at its top-left (glass.stackRing). Static: it rides the tile's slide.
 */
function SegmentRing({ width }: { width: number }) {
  const { glass } = useTheme();
  const id = useSvgId('seg-ring');
  const o = 1 + glass.stackRing.inset;
  const box = { x: o, y: o, w: width - 2 * o, h: SEGMENT_TILE - 2 * o };
  if (box.w <= 2) return null;
  const r = radius.segment - glass.stackRing.inset;
  return (
    <View {...HIDDEN} style={[styles.layer, PASS]}>
      <Svg width={width} height={SEGMENT_TILE}>
        <Defs>
          <GradientDef id={id} spec={glass.stackRing.rim} box={box} />
        </Defs>
        <Rect x={box.x + 0.5} y={box.y + 0.5} width={box.w - 1} height={box.h - 1} rx={r - 0.5} ry={r - 0.5} fill="none" stroke={`url(#${id})`} strokeWidth={1} />
      </Svg>
    </View>
  );
}

export function Checkbox({ checked, onChange, label, testID, invalid = false, labelVariant = 'body' }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  testID?: string;
  /** The error well (a required choice is missing, A-NewStudy's platforms). */
  invalid?: boolean;
  /** `chip`: the label of a raised choice chip, Instrument Sans 600 15/20 (A-NewStudy device criteria). */
  labelVariant?: 'body' | 'chip';
}) {
  const { colors, glass } = useTheme();
  const { onStyle } = useCrossfade(checked);
  // §8: a 26dp well; checked fades in the primary-glass square with the on-primary check (120ms).
  return (
    // Web: aria-checked as well (react-native-web maps no accessibilityState).
    <FocusPressable ringRadius={radius.segment} testID={testID} onPress={() => onChange(!checked)} accessibilityRole="checkbox" accessibilityState={{ checked }} {...(WEB ? { 'aria-checked': checked } : null)} style={styles.checkbox}>
      <View style={styles.box}>
        <Well radius={radius.checkbox} state={invalid && !checked ? 'error' : 'rest'} style={[styles.layer, glass.enabled ? null : styles.flatEdge]} />
        <Animated.View style={[styles.layer, PASS, onStyle]}>
          <GlassSurface recipe={glass.primary} radius={radius.checkbox} grain={false} style={styles.layer} />
          <Svg width={touch.checkbox} height={touch.checkbox} style={StyleSheet.absoluteFill}>
            {/* The board's check: the approve path at 0.5 scale, stroke 2, centred in the 26dp box. */}
            <Path d="M8.75 13.25L11.5 16L17.25 10" stroke={colors.onPrimary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        </Animated.View>
      </View>
      <Text variant={labelVariant === 'chip' ? 'headingNotice' : 'bodySm'} style={{ flex: 1 }}>{label}</Text>
    </FocusPressable>
  );
}

/** Commit sheets (§10.2 U7): a builder commits budget or credit. Admin, destructive and other sheets stay unlit. */
function isCommitSheet(title: string, confirmLabel: string, destructive: boolean | undefined): boolean {
  return !destructive && (confirmLabel === 'Publish' || title.startsWith('Approve and credit'));
}

// C4's sheet: padding 10 20 48 with 24 of it the overscan below the screen edge (less the 1dp
// glass border), grabber at the very top.
const SHEET_PAD = { top: 9, x: 19, bottom: 23 };
const KEYBOARD_BEHAVIOR = Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined;

/** Whether the software keyboard is up while `active` (JS events, not per frame; never on web). */
export function useKeyboardShown(active = true): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active || Platform.OS === 'web') return;
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setShown(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setShown(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [active]);
  return active && shown;
}

type SheetTile = { glyph: GlyphName; tint?: GlassTone; generic?: boolean };

/**
 * The header tile per sheet (C4's table): the tile's glyph and rim. The confirm carries the same
 * glyph (A-Review Approve / Reject, A-BStudy Publish, A-Moderation Suspend). A sheet outside the
 * table gets a generic tile and a text-only confirm (`generic`). Screens may pass their own.
 */
function sheetTile(title: string, confirmLabel: string, destructive: boolean): SheetTile {
  switch (confirmLabel) {
    case 'Publish':
      return { glyph: 'publish' };
    case 'Approve':
      return /stuck/i.test(title) ? { glyph: 'stuck', tint: 'success' } : { glyph: 'approve', tint: 'success' };
    case 'Reject':
      return { glyph: 'reject', tint: 'danger' };
    case 'Close study':
      return { glyph: 'ban', tint: 'danger' };
    case 'Pause':
      return { glyph: 'pause' };
    case 'Resume':
      return { glyph: 'play' };
    case 'Withdraw':
    case 'Delete forever':
      return { glyph: 'remove', tint: 'danger' };
    case 'Resolve':
    case 'Send dispute':
      return { glyph: 'disputes' };
    case 'Suspend':
      return { glyph: 'moderation', tint: 'danger' };
    case 'Reinstate':
      return { glyph: 'consent', tint: 'success' };
    case 'Submit':
      return { glyph: 'send' };
    default:
      return destructive ? { glyph: 'alert', tint: 'danger', generic: true } : { glyph: 'info', generic: true };
  }
}

/**
 * A request can hang (the API client sets no timeout), and a sheet never closes mid-request (C4).
 * After this long pending, Cancel, Escape, back and the backdrop work again, so the user is never
 * trapped in the Modal; the confirm keeps its spinner until the request settles.
 */
export const SHEET_PENDING_ESCAPE_MS = 15000;

function usePendingEscape(pending: boolean): boolean {
  const [escaped, setEscaped] = useState(false);
  if (!pending && escaped) setEscaped(false);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setEscaped(true), SHEET_PENDING_ESCAPE_MS);
    return () => clearTimeout(t);
  }, [pending]);
  return pending && escaped;
}

/**
 * In-app confirmation (native alerts don't exist on web, and block automation), built as C4: the
 * grabber, a header row with the 54dp glyph tile beside the title, the body, the fields, the
 * failure notice, and the one action row (SheetActions: Cancel left, the confirm right).
 *
 * Pending (`loading`, or `status` 'pending'): both actions are disabled and announced busy, the
 * confirm shows the spinner, and nothing closes the sheet (SHEET_PENDING_ESCAPE_MS is the escape).
 *
 * U7 commit light (useCommitUplight, the one state machine): Publish and "Approve and credit …"
 * sheets, or `moment="commit"` (`moment="none"` opts out; destructive sheets are never lit), show
 * the pilot floor under the confirm while open. It holds while the request is pending and is cut
 * on a failure. The Commit pass plays only when the screen reports `status` 'success' (from the
 * mutation's onSuccess, never on press) and keeps the sheet open until `onLeave`. The tail is not
 * handed to a screen floor: it belongs to the subject's uplit layer (the Budget card, the
 * Decision notice), which the screen phase wires. A screen that passes no `status` closes the
 * sheet on success itself and the light simply goes out with it.
 */
export function ConfirmSheet({ visible, title, body, confirmLabel, destructive = false, onConfirm, onCancel, children, confirmDisabled, loading, moment, status, error, onLeave, glyph, tint, tile: tileNode, confirmIcon, failureTitle, errorTestID }: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
  confirmDisabled?: boolean;
  loading?: boolean;
  moment?: 'commit' | 'none';
  /** The mutation's state (isPending / isError / isSuccess); drives the U7 light and the failure branch. */
  status?: CommitStatus;
  /** The server's brief error, shown as the C4 failure notice while `status` is 'error'. */
  error?: string | null;
  /** Commit sheets: called 680ms after the Commit pass starts, when the sheet should close. */
  onLeave?: () => void;
  /** The header tile's glyph and rim (default: C4's table, by the confirm). */
  glyph?: GlyphName;
  tint?: GlassTone;
  /** A header tile of the screen's own in place of the glyph tile (A-Disputes' weighing BalanceTile, S6). */
  tile?: ReactNode;
  /**
   * The confirm's glyph (C4: pending swaps it for the spinner; disabled keeps it, muted). Default:
   * the header tile's glyph for the sheets in C4's table, or `glyph`; none for any other sheet.
   * `null` keeps the confirm text-only.
   */
  confirmIcon?: KitIcon | null;
  /** The failure notice's title (default "Action failed"; e.g. "Couldn’t send"). */
  failureTitle?: string;
  /** testID on the failure notice, for screens whose error already has one. */
  errorTestID?: string;
}) {
  const { glass, motion } = useTheme();
  const insets = useSafeAreaInsets();
  const keyLight = useKeyLight();
  const titleId = useSvgId('sheet-title');
  // Web unmounts the moment it closes: react-native-web's Modal can stay mounted and visible over
  // the page after a closing animation (found by e2e/admin-dispute.spec.ts). Native plays the
  // 240ms exit; a Modal is its own window (an Android Dialog, an iOS presented controller), so
  // touches on the screen below stay blocked until it unmounts, and back is ignored meanwhile.
  const sheet = useSheetMotion({ visible, animateExit: !WEB });
  const pending = !!loading || status === 'pending';
  const escaped = usePendingEscape(visible && pending);
  const commit = !destructive && (moment ? moment === 'commit' : isCommitSheet(title, confirmLabel, destructive));
  // U7: after success the Commit pass plays in the open sheet until `onLeave`; both actions are
  // locked meanwhile, without the spinner (C4: a sheet never closes or re-fires mid-pass). Only a
  // caller that passes `onLeave` gets the lock: without it nothing would ever release the sheet.
  const passing = visible && commit && status === 'success' && glass.enabled && motion.play.uplightCommit && !!onLeave;
  const busy = (pending && !escaped) || passing;
  // C4: focus moves to the title; Escape, back, the backdrop and Cancel close, never while busy.
  const sheetFocus = useSheetFocus({ visible, busy, closing: sheet.closing, onClose: onCancel });
  const keyboard = useKeyboardShown(sheet.mounted);
  const light = useCommitUplight({ open: visible && commit, status: status ?? (pending ? 'pending' : 'idle'), onLeave });
  const tile: SheetTile = glyph ? { glyph, tint } : sheetTile(title, confirmLabel, destructive);
  const confirmGlyph = confirmIcon === undefined ? (tile.generic ? undefined : tile.glyph) : (confirmIcon ?? undefined);
  // The floor sits at the confirm's centre (Cancel left, confirm right: about 3/4 across). Its clip
  // box is the panel inside the 1dp glass border; the action row starts at the sheet padding.
  const [panelWidth, setPanelWidth] = useState(0);
  const [confirmCenter, setConfirmCenter] = useState<number | null>(null);
  const inner = panelWidth - 2;
  const floorX = inner > 0 && confirmCenter !== null ? (SHEET_PAD.x + confirmCenter) / inner : 0.75;

  // Behind any sheet the screen's key pool drops to 0.4 with the backdrop (§2, §11.4). Only an
  // open/close edge writes it, so a closed sheet mounting never resets one that is open.
  const shown = useRef(false);
  useEffect(() => {
    if (!keyLight || shown.current === visible) return;
    shown.current = visible;
    keyLight.sheet.value = withTiming(visible ? 1 : 0, visible ? motion.timing.enter : motion.timing.sheetClose);
  }, [visible, keyLight, motion]);
  useEffect(
    () => () => {
      if (keyLight && shown.current) keyLight.sheet.value = 0;
    },
    [keyLight],
  );

  if (!sheet.mounted) return null;
  const through = sheet.closing ? PASS : null;
  // Web: react-native-web's Modal is the role="dialog" element and passes these props to it, so the
  // title names the dialog (C4 aria-labelledby). Native announces the focused title instead.
  const dialogName = WEB ? ({ 'aria-labelledby': titleId } as object) : null;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={sheetFocus.requestClose} {...dialogName}>
      {/* The keyboard lifts the docked sheet so the focused field and the actions stay visible. */}
      <KeyboardAvoidingView behavior={KEYBOARD_BEHAVIOR} style={[styles.fill, styles.dockEnd]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: glass.sheet.backdrop }, sheet.backdropStyle, through]}>
          {/*
           * Tapping the backdrop closes (C4). It is not an accessibility element and not a tab stop
           * (react-native-web gives every enabled Pressable tabIndex 0): Cancel is the labelled close.
           */}
          <Pressable testID="confirm-backdrop" onPress={sheetFocus.requestClose} accessible={false} focusable={false} tabIndex={-1} importantForAccessibility="no" aria-hidden style={StyleSheet.absoluteFill} />
        </Animated.View>
        <Animated.View style={[styles.sheetDock, sheet.sheetStyle, sheet.closing ? PASS : styles.boxNone]} onLayout={sheet.onSheetLayout}>
          <GlassBlur
            radius={radius.sheet}
            corners="top"
            // A Modal is its own window: Android cannot blur the screen behind it, so it takes the solid fallback.
            blur={Platform.OS !== 'android'}
            style={[styles.sheet, { paddingBottom: SHEET_PAD.bottom + (keyboard ? 0 : insets.bottom) }]}
            testID="confirm-sheet"
            accessibilityViewIsModal
            onLayout={(e) => {
              const w = e.nativeEvent.layout.width;
              setPanelWidth((prev) => (prev === w ? prev : w));
            }}
          >
            {/* U7 Mode B: the 300dp floor anchored to the sheet's bottom edge, clipped to its corners. */}
            {commit ? (
              <View {...HIDDEN} style={[styles.floorClip, PASS]}>
                <CommitUplight light={light} x={floorX} />
              </View>
            ) : null}
            <View style={[styles.grabber, { backgroundColor: glass.sheet.grabber }]} />
            <View style={styles.sheetHeader}>
              {tileNode ?? <GlassTile name={tile.glyph} size="hero" tint={tile.tint} variant={destructive ? 'rose' : undefined} />}
              {/*
               * The focus target (C4). Native groups the title into one heading; web keeps the inner
               * heading. On web it is a programmatic target only (the board's h2 tabindex -1, outline
               * none): out of the tab order, outside C1's ring selector, and no UA outline.
               */}
              <View ref={sheetFocus.titleRef} nativeID={titleId} accessible accessibilityRole={WEB ? undefined : 'header'} {...(WEB ? { tabIndex: -1 as const } : null)} style={[styles.sheetTitle, WEB ? styles.titleFocus : null]}>
                <Text variant="title">{title}</Text>
              </View>
            </View>
            {body ? <Text tone="muted" pretty style={styles.sheetBody}>{body}</Text> : null}
            {children ? <View style={styles.sheetChildren}>{children}</View> : null}
            {status === 'error' && error ? <SheetFailure message={error} title={failureTitle} testID={errorTestID} /> : null}
            <View style={styles.sheetActions}>
              <SheetActions
              confirmLabel={confirmLabel}
              confirmIcon={confirmGlyph}
              onConfirm={onConfirm}
              onCancel={sheetFocus.requestClose}
              destructive={destructive}
              pending={pending}
              locked={passing}
              cancelDisabled={busy}
              confirmDisabled={confirmDisabled}
              light={commit ? light : undefined}
              onConfirmCenter={(x) => setConfirmCenter((prev) => (prev === x ? prev : x))}
              />
            </View>
          </GlassBlur>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Divider() {
  const { glass } = useTheme();
  // The one fading rule (GradientRule), in flow; it fades out toward the far side, away from the light (§8 list row).
  return <GradientRule stops={glass.divider.stops} style={styles.divider} />;
}

const SEGMENT_GAP = 4;
/** The selected tile's height (the board's 44) and how far the 48dp cell reaches past it, top and bottom. */
const SEGMENT_TILE = 44;
const SEGMENT_HIT_INSET = (touch.segment - SEGMENT_TILE) / 2;
/** A segment's glyph (G4: 20 leading a label). */
const SEGMENT_GLYPH = 20;

const styles = StyleSheet.create({
  fill: { flex: 1 },
  // Screen `fill`: the scroll content, the column and the step that takes the free room.
  grow: { flexGrow: 1 },
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  touch: { minHeight: TOUCH },
  boxNone: { pointerEvents: 'box-none' },
  content: { paddingHorizontal: layout.gutter },
  column: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: layout.listGap },
  step: { gap: layout.listGap },
  collapseTop: { marginTop: -layout.listGap },
  collapseBottom: { marginBottom: -layout.listGap },
  // Its marginBottom is set by Screen (`headerGap` less the column's gap).
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: layout.headerGutter - layout.gutter },
  headerText: { flex: 1, gap: 6 },
  field: { gap: 6 },
  inputBox: { minHeight: touch.input },
  inputBoxMultiline: { minHeight: touch.inputMultiline },
  // Positioned, so it paints above the absolutely positioned well layers before it on web
  // (react-native-web gives every View `position: relative` but a TextInput none, and positioned
  // siblings paint over unpositioned content). The Lock shade after it still covers it. No zIndex:
  // that would lift the input over the Lock shade too.
  input: { position: 'relative', minHeight: touch.input, paddingHorizontal: 16, paddingVertical: INPUT_PAD_Y, backgroundColor: 'transparent' },
  inputMultiline: { minHeight: touch.inputMultiline, textAlignVertical: 'top' },
  inputNumeral: { paddingVertical: 9 },
  // The Lock's pressed shade over the well (§11.5): the well's floor, darker (glass.lockShade).
  lockShade: { borderRadius: radius.input },
  dockHost: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  scrim: { position: 'absolute', top: 0, left: 0, right: 0, overflow: 'hidden' },
  scrimFlat: { borderBottomWidth: 1 },
  dockColumn: { width: '100%', maxWidth: 744, alignSelf: 'center' },
  flatEdge: { borderWidth: 1.5 },
  noOutline: { outlineWidth: 0 },
  // The sheet title is a programmatic focus target only (C4: the h2 tabindex -1, outline none): no
  // outline, no ring, nothing painted behind it when it takes focus.
  titleFocus: { outlineWidth: 0, outlineStyle: 'none', backgroundColor: 'transparent' } as unknown as ViewStyle,
  section: { gap: space.sm, marginTop: space.lg },
  // 52 tall: 2 + the 48dp cells + 2, with the 44 tile 4 from the track's edges (the board's 4 + 44 + 4).
  track: { paddingHorizontal: 4, paddingVertical: SEGMENT_HIT_INSET },
  segments: { flexDirection: 'row', gap: SEGMENT_GAP },
  segmentTile: { position: 'absolute', top: SEGMENT_HIT_INSET, height: SEGMENT_TILE, left: 0 },
  segment: { flex: 1, minHeight: touch.segment, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  segmentWithGlyph: { flexDirection: 'row', gap: 8 },
  checkbox: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH },
  box: { width: touch.checkbox, height: touch.checkbox },
  dockEnd: { justifyContent: 'flex-end' },
  sheetDock: { width: '100%', alignItems: 'center' },
  sheet: { width: '100%', maxWidth: 560, paddingTop: SHEET_PAD.top, paddingHorizontal: SHEET_PAD.x },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2 },
  // C4: a header row (the 54dp tile, 14, the title) 18 below the grabber; the body 12 under it.
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18 },
  sheetTitle: { flex: 1, minWidth: 0 },
  sheetBody: { marginTop: 12 },
  sheetChildren: { marginTop: space.md, gap: space.md },
  sheetActions: { marginTop: 24 },
  // The board's floor wrapper: inset 0 inside the rim, the sheet's top corners, overflow hidden.
  floorClip: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderTopLeftRadius: radius.sheet - 1, borderTopRightRadius: radius.sheet - 1, overflow: 'hidden' },
  divider: { height: 1, marginVertical: space.sm },
});
