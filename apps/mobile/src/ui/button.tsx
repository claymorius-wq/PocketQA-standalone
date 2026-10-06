import { useContext, useEffect, useRef, useState, type Ref } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { CausticSweep, GlassSurface, useSweepOnEnable } from '../glass';
import { PASS_THROUGH } from '../glass/paint';
import type { GlyphVariant } from '../icons';
import { usePressMotion } from '../motion';
import { DUR } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { radius, touch, TOUCH, type GlassSurface as GlassRecipe } from '../theme/tokens';
import { FocusPressable } from './focus';
import { KitIconView, type KitIcon } from './icon';
import { EnterContext } from './screen';
import { Spinner } from './spinner';
import { Text } from './text';

// The kit's one button (a leaf module: the kit and the patterns both import it, without a cycle).

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
/** `compact`: a trailing row action (Moderation's Suspend / Reinstate, Discover's Edit): radius 14, padding 0 14, gap 8, an 18 glyph, still 48 tall. */
export type ButtonSize = 'default' | 'compact';

export type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: KitIcon;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  /** What a screen reader says instead of the visible label (e.g. "Edit device profile" for "Edit"). */
  accessibilityLabel?: string;
  accessibilityHint?: string;
  size?: ButtonSize;
  /**
   * S4 on fire (default true). False for a primary whose fire a Commit pass follows (Sign in under
   * U1, a commit sheet's confirm, "Consent and join"): the light is the moment, the sweep never
   * doubles it (§11.5). The sweep when it becomes enabled still plays.
   */
  sweepOnFire?: boolean;
  /**
   * Plays S4 from the screen: each time this number increases, an enabled primary sweeps once
   * (A-Session's U2 sweep on Start session at +600). Never on mount, never on a disabled or busy
   * button or another variant; the sweep's 1200ms guard and reduced motion (no sweep) still apply.
   */
  sweepSignal?: number;
  /**
   * Ignores presses and is announced busy, with no spinner and no change to its look: a commit
   * sheet's confirm while its Commit pass plays (C4: a sheet never closes or re-fires mid-pass).
   */
  locked?: boolean;
  style?: StyleProp<ViewStyle>;
  /** The pressable, so a screen can move focus to it (React 19 ref prop). */
  ref?: Ref<View>;
};

/**
 * Button recipes (§8): primary is lit blue glass with the down-right caustic; disabled is unlit
 * glass (a 240ms crossfade of the two layers, never an opacity fade) and turning enabled plays
 * the caustic sweep, as does firing; busy keeps the label and swaps the icon for the spinner
 * (CONSISTENCY C4, C7). Secondary is raised glass, danger is dark rose glass (never lit from
 * below), ghost is text. Glyphs (G3): `ink` on the primary fill, `muted` while disabled, rose for
 * the destructive glyphs on danger, `face` otherwise.
 */
