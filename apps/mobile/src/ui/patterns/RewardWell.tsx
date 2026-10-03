import { StyleSheet, Text as RNText, View, type StyleProp, type ViewStyle } from 'react-native';
import { Well } from '../../glass';
import { useTheme } from '../../theme/ThemeProvider';

export type RewardWellProps = {
  /** The reward in test credits (the screens' `rewardCredits`). */
  amount: number;
  /**
   * The unit lines beside the numeral. One line sits on the numeral's baseline (Discover:
   * "test credits"); two lines stack beside it (My work: "test credits" / "if approved").
   */
  unit?: string | readonly [string, string];
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * The reward numeral recessed in a lens well (A-Discover study card, A-Work session card;
 * Direction A §5 `numeral`, §4 L-1 Well): Red Hat Display 300 38/42 in `numeral` on the well
 * floor, the unit 13/18 muted. Numerals are recessed, never lit: only the U5/U6 balance is lit
 * (BalanceHero). Screen readers hear one phrase, "50 test credits if approved".
 */
export function RewardWell({ amount, unit = 'test credits', testID, style }: RewardWellProps) {
  const { colors, type } = useTheme();
  const lines = typeof unit === 'string' ? [unit] : unit;
  const stacked = lines.length > 1;
  const value = amount.toLocaleString('en-US');
  return (
    <Well
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${value} ${lines.join(' ')}`}
      style={[styles.well, style]}
    >
      <View style={[styles.row, stacked ? styles.center : styles.baseline]}>
        <RNText style={[type.numeral, { color: colors.numeral }]}>{value}</RNText>
        {stacked ? (
          <View>
            {lines.map((l) => (
              <RNText key={l} style={[type.small, styles.stackedLine, { color: colors.textMuted }]}>
                {l}
              </RNText>
            ))}
          </View>
        ) : (
          <RNText style={[type.small, { color: colors.textMuted }]}>{lines[0]}</RNText>
        )}
      </View>
    </Well>
  );
}

const styles = StyleSheet.create({
  // Board padding 6 16 8 14 inside the well's 1dp rim (the Well keeps CSS's transparent border).
  well: { alignSelf: 'flex-start', paddingTop: 6, paddingRight: 16, paddingBottom: 8, paddingLeft: 14 },
  row: { flexDirection: 'row' },
  baseline: { alignItems: 'baseline', gap: 8 },
  center: { alignItems: 'center', gap: 10 },
  // My work stacks the unit at 13/17 so the two lines sit inside the numeral's 42dp line.
  stackedLine: { lineHeight: 17 },
});
