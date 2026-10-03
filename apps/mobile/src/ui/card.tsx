import { useContext, type ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { GlassSurface } from '../glass';
import { usePressMotion } from '../motion';
import { layout, radius, space, TOUCH } from '../theme/tokens';
import { FocusPressable } from './focus';
import { EnterContext } from './screen';

// The kit's L1 card (a leaf module: the kit and the patterns both import it, without a cycle).

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
  // The whole card is the button; the glass sinks into the pressed recipe (§4 Pressed, C5).
  return (
    <FocusPressable ringRadius={radius.card} testID={testID} onPress={onPress} onPressIn={press.pressIn} onPressOut={press.pressOut} accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={styles.touch}>
      <GlassSurface level="card" k={distance} pressed={press.progress} pressShift={press.shift} style={[styles.card, styles.touch, style]}>
        {children}
      </GlassSurface>
    </FocusPressable>
  );
}

const styles = StyleSheet.create({
  touch: { minHeight: TOUCH },
  card: {
    borderRadius: radius.card,
    paddingTop: layout.cardPadding.top,
    paddingRight: layout.cardPadding.right,
    paddingBottom: layout.cardPadding.bottom,
    paddingLeft: layout.cardPadding.left,
    gap: space.sm,
  },
});
