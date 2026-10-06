import { createElement } from 'react';
import { Image, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GOOGLE_G_SVG } from '../../auth/googleG';
import { Button } from '../button';

// The branded Google sign-in button (Sign in with Google brand guidelines,
// https://developers.google.com/identity/branding-guidelines, read 2026-10-06): the kit's
// secondary button (full width, 52 tall, its radius, focus ring, press motion, busy and disabled
// states) with Google's own G on its left and one of Google's approved labels. The G is the
// official asset byte for byte (src/auth/googleG.ts): the standard color super G on its white
// tile, so it sits on white in the light and the dark theme alike, and it is never redrawn,
// recolored or tinted by the kit. Disabled dims the whole control like every non-primary button;
// busy swaps the G for the spinner and keeps the label.
//
// Web only in practice: Google sign-in is offered on web (the Firebase popup). There the asset is a
// plain DOM <img> of an SVG data URI (img-src allows data:), which Chromium and WebKit both draw
// with its conic gradient; react-native-web's Image never loaded that URI (no background, no img),
// so it is not used on web. Native image views do not draw SVG at all.

const LABELS = { continue: 'Continue with Google', signIn: 'Sign in with Google', signUp: 'Sign up with Google' } as const;

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

const G_URI = `data:image/svg+xml;utf8,${encodeURIComponent(GOOGLE_G_SVG)}`;
/** The asset's 40 box drawn at 32 (its 20-unit G at 16), inside the button's 52 height. */
const G_SIZE = 32;

export function GoogleButton({ intent, onPress, loading, disabled, testID, style }: GoogleButtonProps) {
  return (
    <Button
      label={LABELS[intent]}
      variant="secondary"
      onPress={onPress}
      loading={loading}
      disabled={disabled}
      testID={testID}
      style={style}
      leading={
        <View testID={testID ? `${testID}-logo` : undefined} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden style={styles.g}>
          {Platform.OS === 'web' ? (
            createElement('img', { src: G_URI, width: G_SIZE, height: G_SIZE, alt: '', draggable: false, style: { display: 'block', width: G_SIZE, height: G_SIZE } })
          ) : (
            <Image source={{ uri: G_URI, width: G_SIZE, height: G_SIZE }} style={styles.g} resizeMode="contain" />
          )}
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  g: { width: G_SIZE, height: G_SIZE },
});
