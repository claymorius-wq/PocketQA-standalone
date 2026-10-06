import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ViewStyle } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlutedLens, GroundFade, useKeyLight, type Uplight, type UplightGrade } from '../glass';
import { GradientRule, HIDDEN, PASS_THROUGH } from '../glass/paint';
import { DUR, useMotion } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { layout, radius, type GradientStop } from '../theme/tokens';
import { Text, useDockKeyboard } from '../ui';
import { CommitUplight, PASS_MIN_AFTER_PRESS } from '../ui/patterns';

// The pieces A-SignIn and A-SignUp share (Direction A v2 §13; CONSISTENCY §M3, §U). They only
// draw: the auth screens keep their own state, copy, testIDs and calls to the session.

const BOX_NONE: ViewStyle = { pointerEvents: 'box-none' };

/**
 * The brand rule after POCKET QA, in the lit rim colour (#D6E0FF on the dark ground): it fades out
 * away from the key light (A-SignIn header). Light theme: GradientRule draws its flat border
 * hairline instead, so these stops never paint there.
 */
const brandRule = (rimLit: string): readonly GradientStop[] => [
  { offset: 0, color: rimLit, opacity: 0.28 },
  { offset: 1, color: rimLit, opacity: 0 },
];

/**
 * Sign in's hero (A-SignIn header): the 64dp fluted lens (the brand mark, S1 once on mount, never
 * on a Back return because the screen stays mounted), POCKET QA in DM Mono with its fading rule,
 * then the display title and the muted subtitle. The lens replaces the brief's ShieldCheck(28)
 * (spec §13, a deliberate deviation); the label and the copy are unchanged.
 */
export function BrandHero({ label, title, subtitle }: { label: string; title: string; subtitle: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.hero}>
      <View style={styles.brandRow}>
        <FlutedLens size={64} />
        <View style={styles.brandLabel}>
          <Text variant="label" tone="primary" style={styles.brandText}>
            {label}
          </Text>
          <GradientRule stops={brandRule(colors.rimLit)} style={styles.brandRule} />
        </View>
      </View>
      <Text variant="display" style={styles.heroTitle}>
        {title}
      </Text>
      <Text tone="muted" style={styles.heroSub}>
        {subtitle}
      </Text>
    </View>
  );
}

/**
 * U1 (§10.2): which grade Sign in's light plays. Pilot 0.35 under Sign in whenever it can fire
 * (a failure is told by the notice and leaves the pilot as it was; a pending request holds it).
 * The Commit pass plays only once the session has been accepted, never on the press.
 */
export function signInMoment(ready: boolean, signedIn: boolean): { grade: UplightGrade; active: boolean } {
  return signedIn ? { grade: 'commit', active: true } : { grade: 'pilot', active: ready };
}

// U1's hand-off between Sign in and the auth layout (§M3, CONSISTENCY C4). Timing only: Sign in
// arms it on the press, the layout holds its redirect while an armed pass plays and leaves at the
// pass peak, then the role's first tab finishes the tail. A plain module value, so the layout and
// the screen read the same press without a context; nothing here touches the session.
let u1: { pressedAt: number; passAt: number | null } | null = null;

/** Sign in was pressed: a success plays U1's Commit pass and hands the tail to the first tab. */
export function armU1(pressedAt = Date.now()): void {
  u1 = { pressedAt, passAt: null };
}

/** The sign-in failed, or the redirect has left: no U1 pass is waiting. */
export function disarmU1(): void {
  u1 = null;
}

/** Whether a Sign in press is waiting for (or playing) U1's Commit pass. */
export function u1Armed(): boolean {
  return u1 !== null;
}

/**
 * When U1's Commit pass starts once the session is accepted: max(280ms after the press, the
 * response) (C4). Fixed the first time it is asked, so the layout's leave and the screen's pass
 * read the same moment. Null when nothing is armed.
 */
export function u1PassAt(now = Date.now()): number | null {
  if (!u1) return null;
  u1.passAt ??= Math.max(u1.pressedAt + PASS_MIN_AFTER_PRESS, now);
  return u1.passAt;
}

// Sign in's dock sits at the screen's bottom edge, 30dp under the primary's rim (A-SignIn), or
// above the home indicator / gesture bar where that is taller.
const DOCK_BOTTOM = 30;
const DOCK_INSET_GAP = 12;
// The scrim's fade above the dock: Sign in's dock clearance, so content at rest ends where it starts.
const DOCK_SCRIM_FADE = layout.listGap;

