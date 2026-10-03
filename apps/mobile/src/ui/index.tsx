import { HeaderHeightContext } from 'expo-router/react-navigation';
import { BottomTabBarHeightContext } from 'expo-router/tabs';
import { Children, isValidElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { AlertTriangle, Lock, RefreshCw, WifiOff } from 'lucide-react-native';
import { ApiError } from '../api/client';
import { CausticSweep, FlutedLens, GlassBlur, GlassSurface, Ground, UplightFloor, useKeyLight, useSweepOnEnable, useUplight, Well } from '../glass';
import { HIDDEN, useSvgId } from '../glass/paint';
import { GlassTile, type GlyphName } from '../icons';
import { LiveLed, useCrossfade, usePressMotion, useSheetMotion, useTabTile } from '../motion';
import { DUR, UPLIGHT } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { layout, radius, space, touch, TOUCH, type GlassSurface as GlassRecipe, type TypeScale } from '../theme/tokens';
import { KitIconView, type KitIcon } from './icon';
import { Enter, EnterContext, ScreenContext, useMountedLate, useScreenFocused, useSwapFade, type ScreenInfo } from './screen';

// The shared UI kit in the Lens visual system (docs/decisions/0005-lens-visual-system.md;
// Direction A v2 §8). Every export keeps its pre-Lens props, testIDs, accessibility and copy;
// only the drawing changed. Dark is the Lens look; light degrades every glass recipe to a flat
// surface (TODO(light-lens): the light Lens theme replaces those recipes in tokens.ts).

export { glyphNameFor, KitIconView, type KitIcon } from './icon';
export { LensStackHeader, lensStackScreenOptions } from './StackHeader';
export { LensTabBar } from './TabBar';

type Variant = keyof TypeScale;
type Tone = 'default' | 'muted' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const PASS: ViewStyle = { pointerEvents: 'none' };

export function Text({ children, variant = 'body', tone = 'default', style, testID, numberOfLines }: {
  children: ReactNode;
  variant?: Variant;
  tone?: Tone;
  style?: StyleProp<TextStyle>;
  testID?: string;
  numberOfLines?: number;
}) {
  const { colors, type } = useTheme();
  const screen = useContext(ScreenContext);
  // Stack-screen titles are display-stack (32/36); tab roots and sign-in keep display (40/44).
  const face = variant === 'display' && screen?.stack ? 'displayStack' : variant;
  const numeral = variant === 'numeral' || variant === 'numeralXl';
  const color = tone === 'default' ? (numeral ? colors.numeral : colors.text) : tone === 'muted' ? colors.textMuted : colors[tone];
  return (
    <RNText testID={testID} numberOfLines={numberOfLines} style={[type[face], { color }, style]} accessibilityRole={variant === 'display' || variant === 'title' ? 'header' : undefined}>
      {children}
    </RNText>
  );
}

export function Screen({ children, title, subtitle, scroll = true, testID, right }: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  scroll?: boolean;
  testID?: string;
  right?: ReactNode;
}) {
  // A stack screen draws under the transparent Lens header (app/_layout.tsx), so the content starts
  // below it; tab screens sit above the floating tab bar, which reports its height.
  const headerHeight = useContext(HeaderHeightContext) ?? 0;
  const tabBarHeight = useContext(BottomTabBarHeightContext) ?? 0;
  const insets = useSafeAreaInsets();
  const { motion } = useTheme();
  const stack = headerHeight > 0;
  const [mountedAt] = useState(() => Date.now());
  const [wave] = useState(() => ({ start: mountedAt }));
  const [commitPass, setCommitPass] = useState<{ key: number; x: number } | null>(null);
  const commit = useCallback((x: number) => setCommitPass((p) => ({ key: (p?.key ?? 0) + 1, x })), []);
  const endCommit = useCallback(() => setCommitPass(null), []);
  const info = useMemo<ScreenInfo>(() => ({ wave, mountedAt, stack, commit }), [wave, mountedAt, stack, commit]);

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
  // Content enters top to bottom from t=80, 40ms apart, at most five steps (§11.3). Each step
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
      <Ground>
        {commitPass && motion.play.uplightCommit ? <CommitFloor key={commitPass.key} x={commitPass.x} onDone={endCommit} /> : null}
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
      </Ground>
    </ScreenContext.Provider>
  );
}

