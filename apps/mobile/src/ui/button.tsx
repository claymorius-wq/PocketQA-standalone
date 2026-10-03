import { useContext, useEffect, useState } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useDerivedValue, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { CausticSweep, GlassSurface, useSweepOnEnable } from '../glass';
import { PASS_THROUGH } from '../glass/paint';
import type { GlyphVariant } from '../icons';
import { usePressMotion } from '../motion';
import { DUR } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { radius, touch, type GlassSurface as GlassRecipe } from '../theme/tokens';
import { FocusPressable } from './focus';
import { KitIconView, type KitIcon } from './icon';
import { EnterContext } from './screen';
import { Spinner } from './spinner';
import { Text } from './text';

// The kit's one button (a leaf module: the kit and the patterns both import it, without a cycle).

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: KitIcon;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Button recipes (§8): primary is lit blue glass with the down-right caustic; disabled is unlit
 * glass (a 240ms crossfade of the two layers, never an opacity fade) and turning enabled plays
 * the caustic sweep, as does firing; busy keeps the label and swaps the icon for the spinner
 * (CONSISTENCY C4, C7). Secondary is raised glass, danger is dark rose glass (never lit from
 * below), ghost is text. Glyphs (G3): `ink` on the primary fill, `muted` while disabled, rose for
 * the destructive glyphs on danger, `face` otherwise.
 */
export function Button({ label, onPress, variant = 'primary', icon, loading, disabled, testID, accessibilityHint, style }: ButtonProps) {
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
      ringRadius={radius.button}
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
        <Animated.View style={[styles.layer, PASS_THROUGH, unlitStyle]}>
          <GlassSurface recipe={glass.primaryDisabled} grain={false} style={styles.layer} />
        </Animated.View>
      ) : null}
      {pair ? (
        <Animated.View style={[styles.layer, PASS_THROUGH, primary ? litStyle : null]}>
          <GlassSurface recipe={pair[0]} pressedRecipe={pair[1]} pressed={progress} pressShift={press.shift} caustic={primary ? caustic : undefined} grain={false} style={styles.layer} />
        </Animated.View>
      ) : null}
      {/* Mounted on its first sweep: most primaries never become enabled or fire on a screen. */}
      {primary && enabledSweep + fired > 0 ? <CausticSweep playKey={enabledSweep + fired} radius={radius.button} /> : null}
      <Animated.View style={[styles.buttonContent, press.motionStyle]}>
        {loading ? (
          <Spinner color={fg} />
        ) : icon ? (
          <KitIconView icon={icon} size={20} variant={glyph} danger={variant === 'danger' && !disabled} color={fg} />
        ) : null}
        <Text variant="button" style={{ color: fg }}>
          {label}
        </Text>
      </Animated.View>
    </FocusPressable>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  button: { minHeight: touch.button, borderRadius: radius.button, paddingHorizontal: 20, justifyContent: 'center' },
  buttonContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  dim: { opacity: 0.55 },
});