/**
 * Sign in's bottom dock (A-SignIn), the Screen's `dock` with `dockPlacement="edge"` and
 * `dockKeyboard="ride"`: the small print and the primary are the last things on the screen, so U1
 * is Mode B, its floor anchored to the screen's bottom edge at the primary's x (§10.1 rule 4,
 * CONSISTENCY §U). The Screen ends its content above the dock and moves the dock with the arrival;
 * the dock's Enter steps join the screen's launch stagger, so the primary's caustic arrives last.
 *
 * While the keyboard is up the dock rides on it with the primary alone (the footer steps aside and
 * the home-indicator inset is under the keyboard), so it never covers the fields being typed in.
 *
 * Under it, a strip of the screen's own ground (GroundFade, as under the stack header): opaque
 * behind the footer and the primary, fading out over the clearance above them. Content taller than
 * the free room (Finish your account above the form) scrolls under the dock and dissolves into the
 * ground instead of showing through the small print; content at rest is never veiled. Not while
 * the dock rides the keyboard (it is off the ground's bottom edge then).
 */
export function SignInDock({ footer, children, light }: { footer?: ReactNode; children: ReactNode; light?: Uplight }) {
  const insets = useSafeAreaInsets();
  const keyboard = useDockKeyboard();
  // Sign in drives U1 from above its Screen's Ground, where no key light is in reach; the dock is
  // inside the Ground, so the moment registers here and the pool dims while it is lit (ADR 0006).
  const keyLight = useKeyLight();
  const u = light?.u;
  useEffect(() => (u ? keyLight?.register(u) : undefined), [keyLight, u]);
  const [height, setHeight] = useState(0);
  const paddingBottom = keyboard ? DOCK_INSET_GAP : Math.max(DOCK_BOTTOM, insets.bottom + DOCK_INSET_GAP);
  const onLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setHeight((prev) => (prev === h ? prev : h));
  };
  return (
    <View onLayout={onLayout} style={[styles.dock, { paddingBottom }, BOX_NONE]}>
      {height > 0 && !keyboard ? (
        <View {...HIDDEN} testID="sign-in-dock-scrim" style={[styles.dockScrim, { top: -DOCK_SCRIM_FADE, height: height + DOCK_SCRIM_FADE }, PASS_THROUGH]}>
          <GroundFade anchor="bottom" height={height + DOCK_SCRIM_FADE} solid={height} />
        </View>
      ) : null}
      {/* Mode B: over the scrim, under the small print and the primary; 300dp, so the pool fades out. */}
      {light ? <CommitUplight light={light} x={0.5} /> : null}
      <View style={[styles.dockColumn, BOX_NONE]}>
        {/* Kept mounted while the keyboard is up, so it never re-enters. */}
        {footer ? <View style={keyboard ? styles.gone : null}>{footer}</View> : null}
        {children}
      </View>
    </View>
  );
}

/**
 * Sign in's primary under U1: the spill below the button and the uplit edge on it follow the
 * light's intensity u (both pre-rendered; only their opacity moves). Light theme: the button alone.
 */
export function UplitPrimary({ light, children }: { light: Uplight; children: ReactNode }) {
  const { glass } = useTheme();
  // The layers mount with their own animated style (a theme switch adds or drops them), and the
  // button keeps its place in between, so it never remounts. The spill and the uplit edge are the
  // glass.uplight tokens (the commit confirm's spill, the primary's uplit edge).
  return (
    <View>
      {light.enabled ? <UplitLayer light={light} style={{ boxShadow: glass.uplight.spill }} testID="sign-in-uplight-spill" /> : null}
      {children}
      {light.enabled ? <UplitLayer light={light} style={{ boxShadow: glass.uplight.primaryEdge }} /> : null}
    </View>
  );
}

function UplitLayer({ light, style, testID }: { light: Uplight; style: ViewStyle; testID?: string }) {
  const lit = useAnimatedStyle(() => ({ opacity: light.u.value }));
  return <Animated.View {...HIDDEN} testID={testID} style={[styles.layer, style, PASS_THROUGH, lit]} />;
}

/**
 * The role description under A-SignUp's role switch: both texts share one cell, so the form below
 * never moves; the chosen one fades in (240ms ease-lens at +80, from 4dp up) while the other
 * steps out (120ms ease-exit). Reduced motion: the fades only. The hidden one is hidden from
 * assistive technology.
 */
export function RoleNote<T extends string>({ value, notes }: { value: T; notes: readonly { value: T; text: string }[] }) {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const tallest = Math.max(0, ...Object.values(heights));
  return (
    <View style={[styles.note, { minHeight: tallest }]}>
      {notes.map((n, i) => (
        <RoleNoteText
          key={n.value}
          text={n.text}
          on={n.value === value}
          overlay={i > 0}
          onHeight={(h) => setHeights((prev) => (prev[n.value] === h ? prev : { ...prev, [n.value]: h }))}
        />
      ))}
    </View>
  );
}

