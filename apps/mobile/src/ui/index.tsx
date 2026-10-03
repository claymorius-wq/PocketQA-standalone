import { HeaderHeightContext, NavigationContext, NavigationRouteContext } from 'expo-router/react-navigation';
import { BottomTabBarHeightContext } from 'expo-router/tabs';
import { Children, isValidElement, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { ApiError } from '../api/client';
import { GlassBlur, GlassSurface, Ground, useKeyLight, useUplight, Well } from '../glass';
import { GradientRule, HIDDEN, useSvgId } from '../glass/paint';
import { GlassTile, type GlyphName } from '../icons';
import { useCrossfade, useSheetMotion, useTabTile } from '../motion';
import { useArrival, type InitialArrival } from '../motion/entrance';
import { useSheetFocus } from '../motion/sheet';
import { DUR } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { layout, radius, space, touch, TOUCH, type Tone as GlassTone } from '../theme/tokens';
import { FocusPressable } from './focus';
import { type KitIcon } from './icon';
import { CommitUplight, useCommitUplight, type CommitStatus } from './patterns/light';
import { SheetActions, SheetFailure } from './patterns/DecisionBar';
import { EmptyPanel, ErrorPanel } from './patterns/EmptyPanel';
import { LensShimmer } from './patterns/LensShimmer';
import { SectionHeader } from './patterns/SectionHeader';
import { ArrivalContext, arrivalOf, Enter, ScreenContext, type ScreenInfo } from './screen';
import { Text } from './text';

// The shared UI kit in the Lens visual system (docs/decisions/0005-lens-visual-system.md;
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
export { ArrivalContext, type ArrivalSpec } from './screen';
export { Text } from './text';
export { Button } from './button';
export { Card } from './card';
export { Notice, StatusPill } from './status';
export { Spinner } from './spinner';

const PASS: ViewStyle = { pointerEvents: 'none' };
const WEB = Platform.OS === 'web';

export function Screen({ children, title, subtitle, scroll = true, testID, right, entrance }: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  scroll?: boolean;
  testID?: string;
  right?: ReactNode;
  /**
   * How this screen opens (§11.3, CONSISTENCY §M3). Default: the layout's ArrivalContext, else
   * `tab` inside the role tabs and `push` anywhere else. `launch` (the light dip and the
   * staggered steps) belongs to Sign in alone. Returns to the screen play `back` or `tab` by themselves.
   */
  entrance?: InitialArrival;
}) {
  // A stack screen draws under the transparent Lens header (app/_layout.tsx), so the content starts
  // below it; tab screens sit above the floating tab bar, which reports its height.
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

  const header = title ? (
    <View style={styles.header}>
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
  const items = list.map((child, i) => (
    <Enter
      key={isValidElement(child) && child.key != null ? child.key : i}
      step={i}
      style={styles.step}
      collapse={header || i > 0 ? styles.collapseTop : i < list.length - 1 ? styles.collapseBottom : undefined}
    >
      {child}
    </Enter>
  ));
  // Tab roots: the boards reserve a 44dp status band and put the title 14 below it, whatever the
  // device's own inset (Android's is 24), so the header text sits where the boards put it.
  const top = stack ? space.sm : Math.max(insets.top, layout.statusBarReserve) + layout.headerTextTop - layout.statusBarReserve - insets.top;
  const pad = { paddingTop: top, paddingBottom: space.xxl * 2 + tabBarHeight };
  return (
    <ScreenContext.Provider value={info}>
      {/* The light dips only on a launch (Sign in); the ground never moves with an arrival. */}
      <Ground enter={staggered}>
        {handoff ? <HandoffTail onDone={() => setHandoff(false)} /> : null}
        <Animated.View style={[styles.fill, arrival.style]}>
          <SafeAreaView edges={stack ? ['left', 'right'] : ['top', 'left', 'right']} style={[styles.fill, stack ? { paddingTop: headerHeight } : null]} testID={testID}>
            {scroll ? (
              <ScrollView contentContainerStyle={[styles.content, pad]} keyboardShouldPersistTaps="handled">
                <View style={styles.column}>
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
        </Animated.View>
      </Ground>
    </ScreenContext.Provider>
  );
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

export function Field({ label, value, onChangeText, error, hint, secure, multiline, keyboardType, testID, placeholder, autoCapitalize }: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  error?: string | null;
  hint?: string;
  secure?: boolean;
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'number-pad';
  testID?: string;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words';
}) {
  const { colors, glass, type, motion } = useTheme();
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
  const state = error ? 'error' : !glass.enabled && focused ? 'focus' : 'rest';
  const flatEdge = glass.enabled ? null : styles.flatEdge;
  return (
    <View style={styles.field}>
      <Text variant="label" tone={error ? 'danger' : 'muted'}>{label.toUpperCase()}</Text>
      <View style={multiline ? styles.inputBoxMultiline : styles.inputBox}>
        <Well state={state} style={[styles.layer, flatEdge]} />
        {glass.enabled && focusArmed ? (
          <Animated.View style={[styles.layer, PASS, focusStyle]}>
            <Well state={error ? 'focusError' : 'focus'} style={styles.layer} />
          </Animated.View>
        ) : null}
        <TextInput
          testID={testID}
          value={value}
          onChangeText={onChangeText}
          onFocus={() => {
            setFocused(true);
            setFocusArmed(true);
          }}
          onBlur={() => setFocused(false)}
          secureTextEntry={secure}
          multiline={multiline}
          keyboardType={keyboardType}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          autoCapitalize={autoCapitalize ?? (secure || keyboardType === 'email-address' ? 'none' : 'sentences')}
          accessibilityLabel={label}
          // The well's focus glow is the focus ring, so web drops the browser's rectangular outline.
          style={[styles.input, type.body, { color: colors.text }, multiline && styles.inputMultiline, Platform.OS === 'web' ? styles.noOutline : null]}
        />
      </View>
      {error ? <Text variant="disclaimer" tone="danger" testID={testID ? `${testID}-error` : undefined}>{error}</Text> : hint ? <Text variant="disclaimer" tone="muted">{hint}</Text> : null}
    </View>
  );
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
export function EmptyState({ icon, title, body, action, testID }: { icon: KitIcon; title: string; body: string; action?: ReactNode; testID?: string }) {
  return <EmptyPanel icon={icon} title={title} body={body} action={action} variant="card" testID={testID ?? 'empty-state'} />;
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
 * with the danger rim, the title, the server's message, and Retry only where it can help.
 */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  const offline = e?.code === 'OFFLINE';
  const notFound = e?.code === 'NOT_FOUND';
  if (e?.code === 'FORBIDDEN_ROLE') {
    // Unauthorized: retrying can't help, so no Retry button.
    return <ErrorPanel testID="forbidden-state" glyph="lock" title="Not allowed" body={e.message} />;
  }
  return (
    <ErrorPanel
      testID={offline ? 'offline-state' : notFound ? 'not-found-state' : 'error-state'}
      glyph={offline ? 'offline' : 'alert'}
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

export function Segmented<T extends string>({ options, value, onChange, testID }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  testID?: string;
}) {
  const { colors, glass } = useTheme();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  // Segments sit on a 4dp grid gap (the board's seg); the tile is exactly one cell wide.
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
              style={styles.segment}
            >
              <Text variant="segment" style={{ color: on ? colors.text : colors.textMuted }}>{o.label}</Text>
            </FocusPressable>
          );
        })}
      </View>
    </Well>
  );
}