export function Button({ label, onPress, variant = 'primary', icon, loading, disabled, testID, accessibilityLabel, accessibilityHint, size = 'default', sweepOnFire = true, sweepSignal, locked = false, style, ref }: ButtonProps) {
  const { colors, glass, motion } = useTheme();
  const off = !!(disabled || loading || locked);
  const compact = size === 'compact';
  const r = compact ? COMPACT_RADIUS : radius.button;
  const press = usePressMotion(off);
  const primary = variant === 'primary';

  const lit = useSharedValue(disabled ? 0 : 1);
  useEffect(() => {
    lit.value = withTiming(disabled ? 0 : 1, motion.timing.swap);
  }, [disabled, lit, motion]);
  // C5 "Disabled ⇄ enabled": the unlit recipe is a third layer over the lit glass, faded in 240ms.
  // The lit glass stays under it, so its bright rim shows through the unlit layer's faint one: a
  // primary waiting to be enabled keeps its edge (A-SignUp "Create account"), and only the fill and
  // the label change. It is only shown while disabled, and a disabled button is never pressed.
  // It mounts the first time the button is disabled and then stays for the crossfades.
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
  // The caustic shrinks to 60% while pressed (§11.4) and fades with the lit state (§10.1: no light
  // on a disabled control). The primary recipe's outer lens-blue glow (PRIMARY_SHADOW's
  // rgba(111,155,255,…) cast) is drawn on this same caustic layer (splitShadows), so a disabled
  // primary keeps its rim and contact shadow but throws no blue light; it returns over the same
  // 240ms swap as the fill when the button is enabled.
  const caustic = useDerivedValue(() => arrive.value * lit.value * (1 - 0.4 * Math.min(1, Math.max(0, progress.value))));

  const enabledSweep = useSweepOnEnable(!disabled);
  const [fired, setFired] = useState(0);
  const handlePress = () => {
    if (primary && sweepOnFire) setFired((n) => n + 1);
    onPress();
  };
  // sweepSignal: only an increase after mount plays, and only while the primary is enabled.
  const [signalled, setSignalled] = useState(0);
  const lastSignal = useRef(sweepSignal);
  useEffect(() => {
    const prev = lastSignal.current ?? 0;
    lastSignal.current = sweepSignal;
    if (sweepSignal !== undefined && sweepSignal > prev && primary && !off) setSignalled((n) => n + 1);
    // The signal is the trigger; the button's state is read as it is then.
  }, [sweepSignal]);
  const sweeps = enabledSweep + fired + signalled;

  const recipes: Record<ButtonVariant, [GlassRecipe, GlassRecipe] | null> = {
    primary: [glass.primary, glass.primaryPressed],
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
  const glyph: GlyphVariant = disabled ? 'muted' : primary ? 'ink' : 'face';

  return (
    <FocusPressable
      ref={ref}
      ringRadius={r}
      testID={testID}
      onPress={off ? undefined : handlePress}
      onPressIn={press.pressIn}
      onPressOut={press.pressOut}
      disabled={off}
      aria-disabled={off}
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy: !!loading || locked }}
      // react-native-web maps no accessibilityState: busy reaches the DOM as aria-busy.
      {...(Platform.OS === 'web' ? { 'aria-busy': !!loading || locked } : null)}
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={[styles.button, compact ? styles.compact : null, !primary && disabled ? styles.dim : null, style]}
    >
      {pair ? (
        <View style={[styles.layer, PASS_THROUGH]}>
          <GlassSurface recipe={pair[0]} pressedRecipe={compact ? { ...pair[1], radius: r } : pair[1]} radius={r} pressed={progress} pressShift={press.shift} caustic={primary ? caustic : undefined} grain={false} style={styles.layer} />
        </View>
      ) : null}
      {primary && unlitMounted ? (
        <Animated.View style={[styles.layer, PASS_THROUGH, unlitStyle]}>
          <GlassSurface recipe={glass.primaryDisabled} radius={r} grain={false} style={styles.layer} />
        </Animated.View>
      ) : null}
      {/* Mounted on its first sweep: most primaries never become enabled or fire on a screen. Never
          while disabled: a sweep in flight stops with the light, and enabling plays a fresh one. */}
      {primary && sweeps > 0 && !disabled ? <CausticSweep playKey={sweeps} radius={r} /> : null}
      <Animated.View style={[styles.buttonContent, compact ? styles.compactContent : null, press.motionStyle]}>
        {loading ? (
          <Spinner color={fg} />
        ) : icon ? (
          <KitIconView icon={icon} size={compact ? 18 : 20} variant={glyph} danger={variant === 'danger' && !disabled} color={fg} />
        ) : null}
        <Text variant="button" style={{ color: fg }}>
          {label}
        </Text>
      </Animated.View>
    </FocusPressable>
  );
}

const COMPACT_RADIUS = 14;

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  button: { minHeight: touch.button, borderRadius: radius.button, paddingHorizontal: 20, justifyContent: 'center' },
  // CONSISTENCY D2's compact action (44 on the board; 48, the repo's touch minimum).
  compact: { minHeight: TOUCH, borderRadius: COMPACT_RADIUS, paddingHorizontal: 14 },
  buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  compactContent: { gap: 8 },
  dim: { opacity: 0.55 },
});