function RoleNoteText({ text, on, overlay, onHeight }: { text: string; on: boolean; overlay: boolean; onHeight: (h: number) => void }) {
  const motion = useMotion();
  const shown = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    const enter = { duration: DUR.swap, easing: motion.ease.lens, reduceMotion: ReduceMotion.Never };
    const exit = { duration: DUR.tick, easing: motion.ease.exit, reduceMotion: ReduceMotion.Never };
    shown.value = on ? withDelay(motion.reduced ? 0 : NOTE_IN_DELAY, withTiming(1, enter)) : withTiming(0, exit);
  }, [on, shown, motion]);
  const rise = motion.reduced ? 0 : NOTE_RISE;
  const style = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: -(1 - shown.value) * rise }] }));
  return (
    <Animated.View
      onLayout={(e) => onHeight(e.nativeEvent.layout.height)}
      accessibilityElementsHidden={!on}
      importantForAccessibility={on ? 'auto' : 'no-hide-descendants'}
      aria-hidden={!on}
      style={[overlay ? styles.noteOverlay : null, on ? null : PASS_THROUGH, style]}
    >
      <Text variant="small" tone="muted">
        {text}
      </Text>
    </Animated.View>
  );
}
const NOTE_IN_DELAY = 80;
const NOTE_RISE = 4;

/** The glass divider inside the sign-in card, between the demo role switch and the fields. */
/** "or" between a form and the other ways in (Google, wallets): the card's rule either side of a muted word. Decorative. */
export function OrRule({ testID }: { testID?: string }) {
  return (
    <View style={styles.or} testID={testID} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.orLine}>
        <CardRule />
      </View>
      <Text variant="small" tone="muted">
        or
      </Text>
      <View style={styles.orLine}>
        <CardRule />
      </View>
    </View>
  );
}

export function CardRule() {
  const { glass } = useTheme();
  return <GradientRule stops={glass.divider.stops} style={styles.cardRule} />;
}

/** A-SignUp's "Sign in" link underline, in the link's primary (#A9C1FF on the dark ground): a 1dp rule that fades toward the far end. */
const linkRule = (primary: string): readonly GradientStop[] => [
  { offset: 0, color: primary, opacity: 0.9 },
  { offset: 1, color: primary, opacity: 0.25 },
];

// The link text's line box (16/22 heading): the rule sits 1dp under it, centred in the row.
const LINK_LINE = 22;

/**
 * A text link's touch row (44dp on A-SignUp, 48dp on A-SignIn) with A-SignUp's gradient underline
 * (the link itself stays the screen's). Light theme: a flat primary hairline, so it still reads as
 * a link on the light ground (the paint kit's flat rule is the neutral border colour).
 */
export function UnderlinedLink({ children, height = 44 }: { children: ReactNode; height?: 44 | 48 }) {
  const { glass, colors } = useTheme();
  const rule = [styles.linkRule, { bottom: (height - LINK_LINE) / 2 - 1 }];
  return (
    <View style={[styles.linkBox, { minHeight: height }]}>
      {children}
      {glass.enabled ? (
        <GradientRule stops={linkRule(colors.primary)} style={rule} />
      ) : (
        <View {...HIDDEN} style={[rule, styles.linkFlat, { backgroundColor: colors.primary }, PASS_THROUGH]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.button },
  hero: { paddingHorizontal: layout.headerGutter - layout.gutter },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  brandLabel: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  // 0.14em of the 12dp label: the brand line is tracked wider than other labels (A-SignIn).
  brandText: { letterSpacing: 1.68 },
  brandRule: { flex: 1 },
  heroTitle: { marginTop: 16, maxWidth: 330 },
  heroSub: { marginTop: 8, maxWidth: 340 },
  dock: { paddingHorizontal: layout.gutter },
  dockColumn: { width: '100%', maxWidth: 720, alignSelf: 'center' },
  dockScrim: { position: 'absolute', left: 0, right: 0, overflow: 'hidden' },
  gone: { display: 'none' },
  note: { paddingHorizontal: 4 },
  noteOverlay: { position: 'absolute', top: 0, left: 4, right: 4 },
  cardRule: { marginTop: 14, marginBottom: 13 },
  or: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  orLine: { flex: 1 },
  linkBox: { justifyContent: 'center' },
  linkRule: { position: 'absolute', left: 4, right: 4 },
  linkFlat: { height: StyleSheet.hairlineWidth },
});
