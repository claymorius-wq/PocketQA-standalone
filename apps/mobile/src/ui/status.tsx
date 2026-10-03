import type { ReactNode } from 'react';
import { Platform, StyleSheet, View, type TextStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { GlassSurface } from '../glass';
import { GlassTile, type GlyphName } from '../icons';
import { LiveLed } from '../motion';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { Enter, useMountedLate, useScreenFocused, useSwapFade } from './screen';
import { Text } from './text';

// Status pills and notices (a leaf module: the kit and the patterns both import it, without a cycle).

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  draft: 'neutral',
  published: 'success',
  paused: 'warning',
  closed: 'neutral',
  consented: 'info',
  in_progress: 'info',
  submitted: 'warning',
  approved: 'success',
  rejected: 'danger',
  disputed: 'warning',
  resolved: 'neutral',
  withdrawn: 'neutral',
  open: 'warning',
  uploading: 'warning',
  awaiting_signature: 'info',
  pending: 'warning',
  confirmed: 'success',
  failed: 'danger',
  expired: 'neutral',
  suspended: 'danger',
  ok: 'success',
};
/**
 * Statuses that carry the live LED (§8): only work genuinely happening now (IN PROGRESS,
 * UPLOADING). Never 'pending' (§14: pending never celebrates). Pills are never uplit.
 */
const LIVE_STATUS = new Set(['in_progress', 'uploading']);

/** Read by screen readers, never drawn (C8's visually hidden "Status: "). RN has no `clip`; 1×1, clipped and transparent does the same. */
const VISUALLY_HIDDEN: TextStyle = { position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, overflow: 'hidden', opacity: 0 };
const WEB = Platform.OS === 'web';

export function StatusPill({ status, label, testID, live }: { status: string; label?: string; testID?: string; live?: boolean }) {
  const { colors, glass } = useTheme();
  // The LED loop runs only while its screen is focused: tab scenes stay mounted when unfocused.
  const focused = useScreenFocused();
  const tone = STATUS_TONE[status] ?? 'neutral';
  const fg = colors[tone];
  const text = label ?? status.replace(/_/g, ' ');
  // A status change swaps the pill content in 120ms, no other motion (§14: pending never celebrates).
  const swap = useSwapFade(`${status}|${text}`);
  // C8: never aria-label on a span. Web reads a visually hidden "Status: " before the label; native
  // keeps the label on the pill, which is one accessibility element there.
  return (
    <GlassSurface recipe={glass.pill(tone)} grain={false} style={styles.pill} testID={testID} accessibilityLabel={WEB ? undefined : `Status: ${text}`}>
      <Animated.View style={[styles.pillRow, swap]}>
        {(live ?? LIVE_STATUS.has(status)) ? <LiveLed color={fg} shadow={glass.ledShadow(tone)} active={focused} /> : null}
        {WEB ? <Text variant="label" style={VISUALLY_HIDDEN}>Status: </Text> : null}
        <Text variant="label" style={{ color: fg }}>{text.toUpperCase()}</Text>
      </Animated.View>
    </GlassSurface>
  );
}

/** Notice glyph per tone (§8: success uses Approve, not Info). */
const NOTICE_GLYPH: Record<'info' | 'warning' | 'danger' | 'success', GlyphName> = { info: 'info', warning: 'warning', danger: 'alert', success: 'approve' };

export function Notice({ tone = 'info', title, children, testID }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title: string; children?: ReactNode; testID?: string }) {
  const { colors, glass } = useTheme();
  const late = useMountedLate();
  // No side stripe: meaning rides on the tinted rim and the glyph tile's rim (§7.5, §8).
  const notice = (
    <GlassSurface recipe={glass.notice(tone)} grain={false} testID={testID} accessibilityRole="summary" style={styles.notice}>
      <GlassTile name={NOTICE_GLYPH[tone]} size="notice" tint={tone} variant={tone === 'danger' ? 'rose' : undefined} />
      <View style={styles.noticeText}>
        <Text variant="headingNotice" style={{ color: colors[tone] }}>{title}</Text>
        {typeof children === 'string' ? <Text variant="bodySm" tone="muted">{children}</Text> : children}
      </View>
    </GlassSurface>
  );
  // A notice that appears after the screen's entrance (an error after a mutation) enters by itself.
  return late ? <Enter step={0} delay={0}>{notice}</Enter> : notice;
}

const styles = StyleSheet.create({
  pill: { borderRadius: radius.pill, minHeight: 28, paddingHorizontal: 11, alignSelf: 'flex-start', justifyContent: 'center' },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  notice: { flexDirection: 'row', gap: space.md, paddingTop: 13, paddingRight: 15, paddingBottom: 14, paddingLeft: 13, alignItems: 'flex-start' },
  noticeText: { flex: 1, gap: 3 },
});
