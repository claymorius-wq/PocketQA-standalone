import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View, type TextStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { GlassSurface, type Uplight } from '../glass';
import { HIDDEN, PASS_THROUGH } from '../glass/paint';
import { GlassTile, type GlyphName } from '../icons';
import { LiveLed } from '../motion';
import { DUR } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space } from '../theme/tokens';
import { UnderGlow } from './patterns/light';
import { Enter, useMountedLate, useScreenFocused } from './screen';
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

type PillState = { status: string; text: string; live: boolean };

/**
 * A status pill (C8): 28 tall, DM Mono 500 12/16 uppercase, the tone fill and 135° tone rim, the
 * live LED only on IN PROGRESS and UPLOADING. A status change crossfades the old and the new pill
 * in one fixed slot over 120ms (C8 `pillSlot`): both overlap while it runs, then the old one goes.
 * Only opacity moves (§14: pending never celebrates). The outgoing copy is hidden from assistive
 * technology and from queries; the testID stays on the current pill.
 */
export function StatusPill({ status, label, testID, live }: { status: string; label?: string; testID?: string; live?: boolean }) {
  const { motion } = useTheme();
  const text = label ?? status.replace(/_/g, ' ');
  const current: PillState = { status, text, live: live ?? LIVE_STATUS.has(status) };
  const key = `${status}|${text}`;
  const [shown, setShown] = useState({ key, prev: null as PillState | null, run: 0 });
  // The last committed pill: written after commit, so a render React discards (concurrent
  // rendering) can never stand in for the outgoing pill.
  const last = useRef(current);
  if (shown.key !== key) setShown({ key, prev: last.current, run: shown.run + 1 });
  useLayoutEffect(() => {
    last.current = current;
  });
  const fade = useSharedValue(1);
  // Before paint, so the new pill never shows a frame at full opacity over the old one.
  useLayoutEffect(() => {
    if (shown.run === 0) return;
    fade.value = 0;
    fade.value = withTiming(1, motion.timing.tick);
    const t = setTimeout(() => setShown((s) => (s.prev ? { ...s, prev: null } : s)), DUR.tick + 40);
    return () => clearTimeout(t);
  }, [shown.run, fade, motion]);
  const inStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const outStyle = useAnimatedStyle(() => ({ opacity: 1 - fade.value }));
  return (
    <View style={styles.slot}>
      <Animated.View style={shown.prev ? inStyle : null}>
        <PillBody pill={current} testID={testID} />
      </Animated.View>
      {shown.prev ? (
        <Animated.View {...HIDDEN} style={[styles.outgoing, PASS_THROUGH, outStyle]}>
          <PillBody pill={shown.prev} hidden />
        </Animated.View>
      ) : null}
    </View>
  );
}

function PillBody({ pill, testID, hidden = false }: { pill: PillState; testID?: string; hidden?: boolean }) {
  const { colors, glass } = useTheme();
  // The LED loop runs only while its screen is focused: tab scenes stay mounted when unfocused.
  const focused = useScreenFocused();
  const tone = STATUS_TONE[pill.status] ?? 'neutral';
  const fg = colors[tone];
  // C8: never aria-label on a span. Web reads a visually hidden "Status: " before the label; native
  // keeps the label on the pill, which is one accessibility element there.
  return (
    <GlassSurface recipe={glass.pill(tone)} grain={false} style={styles.pill} testID={testID} accessibilityLabel={WEB || hidden ? undefined : `Status: ${pill.text}`}>
      <View style={styles.pillRow}>
        {pill.live ? <LiveLed color={fg} shadow={glass.ledShadow(tone)} active={focused && !hidden} /> : null}
        {WEB && !hidden ? <Text variant="label" style={VISUALLY_HIDDEN}>Status: </Text> : null}
        <Text variant="label" style={{ color: fg }}>{pill.text.toUpperCase()}</Text>
      </View>
    </GlassSurface>
  );
}

/** Notice glyph per tone (§8: success uses Approve, not Info). */
const NOTICE_GLYPH: Record<'info' | 'warning' | 'danger' | 'success', GlyphName> = { info: 'info', warning: 'warning', danger: 'alert', success: 'approve' };

/** True for a string or number, or a list of only those (JSX text with interpolations). */
function isTextOnly(children: ReactNode): boolean {
  if (typeof children === 'string' || typeof children === 'number') return true;
  return Array.isArray(children) && children.length > 0 && children.every((c) => typeof c === 'string' || typeof c === 'number');
}

export function Notice({ tone = 'info', title, children, testID, uplight }: {
  tone?: 'info' | 'warning' | 'danger' | 'success';
  title: string;
  children?: ReactNode;
  testID?: string;
  /**
   * Mode A (CONSISTENCY §U): the notice is the lit subject (U5 Approved, a decision the light lands
   * on). It carries the uplit notice layer at opacity u and the under-glow on its bottom edge; keep
   * ≥ 32dp of ground below it. Never on danger, warning or pending notices. Light theme: nothing.
   */
  uplight?: Uplight;
}) {
  const { colors, glass } = useTheme();
  const late = useMountedLate();
  const lit = uplight && uplight.enabled && tone !== 'danger' && tone !== 'warning' ? uplight : null;
  const uplitRecipe = useMemo(() => (lit ? glass.uplight.notice(tone) : undefined), [lit, glass, tone]);
  // No side stripe: meaning rides on the tinted rim and the glyph tile's rim (§7.5, §8).
  const surface = (
    <GlassSurface recipe={glass.notice(tone)} uplight={lit?.u} uplitRecipe={uplitRecipe} grain={false} testID={testID} accessibilityRole="summary" style={styles.notice}>
      <GlassTile name={NOTICE_GLYPH[tone]} size="notice" tint={tone} variant={tone === 'danger' ? 'rose' : undefined} />
      <View style={styles.noticeText}>
        <Text variant="headingNotice" style={{ color: colors[tone] }}>{title}</Text>
        {/* Text-only children (one string, or several strings and numbers such as `Couldn’t save {name}`)
            are the body text; React Native throws on bare strings in a View. Elements render as given. */}
        {isTextOnly(children) ? <Text variant="bodySm" tone="muted">{children}</Text> : children}
      </View>
    </GlassSurface>
  );
  const notice = lit ? (
    <View style={styles.litWrap}>
      <UnderGlow light={lit} />
      {surface}
    </View>
  ) : (
    surface
  );
  // A notice that appears after the screen's entrance (an error after a mutation) enters by itself.
  return late ? <Enter step={0} delay={0}>{notice}</Enter> : notice;
}

const styles = StyleSheet.create({
  // The fixed slot both pills share while they crossfade (C8 pillSlot); the pill keeps its own width.
  slot: { alignSelf: 'flex-start' },
  outgoing: { position: 'absolute', left: 0, top: 0 },
  litWrap: { position: 'relative' },
  pill: { borderRadius: radius.pill, minHeight: 28, paddingHorizontal: 11, alignSelf: 'flex-start', justifyContent: 'center' },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  notice: { flexDirection: 'row', gap: space.md, paddingTop: 13, paddingRight: 15, paddingBottom: 14, paddingLeft: 13, alignItems: 'flex-start' },
  noticeText: { flex: 1, gap: 3 },
});
