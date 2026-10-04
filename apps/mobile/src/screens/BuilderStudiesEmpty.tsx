import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { FlutedLens, GlassSurface } from '../glass';
import { useTheme } from '../theme/ThemeProvider';
import { KitIconView, type KitIcon } from '../ui/icon';
import { PRETTY_BREAK, PRETTY_WRAP } from '../ui/text';

const LENS = 72;

/**
 * The Builder Studies empty card (A-BStudies "isEmpty"): the kit EmptyState's parts (an L1 card at
 * k 0.8, the 72dp fluted lens with the glyph at half the lens, the heading 16/22 600, the body
 * 14/20 muted, a secondary action) in the board's stacked layout. The lens and the title share a
 * row, the title centred on the lens; the body runs the card's full width 16 under that row; the
 * action sits 18 under the body. Resolves once (S1), never lit. Keeps the kit's `empty-state` testID.
 */
export function BuilderStudiesEmpty({ icon, title, body, action, testID = 'empty-state' }: { icon: KitIcon; title: string; body: string; action?: ReactNode; testID?: string }) {
  const { colors, type } = useTheme();
  return (
    <GlassSurface level="card" k={0.8} testID={testID} style={styles.card}>
      <View style={styles.head}>
        <FlutedLens size={LENS}>
          <KitIconView icon={icon} size={LENS / 2} color={colors.rimLit} />
        </FlutedLens>
        <RNText accessibilityRole="header" style={[type.heading, styles.title, { color: colors.text }]}>{title}</RNText>
      </View>
      <RNText textBreakStrategy={PRETTY_BREAK} style={[type.bodySm, styles.body, { color: colors.textMuted }, PRETTY_WRAP]}>{body}</RNText>
      {action ? <View style={styles.action}>{action}</View> : null}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  // Board padding 20 all round inside the 1dp rim; 18 between the lens and the title.
  card: { paddingTop: 19, paddingRight: 19, paddingBottom: 19, paddingLeft: 19 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  title: { flex: 1, minWidth: 0 },
  body: { marginTop: 16 },
  action: { marginTop: 18, alignSelf: 'flex-start' },
});
