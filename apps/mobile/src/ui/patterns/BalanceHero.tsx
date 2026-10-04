import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { GlassSurface, useUplight } from '../../glass';
import { HIDDEN, PASS_THROUGH } from '../../glass/paint';
import { groupDigits, NumberRoll } from '../../motion';
import { useTheme } from '../../theme/ThemeProvider';
import { layout } from '../../theme/tokens';
import { Text } from '../text';
import { UnderGlow } from './light';

/** "1 test credit", "1,000 test credits": the same words as lib/format `credits()`. */
export const creditsSuffix = (n: number) => (n === 1 ? ' test credit' : ' test credits');

export type BalanceHeroProps = {
  /** The balance in test credits (`useCredits().data.balance`). */
  balance: number;
  /** The DM Mono label above the numeral; uppercased here (the source text stays sentence case). */
  label?: string;
  /** The 13/18 line under the numeral (the API's disclaimer plus "Credits can’t be withdrawn or exchanged."). */
  disclaimer?: ReactNode;
  /**
   * U5 Earned: approved credits landed while the balance is in view. The light rises 0 → 1 over
   * 560ms ease-uplight and settles at 0.45; the numeral rolls (S5) to the new value. The screen
   * decides when credits have landed; this component never infers it.
   */
  earned?: boolean;
  /** The Earned moment was already shown (a revisit): render it at rest (0.45), no rise. */
  seen?: boolean;
  /** False holds the roll (the screen is not focused); the value still updates. */
  play?: boolean;
  /** The card (the screens' `balance-card`). */
  testID?: string;
  /** The numeral; its text is exactly "1,000 test credits" at rest (e2e `credit-balance`). */
  balanceTestID?: string;
  /**
   * The outer wrapper: e.g. `{ marginBottom }` where the next element is not History (Budget puts
   * its top-up card 16 below). Default: the D1 clearance, 32 while lit and 24 otherwise.
   */
  style?: StyleProp<ViewStyle>;
};

/**
 * The balance that leads Credits and Budget (CONSISTENCY.md D1, A-Credits): an L1 card directly
 * under the header with "BALANCE" over the numeral at numeral-xl (56/56). When approved credits
 * land in view it is U5 in Mode A: the card carries the uplit layer, an under-glow sits on its
 * bottom edge, and a pre-rendered lit copy of the numeral (the one text shadow RN draws, §10.3)
 * fades in with the light, so no text shadow animates per frame. Keep ≥ 32dp below it while lit.
 * Reduced motion: the light shows at its resting 0.45 and the value lands at once.
 */
export function BalanceHero({ balance, label = 'Balance', disclaimer, earned = false, seen = false, play = true, testID = 'balance-card', balanceTestID = 'credit-balance', style }: BalanceHeroProps) {
  const { colors, glass, type } = useTheme();
  const light = useUplight('earned', earned, { startAtRest: seen });
  const litStyle = useAnimatedStyle(() => ({ opacity: light.u.value }));
  const numeral = [type.numeralXl, { color: colors.numeral }];
  return (
    // D1, §U: 32dp of ground below the card while it is lit (the under-glow spills 28 below it), 24
    // otherwise, before History; the screen's list gap already gives part of it.
    <View style={[styles.wrap, (earned || seen) && glass.enabled ? styles.litClearance : styles.clearance, style]}>
      <UnderGlow light={light} />
      <GlassSurface level="card" k={1} uplight={light.enabled ? light.u : undefined} style={styles.card} testID={testID}>
        <Text variant="label" tone="muted">{label.toUpperCase()}</Text>
        <View style={styles.figure}>
          {light.enabled ? (
            <Animated.View {...HIDDEN} style={[styles.lit, PASS_THROUGH, litStyle]}>
              <RNText style={[numeral, glass.uplight.numeral(1)]}>{groupDigits(balance)}</RNText>
            </Animated.View>
          ) : null}
          {/* The board's polite live region: the new balance is announced once when it changes. */}
          <View accessibilityLiveRegion="polite">
            <NumberRoll
              value={balance}
              suffix={creditsSuffix}
              style={numeral}
              suffixStyle={[type.body, styles.suffix, { color: colors.textMuted }]}
              containerStyle={styles.roll}
              testID={balanceTestID}
              play={play}
            />
          </View>
        </View>
        {disclaimer ? (
          typeof disclaimer === 'string' ? (
            <Text variant="small" tone="muted" style={styles.disclaimer}>{disclaimer}</Text>
          ) : (
            disclaimer
          )
        ) : null}
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  litClearance: { marginBottom: 32 - layout.listGap },
  clearance: { marginBottom: 24 - layout.listGap },
  // Board padding 14 18 16 inside the 1dp rim, 8dp between label, numeral and disclaimer.
  card: { paddingTop: 14, paddingRight: 18, paddingBottom: 16, paddingLeft: 18, gap: 8 },
  figure: { position: 'relative' },
  lit: { position: 'absolute', left: 0, top: 0 },
  roll: { alignItems: 'flex-end' },
  // Board gap 10 between the numeral and its unit; the suffix's leading space carries ~4 of it.
  suffix: { marginLeft: 6 },
  disclaimer: { maxWidth: 300 },
});