/** One Commit pass (§10.4): rise 560, hold 120, fall 700; the motes finish inside it. */
const COMMIT_PASS_MS = UPLIGHT.commit.rise + UPLIGHT.commit.hold + UPLIGHT.commit.fall;
const COMMIT_FLOOR_HEIGHT = 160;

/**
 * U7's Commit pass on the screen's own floor (bottom edge, at the confirm's x). It belongs to the
 * screen, not the sheet: callers close the sheet as soon as the mutation succeeds (and web unmounts
 * it at once), which would otherwise cut the pass after a few frames and read as an abort.
 */
function CommitFloor({ x, onDone }: { x: number; onDone: () => void }) {
  const light = useUplight('commit', true);
  useEffect(() => {
    const t = setTimeout(onDone, COMMIT_PASS_MS);
    return () => clearTimeout(t);
  }, [onDone]);
  return <UplightFloor light={light} x={x} height={COMMIT_FLOOR_HEIGHT} />;
}

/** L1 light distance down a screen (§2 cardK): rim and bloom × 1, 0.8, 0.64 by entrance step. */
const CARD_K = [1, 0.8, 0.64] as const;

export function Card({ children, style, testID, onPress, accessibilityLabel, k }: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** Light distance (cardK). Default: by the screen step the card enters in (1, 0.8, then 0.64). */
  k?: number;
}) {
  const press = usePressMotion();
  const enter = useContext(EnterContext);
  const distance = k ?? (enter && typeof enter.step === 'number' ? CARD_K[Math.min(enter.step, CARD_K.length - 1)] : 1);
  if (!onPress) {
    return (
      <GlassSurface level="card" k={distance} style={[styles.card, style]} testID={testID}>
        {children}
      </GlassSurface>
    );
  }
  // The whole card is the button; the glass sinks into the pressed recipe (§4 Pressed).
  return (
    <Pressable testID={testID} onPress={onPress} onPressIn={press.pressIn} onPressOut={press.pressOut} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={styles.touch}>
      <GlassSurface level="card" k={distance} pressed={press.progress} style={[styles.card, styles.touch, style]}>
        {children}
      </GlassSurface>
    </Pressable>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button(props: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: KitIcon;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return <LensButton {...props} />;
}

/**
 * Button recipes (§8): primary is lit blue glass with the down-right caustic; disabled is unlit
 * glass (a 240ms crossfade of the two layers, never an opacity fade) and turning enabled plays
 * the caustic sweep, as does firing; busy keeps the label and swaps the icon for the spinner.
 * Secondary is raised glass, danger is dark rose glass (never lit from below), ghost is text.
 * `commit` adds the commit-sheet confirm's under-glow (§10.3).
 */
function LensButton({ label, onPress, variant = 'primary', icon, loading, disabled, testID, accessibilityHint, style, commit = false }: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: KitIcon;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
  commit?: boolean;
}) {
  const { colors, glass, motion } = useTheme();
  const off = !!(disabled || loading);
  const press = usePressMotion(off);
  const primary = variant === 'primary';

  const lit = useSharedValue(disabled ? 0 : 1);
  useEffect(() => {
    lit.value = withTiming(disabled ? 0 : 1, motion.timing.swap);
  }, [disabled, lit, motion]);
  const litStyle = useAnimatedStyle(() => ({ opacity: lit.value }));
  // The unlit layer only shows while disabled, so a pressed (translated) lit layer never reveals it.
  // It mounts the first time the button is disabled and then stays for the 240ms crossfades.
  const unlitStyle = useAnimatedStyle(() => ({ opacity: 1 - lit.value }));
  const [unlitMounted, setUnlitMounted] = useState(!!disabled);
  if (disabled && !unlitMounted) setUnlitMounted(true);
  const progress = press.progress;

  // The caustic arrives last (§11.3.4): it fades in over dur-enter once the button's own entrance
  // step has landed (120ms under reduced motion). Outside a screen entrance it is simply there.
  const enter = useContext(EnterContext);
  const [arrival] = useState(() => {
    if (!enter?.causticAt) return null;
    const wait = enter.causticAt - Date.now();
    return wait < -DUR.enter ? null : Math.max(0, wait);
  });
  const arrive = useSharedValue(arrival === null ? 1 : 0);
  useEffect(() => {
    if (arrival !== null) arrive.value = withDelay(arrival, withTiming(1, motion.timing.enter));
    // Mount only, like the entrance it follows.
  }, []);
  // The caustic shrinks to 60% while pressed (§11.4); its layer fades with the lit glass.
  const caustic = useDerivedValue(() => arrive.value * (1 - 0.4 * Math.min(1, Math.max(0, progress.value))));

  const enabledSweep = useSweepOnEnable(!disabled);
  const [fired, setFired] = useState(0);
  const handlePress = () => {
    if (primary) setFired((n) => n + 1);
    onPress();
  };

  const recipes: Record<ButtonVariant, [GlassRecipe, GlassRecipe] | null> = {
    primary: [commit ? { ...glass.primary, shadow: glass.uplight.commitConfirmShadow ?? glass.primary.shadow } : glass.primary, glass.primaryPressed],
    secondary: [glass.secondary, glass.secondaryPressed],
    danger: [glass.destructive, glass.secondaryPressed],
    ghost: null,
  };
  const pair = recipes[variant];
  const fg = {
    primary: disabled ? colors.textDisabled : colors.onPrimary,
    secondary: colors.text,
    danger: colors.danger,
    ghost: colors.primary,
  }[variant];

  return (
    <Pressable
      testID={testID}
      onPress={off ? undefined : handlePress}
      onPressIn={press.pressIn}
      onPressOut={press.pressOut}
      disabled={off}
      aria-disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: !!loading }}
      accessibilityHint={accessibilityHint}
      style={[styles.button, !primary && disabled ? styles.dim : null, style]}
    >
      {primary && unlitMounted ? (
        <Animated.View style={[styles.layer, PASS, unlitStyle]}>
          <GlassSurface recipe={glass.primaryDisabled} grain={false} style={styles.layer} />
        </Animated.View>
      ) : null}
      {pair ? (
        <Animated.View style={[styles.layer, PASS, primary ? litStyle : null]}>
          <GlassSurface recipe={pair[0]} pressedRecipe={pair[1]} pressed={progress} caustic={primary ? caustic : undefined} grain={false} style={styles.layer} />
        </Animated.View>
      ) : null}
      {/* Mounted on its first sweep: most primaries never become enabled or fire on a screen. */}
      {primary && enabledSweep + fired > 0 ? <CausticSweep playKey={enabledSweep + fired} radius={radius.button} /> : null}
      <Animated.View style={[styles.buttonContent, press.motionStyle]}>
        {loading ? (
          <ActivityIndicator color={fg} />
        ) : icon ? (
          <KitIconView icon={icon} size={20} variant={primary ? 'lit' : 'face'} danger={variant === 'danger'} color={fg} />
        ) : null}
        <Text variant="button" style={{ color: fg }}>
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
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

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  draft: 'neutral',
  published: 'success',
  paused: 'warning',
  closed: 'neutral',
  consented: 'info',
  in_progress: 'info',
  submitted: 'warning',
  approved: 'success',
  rejected: 'danger',
  disputed: 'warning',
  resolved: 'neutral',
  withdrawn: 'neutral',
  open: 'warning',
  uploading: 'warning',
  awaiting_signature: 'info',
  pending: 'warning',
  confirmed: 'success',
  failed: 'danger',
  expired: 'neutral',
  suspended: 'danger',
  ok: 'success',
};
/**
 * Statuses that carry the live LED (§8): only work genuinely happening now (IN PROGRESS,
 * UPLOADING). Never 'pending' (§14: pending never celebrates). Pills are never uplit.
 */
