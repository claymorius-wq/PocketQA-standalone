import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { FlutedLens, GlassSurface } from '../../glass';
import { GlassTile, type GlyphName } from '../../icons';
import { useTheme } from '../../theme/ThemeProvider';
import type { Tone } from '../../theme/tokens';
import { Button } from '../button';
import { KitIconView, type KitIcon } from '../icon';

/** A glyph by name, or the Lucide/glyph component the screens already pass the kit. */
export type StateIcon = GlyphName | KitIcon;

function StateGlyph({ icon, size }: { icon: StateIcon; size: number }) {
  const { colors } = useTheme();
  return <KitIconView icon={icon} size={size} color={colors.rimLit} />;
}

export type EmptyPanelProps = {
  icon: StateIcon;
  title: string;
  body: string;
  /** A secondary action under the text ("Open settings", "Find studies"). Never primary, never lit. */
  action?: ReactNode;
  /**
   * `card` (default, A-States 02): an L1 card at k 0.8, the 72dp lens left of the text, the action
   * under them. `row`: inside a ListCard where the rows would be (Credits "History"): the 54dp
   * lens in a 64dp row. `page`: no card, the lens over the text (Session "You withdrew").
   */
  variant?: 'card' | 'row' | 'page';
  testID?: string;
};

/**
 * The empty state (A-States 02, Direction A §8 EmptyState, §9): the fluted lens with the state's
 * glyph floating in front of the refracted sphere at half the lens, the heading 16/22 600, the
 * body 14/20 muted. It resolves once (S1) on mount; empty is a fact, not an event, so it is never
 * lit and never loops. One lens per screen: the screen's header lens steps aside while it shows.
 */
export function EmptyPanel({ icon, title, body, action, variant = 'card', testID = 'empty-state' }: EmptyPanelProps) {
  const { colors, type } = useTheme();
  const lens = variant === 'row' ? 54 : 72;
  const text = (
    <View style={[styles.text, variant === 'row' ? styles.rowText : null]}>
      <RNText accessibilityRole="header" style={[type.heading, { color: colors.text }]}>{title}</RNText>
      <RNText style={[type.bodySm, { color: colors.textMuted }]}>{body}</RNText>
    </View>
  );
  const art = (
    <FlutedLens size={lens}>
      <StateGlyph icon={icon} size={lens / 2} />
    </FlutedLens>
  );
  if (variant === 'row') {
    return (
      <View testID={testID} style={styles.row}>
        {art}
        {text}
      </View>
    );
  }
  if (variant === 'page') {
    return (
      <View testID={testID} style={styles.page}>
        {art}
        {text}
        {action ? <View style={styles.action}>{action}</View> : null}
      </View>
    );
  }
  return (
    <GlassSurface level="card" k={0.8} testID={testID} style={styles.card}>
      <View style={styles.cardRow}>
        {art}
        {text}
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </GlassSurface>
  );
}

export type ErrorPanelProps = {
  /** The failure's glyph: offline, lock, fileWarning, alert. */
  glyph: GlyphName;
  /** The rim tint carries the meaning (danger by default); the glyph is never recoloured. */
  tint?: Tone;
  title: string;
  /** The server's message where there is one, verbatim. */
  body: string;
  /** Retry only where it can help (offline, other); never for not-allowed or not-found. */
  onRetry?: () => void;
  retryLabel?: string;
  /** While the retry is in flight: the button keeps its label and shows the spinner. */
  retrying?: boolean;
  retryTestID?: string;
  testID?: string;
};

/**
 * A failed load (A-States 04, "No lens for a failure"): the lens means looking, and an error means
 * the app could not look, so the card takes a 54dp glyph tile with a tinted rim instead and the
 * title steps up to 19/24. Retry is secondary, never primary. Never lit, never shaken: the tint
 * lives in the rim only.
 */
export function ErrorPanel({ glyph, tint = 'danger', title, body, onRetry, retryLabel = 'Retry', retrying = false, retryTestID = 'retry-button', testID = 'error-state' }: ErrorPanelProps) {
  const { colors, type } = useTheme();
  return (
    <GlassSurface level="card" k={0.8} testID={testID} style={styles.card}>
      <View style={styles.cardRow}>
        <GlassTile name={glyph} size="hero" tint={tint} />
        <View style={styles.text}>
          <RNText accessibilityRole="header" style={[type.title, { color: colors.text }]}>{title}</RNText>
          <RNText style={[type.bodySm, { color: colors.textMuted }]}>{body}</RNText>
        </View>
      </View>
      {onRetry ? (
        <View style={styles.retry}>
          <Button label={retryLabel} variant="secondary" onPress={onRetry} loading={retrying} testID={retryTestID} />
        </View>
      ) : null}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  // Board padding 20 18 20 20 inside the rim; 18 between lens and text; at least 136 tall.
  card: { paddingTop: 19, paddingRight: 17, paddingBottom: 19, paddingLeft: 19, minHeight: 136, justifyContent: 'center' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  text: { flex: 1, minWidth: 0, gap: 4 },
  rowText: { gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 64, paddingVertical: 5, paddingHorizontal: 16 },
  page: { gap: 14, paddingVertical: 32, paddingHorizontal: 24 },
  action: { marginTop: 18, alignSelf: 'flex-start' },
  retry: { marginTop: 16, alignSelf: 'flex-start' },
});
