import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, Text as RNText, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { GlassSurface } from '../../glass';
import { GradientRule } from '../../glass/paint';
import { GlassTile, type GlyphName, type GlyphVariant } from '../../icons';
import { usePressMotion } from '../../motion';
import { useTheme } from '../../theme/ThemeProvider';
import { radius, type Tone } from '../../theme/tokens';
import { FocusPressable } from '../focus';
import { Meta } from './type';

/**
 * The list-row hairline (§8 list row): a 1dp line that fades out toward the far side, away from
 * the key light. Drawn on top of a row, `inset` from its left edge (16 for rows, 64 past a
 * timeline's nodes). Light theme: the flat border colour.
 */
export function Hairline({ inset = 16, style }: { inset?: number; style?: StyleProp<ViewStyle> }) {
  const { glass } = useTheme();
  return <GradientRule stops={glass.divider.stops} style={[styles.hairline, { left: inset }, style]} />;
}

export type ListRowProps = {
  /** The leading 40dp glyph tile; meaning rides on its rim `tint`, never on the glyph colour. */
  glyph?: GlyphName;
  tint?: Tone;
  /** `rose` for danger glyphs (Stop, Remove, Reject). */
  glyphVariant?: GlyphVariant;
  title: string;
  /** A short readout under the title: a string is set in DM Mono (≤ 3 words), or pass DateText / Clauses. */
  meta?: ReactNode;
  /** The row's end: an Amount, a compact pill, a 44dp action (Moderation's Suspend / Reinstate). */
  trailing?: ReactNode;
  /** Makes the whole row one button (Stuck "Next in queue"). Keep `trailing` free of buttons then. */
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  /** Set by ListCard: rows after the first draw the hairline on their top edge. */
  divided?: boolean;
  /** The title steps back (A-Moderation's suspended rows): `textDim` instead of the text colour. */
  dim?: boolean;
  /** `ledger`: the taller row of a ledger (A-Moderation): min 72, padding 12/14/12/16. */
  density?: 'default' | 'ledger';
};

/**
 * One list row (§8, CONSISTENCY C6): min 64dp, 16 padding, the 40dp glyph tile, the title in
 * Instrument Sans 600 15/22, meta under it, and an optional trailing element. Rows sit in one
 * ListCard. A pressable row sinks 1dp down-right while pressed (not under reduced motion).
 */
export function ListRow({ glyph, tint, glyphVariant, title, meta, trailing, onPress, accessibilityLabel, testID, divided = false, dim = false, density = 'default' }: ListRowProps) {
  const { colors, type } = useTheme();
  const press = usePressMotion(!onPress);
  const body = (
    <>
      {divided ? <Hairline /> : null}
      {glyph ? <GlassTile name={glyph} size="list" tint={tint} variant={glyphVariant} /> : null}
      <View style={styles.text}>
        <RNText numberOfLines={2} style={[type.heading, styles.title, { color: dim ? colors.textDim : colors.text }]}>{title}</RNText>
        {meta === undefined || meta === null ? null : typeof meta === 'string' ? <Meta>{meta}</Meta> : meta}
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </>
  );
  if (!onPress) {
    return (
      <View testID={testID} style={[styles.row, density === 'ledger' ? styles.ledger : null]}>
        {body}
      </View>
    );
  }
  return (
    // C1: the ring follows the row's own corners, the ListCard's 24 inset by its 4dp padding.
    <FocusPressable ringRadius={ROW_RADIUS} testID={testID} onPress={onPress} onPressIn={press.pressIn} onPressOut={press.pressOut} accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? title}>
      <Animated.View style={[styles.row, density === 'ledger' ? styles.ledger : null, press.motionStyle]}>{body}</Animated.View>
    </FocusPressable>
  );
}

/**
 * One L1 card that holds a list of ListRows (Credits history, Moderation sections, Stuck queue,
 * Settings): rows are divided by the fading hairline, never by gaps between separate cards.
 */
export function ListCard({ children, k, testID, padding = LIST_CARD_PADDING }: { children: ReactNode; k?: number; testID?: string; padding?: number }) {
  const rows = Children.toArray(children).filter(isValidElement) as ReactElement<ListRowProps>[];
  return (
    <GlassSurface level="card" k={k} testID={testID} style={[styles.card, { paddingVertical: padding }]} role="list">
      {rows.map((row, i) => (
        <View key={row.key ?? i} role="listitem">
          {row.type === ListRow ? <ListRow {...row.props} divided={i > 0} /> : row}
        </View>
      ))}
    </GlassSurface>
  );
}

const LIST_CARD_PADDING = 4;
const ROW_RADIUS = radius.card - LIST_CARD_PADDING;

const styles = StyleSheet.create({
  hairline: { position: 'absolute', right: 0, top: 0, height: 1 },
  card: { borderRadius: 24 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10, paddingHorizontal: 16 },
  ledger: { minHeight: 72, paddingTop: 12, paddingRight: 14, paddingBottom: 12, paddingLeft: 16 },
  text: { flex: 1, minWidth: 0, gap: 2 },
  // Instrument Sans 600 15/22 (C6 "list / card row title"): the heading face at the body size.
  title: { fontSize: 15 },
  trailing: { flexShrink: 0, alignItems: 'flex-end' },
});
