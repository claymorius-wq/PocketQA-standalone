import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, Text as RNText, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import { Well } from '../../glass';
import { useTheme } from '../../theme/ThemeProvider';
import { Hairline } from './ListRow';
import { MeterSwatch, type MeterMaterial } from './meter';

export type KeyValueProps = {
  /** The term, Instrument Sans 14/20 muted ("Awarded"). */
  label: string;
  /** The figure, Red Hat Display 400 18/24 tabular. Numbers are grouped ("1,000"). */
  value: string | number;
  /** A legend pip in the meter's material, so the row explains the meter under it. */
  swatch?: MeterMaterial;
  testID?: string;
  /** testID on the value text (the screens' `budget-awarded`, `budget-available`). */
  valueTestID?: string;
  /** Set by KeyValueList: rows after the first draw the hairline on their top edge. */
  divided?: boolean;
  /** Extra style on the figure alone, animated styles included (a screen's settle or cross-fade moves only the number). */
  valueStyle?: ValueStyle;
};

/** A style for the figure: plain, or a Reanimated animated style. */
export type ValueStyle = StyleProp<AnimatedStyle<StyleProp<TextStyle>>>;

const show = (v: string | number) => (typeof v === 'number' ? v.toLocaleString('en-US') : v);

/** One term and its figure on a 36dp line (A-BStudy budget card). */
export function KeyValue({ label, value, swatch, testID, valueTestID, divided = false, valueStyle }: KeyValueProps) {
  const { colors, type } = useTheme();
  return (
    <View testID={testID} style={styles.row} accessible accessibilityLabel={`${label}: ${show(value)}`}>
      {divided ? <Hairline inset={0} /> : null}
      {swatch ? <MeterSwatch material={swatch} /> : null}
      <RNText style={[type.bodySm, styles.label, { color: colors.textMuted }]}>{label}</RNText>
      <Animated.Text testID={valueTestID} style={[type.amount, { color: colors.text }, valueStyle]}>{show(value)}</Animated.Text>
    </View>
  );
}

/** A stack of KeyValue rows divided by the fading hairline (a definition list). */
export function KeyValueList({ children, style, testID }: { children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  const rows = Children.toArray(children).filter(isValidElement) as ReactElement<KeyValueProps>[];
  return (
    <View testID={testID} style={[styles.list, style]}>
      {rows.map((row, i) => (row.type === KeyValue ? <KeyValue key={row.key ?? i} {...row.props} divided={i > 0} /> : row))}
    </View>
  );
}

/**
 * The lead figure of a group (A-BStudy "Reserved"): the term over a Red Hat Display 300 44/44
 * numeral, recessed in a lens well. The KeyValue rows beside it break the total down.
 */
export function KeyFigure({ label, value, testID, valueTestID, style, valueStyle }: { label: string; value: string | number; testID?: string; valueTestID?: string; style?: StyleProp<ViewStyle>; valueStyle?: ValueStyle }) {
  const { colors, type } = useTheme();
  return (
    <Well testID={testID} accessible accessibilityLabel={`${label}: ${show(value)}`} style={[styles.figure, style]}>
      <RNText style={[type.small, { color: colors.textMuted }]}>{label}</RNText>
      <Animated.Text testID={valueTestID} adjustsFontSizeToFit numberOfLines={1} style={[type.numeralXl, styles.figureValue, { color: colors.numeral }, valueStyle]}>
        {show(value)}
      </Animated.Text>
    </Well>
  );
}

const styles = StyleSheet.create({
  list: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 },
  label: { flex: 1 },
  // Board: padding 12 14 inside the rim, 8 between term and figure, at least 108 tall.
  figure: { gap: 8, minHeight: 108, paddingVertical: 12, paddingHorizontal: 14 },
  // Red Hat Display 300 at 44/44 (between numeral 38 and numeral-xl 56 in the scale).
  // A-BStudy "Reserved": Red Hat Display 300 44/44, letter-spacing −1.4.
  figureValue: { fontSize: 44, lineHeight: 44, letterSpacing: -1.4 },
});