const LIVE_STATUS = new Set(['in_progress', 'uploading']);

export function StatusPill({ status, label, testID, live }: { status: string; label?: string; testID?: string; live?: boolean }) {
  const { colors, glass } = useTheme();
  // The LED loop runs only while its screen is focused: tab scenes stay mounted when unfocused.
  const focused = useScreenFocused();
  const tone = STATUS_TONE[status] ?? 'neutral';
  const fg = colors[tone];
  const text = label ?? status.replace(/_/g, ' ');
  // A status change swaps the pill content in 120ms, no other motion (§14: pending never celebrates).
  const swap = useSwapFade(`${status}|${text}`);
  return (
    <GlassSurface recipe={glass.pill(tone)} grain={false} style={styles.pill} testID={testID} accessibilityLabel={`Status: ${text}`}>
      <Animated.View style={[styles.pillRow, swap]}>
        {(live ?? LIVE_STATUS.has(status)) ? <LiveLed color={fg} shadow={glass.ledShadow(tone)} active={focused} /> : null}
        <Text variant="label" style={{ color: fg }}>{text.toUpperCase()}</Text>
      </Animated.View>
    </GlassSurface>
  );
}

/** Notice glyph per tone (§8: success uses Approve, not Info). */
const NOTICE_GLYPH: Record<'info' | 'warning' | 'danger' | 'success', GlyphName> = { info: 'info', warning: 'warning', danger: 'alert', success: 'approve' };