export function Checkbox({ checked, onChange, label, testID }: { checked: boolean; onChange: (v: boolean) => void; label: string; testID?: string }) {
  const { colors, glass } = useTheme();
  const { onStyle } = useCrossfade(checked);
  // §8: a 26dp well; checked fades in the primary-glass square with the on-primary check (120ms).
  return (
    <FocusPressable ringRadius={radius.segment} testID={testID} onPress={() => onChange(!checked)} accessibilityRole="checkbox" accessibilityState={{ checked }} style={styles.checkbox}>
      <View style={styles.box}>
        <Well radius={radius.checkbox} style={[styles.layer, glass.enabled ? null : styles.flatEdge]} />
        <Animated.View style={[styles.layer, PASS, onStyle]}>
          <GlassSurface recipe={glass.primary} radius={radius.checkbox} grain={false} style={styles.layer} />
          <Svg width={touch.checkbox} height={touch.checkbox} style={StyleSheet.absoluteFill}>
            {/* The board's check: the approve path at 0.5 scale, stroke 2, centred in the 26dp box. */}
            <Path d="M8.75 13.25L11.5 16L17.25 10" stroke={colors.onPrimary} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </Svg>
        </Animated.View>
      </View>
      <Text variant="bodySm" style={{ flex: 1 }}>{label}</Text>
    </FocusPressable>
  );
}

