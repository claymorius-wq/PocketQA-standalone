import { createElement } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { GOOGLE_G_SVG } from '../../auth/googleG';
import { usePressMotion } from '../../motion';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, touch } from '../../theme/tokens';
import { FocusPressable } from '../focus';
import { Spinner } from '../spinner';
import { Text } from '../text';

// The Sign in with Google button (brand guidelines,
// https://developers.google.com/identity/branding-guidelines, read 2026-10-06). Google's colours,
// the app's shape:
//   - Google's approved theme for the app's scheme, exactly: light #FFFFFF fill, 1px #747775
//     stroke, #1F1F1F text; dark #131314 fill, 1px #8E918F stroke, #E3E3E3 text. Never the kit's
//     glass, so the G always sits on a Google-approved surface.
//   - Google's own G, byte for byte (src/auth/googleG.ts): the 20-unit G region of Google's icon
//     button for that theme, whose fill is the same as the button's, at its standard 20px size.
//   - One of the approved labels, 14/20 (Google's size) in the app's button face. Google Sans is
//     not licensed for this app.
//   - The kit's shape and behaviour: full width, 52 tall (≥ 44), the button radius, the lens focus
//     ring, press motion; busy swaps the G for a spinner (aria-busy) and ignores presses; disabled
//     dims the whole control (the kit's 0.55, as every non-primary).
// The label is the accessible name; the G is hidden from assistive tech.
//
// Web only in practice: Google sign-in is offered on web (the Firebase popup). The G is a DOM
// <img> of the SVG data URI (img-src allows data:): Chromium and WebKit both draw its conic
// gradient, react-native-web's Image never loaded it, and native image views do not draw SVG.

const LABELS = { continue: 'Continue with Google', signIn: 'Sign in with Google', signUp: 'Sign up with Google' } as const;

/** Google's approved button themes (light / dark), exact. */
export const GOOGLE_THEME = {
  light: { fill: '#FFFFFF', stroke: '#747775', text: '#1F1F1F' },
  dark: { fill: '#131314', stroke: '#8E918F', text: '#E3E3E3' },
} as const;

export type GoogleButtonProps = {
  /** The approved wording: "Continue with Google" (sign in), "Sign up with Google" (sign up). */
  intent: keyof typeof LABELS;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  /** The button's id; the G is `${testID}-logo`. */
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

/** The G at Google's 20px: its 20-unit region of the 40-unit asset, drawn at 1:1. */
const G = 20;
const ASSET = 40;
const uri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
const G_URI = { light: uri(GOOGLE_G_SVG.light), dark: uri(GOOGLE_G_SVG.dark) };

export function GoogleButton({ intent, onPress, loading, disabled, testID, style }: GoogleButtonProps) {
  const { scheme } = useTheme();
  const theme = GOOGLE_THEME[scheme];
  const off = !!(disabled || loading);
  const press = usePressMotion(off);
  const progress = press.progress;
  // Pressed: Google's state layer, the text colour at 12% over the fill.
  const pressedLayer = useAnimatedStyle(() => ({ opacity: 0.12 * Math.min(1, Math.max(0, progress.value)) }));

  return (
    <FocusPressable
      ringRadius={radius.button}
      testID={testID}
      onPress={off ? undefined : onPress}
      onPressIn={press.pressIn}
      onPressOut={press.pressOut}
      disabled={off}
      aria-disabled={off}
      accessibilityRole="button"
      accessibilityLabel={LABELS[intent]}
      accessibilityState={{ disabled: off, busy: !!loading }}
      {...(Platform.OS === 'web' ? { 'aria-busy': !!loading } : null)}
      style={[styles.button, { backgroundColor: theme.fill, borderColor: theme.stroke }, disabled ? styles.dim : null, style]}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.layer, { backgroundColor: theme.text }, pressedLayer]} />
      <Animated.View style={[styles.content, press.motionStyle]}>
        {loading ? (
          <Spinner color={theme.text} />
        ) : (
          <View testID={testID ? `${testID}-logo` : undefined} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={styles.g}>
            {Platform.OS === 'web'
              ? createElement('img', {
                  src: G_URI[scheme],
                  width: ASSET,
                  height: ASSET,
                  alt: '',
                  draggable: false,
                  // The asset's G spans units 10–30 of its 40 box: shift it so that region fills the 20px frame.
                  style: { display: 'block', width: ASSET, height: ASSET, margin: -(ASSET - G) / 2 },
                })
              : null}
          </View>
        )}
        <Text variant="button" style={[styles.label, { color: theme.text }]}>
          {LABELS[intent]}
        </Text>
      </Animated.View>
    </FocusPressable>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: touch.button, borderRadius: radius.button, borderWidth: 1, paddingHorizontal: 12, justifyContent: 'center', overflow: 'hidden' },
  layer: { borderRadius: radius.button },
  // Google's spacing: 10 between the G and the label.
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  g: { width: G, height: G, overflow: 'hidden' },
  label: { fontSize: 14, lineHeight: 20 },
  dim: { opacity: 0.55 },
});