export function Notice({ tone = 'info', title, children, testID }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title: string; children?: ReactNode; testID?: string }) {
  const { colors, glass } = useTheme();
  const late = useMountedLate();
  // No side stripe: meaning rides on the tinted rim and the glyph tile's rim (§7.5, §8).
  const notice = (
      <GlassSurface recipe={glass.notice(tone)} grain={false} testID={testID} accessibilityRole="summary" style={styles.notice}>
        <GlassTile name={NOTICE_GLYPH[tone]} size="notice" tint={tone} variant={tone === 'danger' ? 'rose' : undefined} />
        <View style={styles.noticeText}>
          <Text variant="headingNotice" style={{ color: colors[tone] }}>{title}</Text>
          {typeof children === 'string' ? <Text variant="bodySm" tone="muted">{children}</Text> : children}
        </View>
      </GlassSurface>
  );
  // A notice that appears after the screen's entrance (an error after a mutation) enters by itself.
  return late ? <Enter step={0} delay={0}>{notice}</Enter> : notice;
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Section({ title, children, right, testID }: { title: string; children: ReactNode; right?: ReactNode; testID?: string }) {
  const { colors, type } = useTheme();
  return (
    <View style={styles.section} testID={testID}>
      <Row style={{ justifyContent: 'space-between' }}>
        <RNText accessibilityRole="header" style={[type.heading, { color: colors.text }]}>{title}</RNText>
        {right}
      </Row>
      {children}
    </View>
  );
}

export function EmptyState({ icon, title, body, action, testID }: { icon: KitIcon; title: string; body: string; action?: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  // §8, §9 and the boards: an L1 card at k = 0.8 with the 72dp fluted lens on the left (the
  // state's glyph floating in front of the refracted sphere) and the text beside it.
  return (
    <GlassSurface level="card" k={0.8} style={styles.emptyCard} testID={testID ?? 'empty-state'}>
      <FlutedLens size={72}>
        <KitIconView icon={icon} size={36} color={colors.rimLit} />
      </FlutedLens>
      <View style={styles.emptyText}>
        <Text variant="heading">{title}</Text>
        <Text variant="bodySm" tone="muted">{body}</Text>
        {action ? <View style={styles.emptyAction}>{action}</View> : null}
      </View>
    </GlassSurface>
  );
}

/**
 * Loading is static unlit glass (§11.6, §13: no shimmer, no spinner): the label and, with
 * `skeleton`, placeholder cards where content will land. Only the app's start screen passes
 * `brand`, which resolves the brand lens once (S1); the lens is never twice on a screen (§9).
 */
export function LoadingState({ label = 'Loading…', skeleton = false, brand = false }: { label?: string; skeleton?: boolean; brand?: boolean }) {
  return (
    <View testID="loading-state" accessibilityLabel={label} accessibilityRole="progressbar" accessibilityState={{ busy: true }}>
      <View style={brand ? styles.brandLoading : styles.loadingLabel}>
        {brand ? <FlutedLens size={54} /> : null}
        <Text tone="muted">{label}</Text>
      </View>
      {skeleton ? (
        <View style={styles.skeletons} accessible={false} importantForAccessibility="no-hide-descendants">
          <SkeletonCard k={0.8} />
          <SkeletonCard k={0.64} />
        </View>
      ) : null}
    </View>
  );
}

function SkeletonCard({ k }: { k: number }) {
  const { colors } = useTheme();
  const bar = { backgroundColor: colors.surfaceAlt };
  return (
    <GlassSurface level="card" k={k} style={styles.card}>
      <View style={[styles.bar, bar, { width: '62%' }]} />
      <View style={[styles.bar, styles.barThin, bar, { width: '88%' }]} />
      <View style={[styles.bar, styles.barThin, bar, { width: '40%' }]} />
    </GlassSurface>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  const offline = e?.code === 'OFFLINE';
  const notFound = e?.code === 'NOT_FOUND';
  if (e?.code === 'FORBIDDEN_ROLE') {
    // Unauthorized: retrying can't help, so no Retry button.
    return <EmptyState testID="forbidden-state" icon={Lock} title="Not allowed" body={e.message} />;
  }
  return (
    <EmptyState
      testID={offline ? 'offline-state' : notFound ? 'not-found-state' : 'error-state'}
      icon={offline ? WifiOff : AlertTriangle}
      title={offline ? 'You’re offline' : notFound ? 'Not found' : 'Something went wrong'}
      body={offline ? 'Can’t reach the local Pocket QA server. Check that the API is running, then retry.' : notFound ? 'This item doesn’t exist or you don’t have access to it.' : (e?.message ?? 'Please try again.')}
      action={onRetry && !notFound ? <Button label="Retry" icon={RefreshCw} variant="secondary" onPress={onRetry} testID="retry-button" /> : undefined}
    />
  );
}

/** Renders loading / error / offline / empty states around a react-query result. */
export function QueryState<T>({ query, empty, children }: {
  query: { isLoading: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
  empty?: (data: T) => ReactNode | null;
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) return <LoadingState skeleton />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data === undefined) return <LoadingState skeleton />;
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
            <Pressable
              key={o.value}
              testID={testID ? `${testID}-${o.value}` : undefined}
              onPress={() => onChange(o.value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              style={styles.segment}
            >
              <Text variant="segment" style={{ color: on ? colors.text : colors.textMuted }}>{o.label}</Text>
            </Pressable>
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
    <Pressable testID={testID} onPress={() => onChange(!checked)} accessibilityRole="checkbox" accessibilityState={{ checked }} style={styles.checkbox}>
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
    </Pressable>
  );
}

/** Commit sheets (§10.2 U7): a builder commits budget or credit. Admin, destructive and other sheets stay unlit. */
function isCommitSheet(title: string, confirmLabel: string, destructive: boolean | undefined): boolean {
  return !destructive && (confirmLabel === 'Publish' || title.startsWith('Approve and credit'));
}

// The board's sheet: padding 10/24/24 (less the 1dp glass border), grabber at the very top.
const SHEET_PAD = { top: 9, x: 23, bottom: 23 };
const KEYBOARD_BEHAVIOR = Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined;
const NOOP = () => undefined;

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

/**
 * In-app confirmation (native alerts don't exist on web, and block automation).
 * `moment` opts a sheet in or out of the U7 commit Uplight explicitly; without it, Publish and
 * "Approve and credit …" sheets are commit sheets. Destructive sheets are never lit.
 */
export function ConfirmSheet({ visible, title, body, confirmLabel, destructive, onConfirm, onCancel, children, confirmDisabled, loading, moment }: {
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
}) {
  const { glass, motion } = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const keyLight = useKeyLight();
  const screen = useContext(ScreenContext);
  // Web unmounts the moment it closes: react-native-web's Modal can stay mounted and visible over
  // the page after a closing animation (found by e2e/admin-dispute.spec.ts). Native plays the
  // 240ms exit; a Modal is its own window (an Android Dialog, an iOS presented controller), so
  // touches on the screen below stay blocked until it unmounts, and back is ignored meanwhile.
  const sheet = useSheetMotion({ visible, animateExit: Platform.OS !== 'web' });
  const keyboard = useKeyboardShown(sheet.mounted);
  const commit = !destructive && (moment ? moment === 'commit' : isCommitSheet(title, confirmLabel, destructive));
  const [fired, setFired] = useState(false);
  if (!visible && fired) setFired(false);
  // U7: the pilot floor (0.55, +260ms) under the confirm while open; confirming plays a Commit pass
  // here while the sheet is up, and on the screen's floor, which outlives the sheet's close.
  const light = useUplight(fired ? 'commit' : 'pilot', visible && commit, { level: UPLIGHT.pilot.sheet, delay: UPLIGHT.pilot.delay });
  const [panelWidth, setPanelWidth] = useState(0);
  const [confirmBox, setConfirmBox] = useState<{ x: number; width: number } | null>(null);
  // The floor sits at the confirm's centre (Cancel left, confirm right: about 3/4 across).
  const confirmX = confirmBox ? layout.sheetPadding + confirmBox.x + confirmBox.width / 2 : null;
  const floorX = panelWidth > 0 && confirmX !== null ? confirmX / panelWidth : 0.75;
  const screenX = panelWidth > 0 && confirmX !== null && windowWidth > 0 ? ((windowWidth - panelWidth) / 2 + confirmX) / windowWidth : 0.75;

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
  const confirm = () => {
    if (commit) {
      setFired(true);
      if (motion.play.uplightCommit) screen?.commit?.(screenX);
    }
    onConfirm();
  };
  const through = sheet.closing ? PASS : null;
  return (
    <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent onRequestClose={sheet.closing ? NOOP : onCancel}>
      {/* The keyboard lifts the docked sheet so the focused field and the actions stay visible. */}
      <KeyboardAvoidingView behavior={KEYBOARD_BEHAVIOR} style={[styles.fill, styles.dockEnd]}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: glass.sheet.backdrop }, sheet.backdropStyle, through]} />
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
            {commit ? <UplightFloor light={light} x={floorX} height={COMMIT_FLOOR_HEIGHT} /> : null}
            <View style={[styles.grabber, { backgroundColor: glass.sheet.grabber }]} />
            <Text variant="title" style={styles.sheetTitle}>{title}</Text>
            {body ? <Text tone="muted" style={styles.sheetBody}>{body}</Text> : null}
            {children ? <View style={styles.sheetChildren}>{children}</View> : null}
            <View style={styles.sheetActions}>
              <Button label="Cancel" variant="secondary" onPress={onCancel} testID="confirm-cancel" style={styles.fill} />
              <View
                style={styles.fill}
                onLayout={(e) => {
                  const { x, width } = e.nativeEvent.layout;
                  setConfirmBox((b) => (b && b.x === x && b.width === width ? b : { x, width }));
                }}
              >
                <LensButton label={confirmLabel} variant={destructive ? 'danger' : 'primary'} onPress={confirm} disabled={confirmDisabled} loading={loading} testID="confirm-ok" commit={commit} />
              </View>
            </View>
          </GlassBlur>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Divider() {
  const { glass, colors } = useTheme();
  // Document-unique: on web every inline SVG shares one id namespace (glass/paint.tsx).
  const id = useSvgId('dv');
  if (!glass.enabled) return <View style={[styles.divider, { height: StyleSheet.hairlineWidth, backgroundColor: colors.border }]} />;
  // The gradient divider fades out toward the far side, away from the light (§8 list row).
  const stops = glass.divider.stops;
  return (
    <View style={styles.divider} {...HIDDEN}>
      <Svg width="100%" height={1}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="0">
            {stops.map((s, i) => (
              <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height={1} fill={`url(#${id})`} />
      </Svg>
    </View>
  );
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
  card: {
    borderRadius: radius.card,
    paddingTop: layout.cardPadding.top,
    paddingRight: layout.cardPadding.right,
    paddingBottom: layout.cardPadding.bottom,
    paddingLeft: layout.cardPadding.left,
    gap: space.sm,
  },
  button: { minHeight: touch.button, borderRadius: radius.button, paddingHorizontal: 20, justifyContent: 'center' },
  buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  dim: { opacity: 0.55 },
  field: { gap: 6 },
  inputBox: { minHeight: touch.input },
  inputBoxMultiline: { minHeight: touch.inputMultiline },
  input: { minHeight: touch.input, paddingHorizontal: 16, paddingVertical: 13, backgroundColor: 'transparent' },
  inputMultiline: { minHeight: touch.inputMultiline, textAlignVertical: 'top' },
  flatEdge: { borderWidth: 1.5 },
  noOutline: { outlineWidth: 0 },
  pill: { borderRadius: radius.pill, minHeight: 28, paddingHorizontal: 11, alignSelf: 'flex-start', justifyContent: 'center' },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  notice: { flexDirection: 'row', gap: space.md, paddingTop: 13, paddingRight: 15, paddingBottom: 14, paddingLeft: 13, alignItems: 'flex-start' },
  noticeText: { flex: 1, gap: 3 },
  section: { gap: space.sm, marginTop: space.lg },
  emptyCard: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingTop: 19, paddingRight: 17, paddingBottom: 19, paddingLeft: 19, minHeight: 136, borderRadius: radius.card },
  emptyText: { flex: 1, gap: 4 },
  emptyAction: { marginTop: space.sm, alignSelf: 'flex-start' },
  brandLoading: { alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.lg },
  loadingLabel: { paddingVertical: space.xs },
  skeletons: { gap: layout.listGap },
  bar: { height: 14, borderRadius: 7 },
  barThin: { height: 10, borderRadius: 5 },
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
  sheetTitle: { marginTop: 20 },
  sheetBody: { marginTop: 8 },
  sheetChildren: { marginTop: space.md, gap: space.md },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 24 },
  divider: { height: 1, marginVertical: space.sm },
});