/** Commit sheets (§10.2 U7): a builder commits budget or credit. Admin, destructive and other sheets stay unlit. */
function isCommitSheet(title: string, confirmLabel: string, destructive: boolean | undefined): boolean {
  return !destructive && (confirmLabel === 'Publish' || title.startsWith('Approve and credit'));
}

// The board's sheet: padding 10/24/24 (less the 1dp glass border), grabber at the very top.
const SHEET_PAD = { top: 9, x: 23, bottom: 23 };
const KEYBOARD_BEHAVIOR = Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined;

/** Whether the software keyboard is up while `active` (JS events, not per frame). */
function useKeyboardShown(active: boolean): boolean {
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

/** The header tile per sheet (C4's table): the confirm's glyph and the tile's rim. Screens may pass their own. */
function sheetTile(title: string, confirmLabel: string, destructive: boolean): { glyph: GlyphName; tint?: GlassTone } {
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
      return destructive ? { glyph: 'alert', tint: 'danger' } : { glyph: 'info' };
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
export function ConfirmSheet({ visible, title, body, confirmLabel, destructive = false, onConfirm, onCancel, children, confirmDisabled, loading, moment, status, error, onLeave, glyph, tint }: {
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
  const busy = pending && !escaped;
  // C4: focus moves to the title; Escape, back, the backdrop and Cancel close, never while busy.
  const sheetFocus = useSheetFocus({ visible, busy, closing: sheet.closing, onClose: onCancel });
  const keyboard = useKeyboardShown(sheet.mounted);
  const commit = !destructive && (moment ? moment === 'commit' : isCommitSheet(title, confirmLabel, destructive));
  const light = useCommitUplight({ open: visible && commit, status: status ?? (pending ? 'pending' : 'idle'), onLeave });
  const tile = glyph ? { glyph, tint } : sheetTile(title, confirmLabel, destructive);
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
              <GlassTile name={tile.glyph} size="hero" tint={tile.tint} variant={destructive ? 'rose' : undefined} />
              {/* The focus target (C4). Native groups the title into one heading; web keeps the inner heading. */}
              <View ref={sheetFocus.titleRef} nativeID={titleId} accessible accessibilityRole={WEB ? undefined : 'header'} style={styles.sheetTitle}>
                <Text variant="title">{title}</Text>
              </View>
            </View>
            {body ? <Text tone="muted" style={styles.sheetBody}>{body}</Text> : null}
            {children ? <View style={styles.sheetChildren}>{children}</View> : null}
            {status === 'error' && error ? <SheetFailure message={error} /> : null}
            <View style={styles.sheetActions}>
              <SheetActions
              confirmLabel={confirmLabel}
              onConfirm={onConfirm}
              onCancel={sheetFocus.requestClose}
              destructive={destructive}
              pending={pending}
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

const styles = StyleSheet.create({
  fill: { flex: 1 },
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  touch: { minHeight: TOUCH },
  boxNone: { pointerEvents: 'box-none' },
  content: { paddingHorizontal: layout.gutter },
  column: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: layout.listGap },
  step: { gap: layout.listGap },
  collapseTop: { marginTop: -layout.listGap },
  collapseBottom: { marginBottom: -layout.listGap },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginBottom: space.sm, paddingHorizontal: layout.headerGutter - layout.gutter },
  headerText: { flex: 1, gap: 6 },
  field: { gap: 6 },
  inputBox: { minHeight: touch.input },
  inputBoxMultiline: { minHeight: touch.inputMultiline },
  input: { minHeight: touch.input, paddingHorizontal: 16, paddingVertical: 13, backgroundColor: 'transparent' },
  inputMultiline: { minHeight: touch.inputMultiline, textAlignVertical: 'top' },
  flatEdge: { borderWidth: 1.5 },
  noOutline: { outlineWidth: 0 },
  section: { gap: space.sm, marginTop: space.lg },
  track: { padding: 4 },
  segments: { flexDirection: 'row', gap: SEGMENT_GAP },
  segmentTile: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  segment: { flex: 1, minHeight: touch.segment, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
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
