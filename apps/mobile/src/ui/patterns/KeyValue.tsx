import { Children, isValidElement, useState, type ReactElement, type ReactNode } from 'react';
import { Platform, StyleSheet, Text as RNText, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
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

/** The lead numeral: Red Hat Display 300 44/44, letter-spacing −1.4 (A-BStudy "Reserved"). */
const FIGURE_SIZE = 44;
const FIGURE_TRACKING = -1.4;
const WEB = Platform.OS === 'web';

/**
 * The lead numeral's size on web, where react-native-web ignores `adjustsFontSizeToFit`: the
 * largest size up to 44 at which `text` fits `width`, never below 16. Red Hat Display figures are
 * taken as 0.6em and a group comma as 0.27em (rounded up), so a large reserve shrinks to fit instead
 * of ending in an ellipsis. Native keeps `adjustsFontSizeToFit`.
 */
export function webFigureSize(text: string, width: number): number {
  if (width <= 0) return FIGURE_SIZE;
  const separators = text.replace(/[0-9]/g, '').length;
  const ems = (text.length - separators) * 0.6 + separators * 0.27;
  const fit = (width - FIGURE_TRACKING * (text.length - 1)) / ems;
  return Math.max(16, Math.min(FIGURE_SIZE, Math.floor(fit)));
}

/**
 * The lead figure of a group (A-BStudy "Reserved"): the term over a Red Hat Display 300 44/44
 * numeral, recessed in a lens well. The KeyValue rows beside it break the total down.
 */
export function KeyFigure({ label, value, testID, valueTestID, style, valueStyle }: { label: string; value: string | number; testID?: string; valueTestID?: string; style?: StyleProp<ViewStyle>; valueStyle?: ValueStyle }) {
  const { colors, type } = useTheme();
  const text = show(value);
  // Web: the numeral's column width, measured, sets its size (it stretches across the well, so the
  // width never depends on the size).
  const [width, setWidth] = useState(0);
  const size = WEB ? webFigureSize(text, width) : FIGURE_SIZE;
  return (
    <Well testID={testID} accessible accessibilityLabel={`${label}: ${text}`} style={[styles.figure, style]}>
      <RNText style={[type.small, { color: colors.textMuted }]}>{label}</RNText>
      <Animated.Text
        testID={valueTestID}
        adjustsFontSizeToFit
        numberOfLines={1}
        onLayout={WEB ? (e) => setWidth(e.nativeEvent.layout.width) : undefined}
        style={[type.numeralXl, styles.figureValue, size < FIGURE_SIZE ? { fontSize: size } : null, { color: colors.numeral }, valueStyle]}
      >
        {text}
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
  figureValue: { fontSize: FIGURE_SIZE, lineHeight: FIGURE_SIZE, letterSpacing: FIGURE_TRACKING },
});
