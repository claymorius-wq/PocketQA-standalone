import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Text as RNText, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { Finding, Participation } from '@pocket-qa/contracts';
import { FlutedLens, GlassSurface, useUplight, Well } from '../../glass';
import { GradientRule } from '../../glass/paint';
import { GlassTile } from '../../icons';
import { formatUnits, tokenAmount, unitName } from '../../lib/money';
import { credits, statusLabel } from '../../lib/format';
import type { useStudyDisputes } from '../../lib/queries';
import { DUR, UPLIGHT } from '../../theme/motion';
import { useTheme } from '../../theme/ThemeProvider';
import type { GlassSurface as GlassRecipe } from '../../theme/tokens';
import { KitIconView, Notice, StatusPill, Text } from '../../ui';
import { Clauses, creditsSuffix, DateText } from '../../ui/patterns';

/** A dispute as the API returns it (contracts exports the schema only). */
type Dispute = NonNullable<ReturnType<typeof useStudyDisputes>['data']>['items'][number];

// A-Review's own parts (Direction A v2, CONSISTENCY round 4). Everything here is drawing: the
// screen keeps the queries, mutations, testIDs and copy, and passes the data in.

/** The participant head (board: pill and name on the left, the reward well spanning both rows on the right, the consent line under them). */
export function ReviewHead({ p }: { p: Participation }) {
  const { colors, type } = useTheme();
  const token = p.reward.kind === 'token' ? p.reward : null;
  const n = p.rewardCredits;
  // "50 test credits on approval": the numeral and its unit lines are one phrase for screen readers.
  const phrase = `${token ? tokenAmount(token.units, token.settlement) : credits(n)} on approval`;
  const unit = token ? unitName(token.settlement) : creditsSuffix(n).trim();
  const figure = token ? formatUnits(token.units) : n.toLocaleString('en-US');
  return (
    <View style={styles.head}>
      <View style={styles.headTop}>
        <View style={styles.headLeft}>
          <View style={styles.pillRow}>
            <StatusPill status={p.status} label={statusLabel[p.status]} testID="review-status" />
          </View>
          <Text variant="display">{p.testerDisplayName ?? 'Tester'}</Text>
        </View>
        <Well accessible accessibilityRole="text" accessibilityLabel={phrase} style={styles.reward}>
          <RNText style={[type.numeral, { color: colors.numeral }]}>{figure}</RNText>
          <RNText numberOfLines={1} style={[type.disclaimer, { color: colors.textMuted }]}>{unit}</RNText>
          <RNText numberOfLines={1} style={[type.disclaimer, { color: colors.textMuted }]}>on approval</RNText>
        </Well>
      </View>
      {/* Board: the consent clause and the submitted clause on two lines of their own (a column, 2 apart),
          so neither DM Mono date (C6) is split by a wrap mid-line. */}
      <View style={styles.consent}>
        <DateText iso={p.consentedAt} verb={`Consented to v${p.consentVersion} on`} />
        {p.submittedAt ? <DateText iso={p.submittedAt} verb="Submitted" /> : null}
      </View>
    </View>
  );
}

// The AI panel is a recessed well, not a card (it holds a fact, not content). Unavailable: the
// unlit dark well (glass.wellDark) and a neutral-rimmed Info tile; available: the lens well and a lit rim.
const AI_RADIUS = 20;

export function AiPanel({ available }: { available: boolean }) {
  const { colors, glass } = useTheme();
  const recipe = useMemo<GlassRecipe>(
    () => ({ ...(available ? glass.well : glass.wellDark), radius: AI_RADIUS }),
    [glass, available],
  );
  return (
    <GlassSurface recipe={recipe} grain={false} testID="ai-unavailable" style={styles.ai}>
      <GlassTile name="info" size="notice" tint={available ? undefined : 'neutral'} />
      <View style={styles.aiText}>
        <Text variant="headingNotice" style={{ color: available ? colors.text : colors.neutral }}>{available ? 'AI analysis' : 'Analysis unavailable'}</Text>
        <Text variant="bodySm" tone="muted">No AI provider is configured. Review the evidence and write findings yourself.</Text>
      </View>
    </GlassSurface>
  );
}

/** The fading in-flow rule between rows (the list-row hairline, §8). */
function Rule() {
  const { glass } = useTheme();
  return <GradientRule stops={glass.divider.stops} style={styles.rule} />;
}

export type ReviewTask = { id: string; instruction: string };

/** "Task notes": one L1 card, the heading inside it, each task a "TASK n" column beside the instruction and the tester's note. */
export function TaskNotes({ tasks, notes }: { tasks: readonly ReviewTask[]; notes: Participation['taskNotes'] }) {
  const { colors, type } = useTheme();
  return (
    <GlassSurface level="card" k={0.8} style={styles.notesCard}>
      <RNText accessibilityRole="header" style={[type.heading, { color: colors.text }]}>Task notes</RNText>
      {tasks.map((t, i) => {
        const note = notes.find((n) => n.taskId === t.id)?.note;
        return (
          <View key={t.id} style={styles.taskBlock}>
            {i > 0 ? <Rule /> : null}
            <View style={styles.taskRow}>
              <RNText style={[type.label, styles.taskLabel, { color: colors.textMuted }]}>{`TASK ${i + 1}`}</RNText>
              <View style={styles.taskText}>
                <RNText style={[type.bodySm, { color: colors.textMuted }]}>{t.instruction}</RNText>
                <RNText testID={`review-note-${i}`} style={[type.body, styles.note, { color: note ? colors.text : colors.textMuted }]}>
                  {note || 'No notes.'}
                </RNText>
              </View>
            </View>
          </View>
        );
      })}
    </GlassSurface>
  );
}

/** The evidence empty state, in flow (board: no card, the 72dp lens beside the text). */
export function EvidenceEmpty({ title, body }: { title: string; body: string }) {
  const { colors, type } = useTheme();
  return (
    <View testID="empty-state" style={styles.empty}>
      <FlutedLens size={72}>
        <KitIconView icon="fileWarning" size={36} color={colors.rimLit} />
      </FlutedLens>
      <View style={styles.emptyText}>
        <RNText accessibilityRole="header" style={[type.heading, { color: colors.text }]}>{title}</RNText>
        <RNText style={[type.bodySm, { color: colors.textMuted }]}>{body}</RNText>
      </View>
    </View>
  );
}

/** A finding's severity pill tone (unchanged mapping: blocker reads failed, major pending, the rest resolved). */
export const severityStatus = (s: Finding['severity']) => (s === 'blocker' ? 'failed' : s === 'major' ? 'pending' : 'resolved');

/** The findings written so far: one L1 card, a fading rule between them. */
export function FindingsList({ items }: { items: Finding[] }) {
  const { colors, type } = useTheme();
  return (
    <GlassSurface level="card" k={0.64} role="list" style={styles.findings}>
      {items.map((f, i) => (
        <View key={f.id} role="listitem" testID="finding-item" style={styles.finding}>
          {i > 0 ? <Rule /> : null}
          <View style={styles.findingHead}>
            <RNText accessibilityRole="header" style={[type.heading, styles.findingTitle, { color: colors.text }]}>{f.title}</RNText>
            <StatusPill status={severityStatus(f.severity)} label={f.severity} />
          </View>
          <Text variant="bodySm">{f.description}</Text>
          <Clauses parts={['Written by a person', <DateText key="d" iso={f.createdAt} />]} />
        </View>
      ))}
    </GlassSurface>
  );
}

/** The finding form's L1 card (k 0.64: the far end of the column's light), padding 18 18 20 18, fields 14 apart. */
export function FormCard({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <GlassSurface level="card" k={0.64} testID={testID} style={styles.form}>
      {children}
    </GlassSurface>
  );
}

/** A section of the review column: its header line and a 12dp stack (board sections, padding-top 4). */
export function ReviewSection({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.section, style]}>{children}</View>;
}

/** The tester's dispute on this participation (board: a 40dp disputes tile, the title, the status pill). */
export function DisputeCard({ dispute }: { dispute: Dispute }) {
  const { colors, type } = useTheme();
  return (
    <GlassSurface level="card" k={0.64} testID="review-dispute" style={styles.dispute}>
      <View style={styles.disputeHead}>
        <GlassTile name="disputes" size="list" tint="warning" />
        <RNText accessibilityRole="header" style={[type.heading, styles.flex, { color: colors.text }]}>Tester dispute</RNText>
        <StatusPill status={dispute.status} />
      </View>
      <Text style={styles.disputeReason}>{dispute.reason}</Text>
      <Text variant="small" tone="muted">
        {dispute.outcome ? `${dispute.outcome === 'overturned' ? 'Overturned by an admin' : 'Upheld by an admin'}: ${dispute.resolutionNote ?? ''}` : 'An admin will resolve it.'}
      </Text>
    </GlassSurface>
  );
}

/**
 * The U7 tail as it lands on its subject (C4 success, CONSISTENCY §U): the uplit layer of the
 * Decision notice goes 0 → 0.6 over 240ms ease-lens, then → 0 over 700ms ease-lens (`lq-land`).
 * `land` counts in-session approvals; a notice that opens already decided never lights (a revisit
 * is at rest). Registered with the key light, so the pool dims while it shows. Reduced motion and
 * the flat light theme: nothing.
 */
export function useLanding(land: number) {
  // The kit's `land` grade (one landing per approval: `replay` is the count).
  return useUplight('land', land > 0, { replay: land }).u;
}
/** lq-land's peak (C4): the tail arrives at 0.6 of the uplit notice. */
export const LAND_PEAK = UPLIGHT.land.peak;

/**
 * "Decision: Approved" and the other decided states: the kit Notice (unchanged tones: success for
 * Approved, info otherwise). Approved is Mode A, the lit subject: the landing tail drives the kit's
 * uplit notice layer and under-glow. A late mount enters by itself (the kit Notice's own Enter), so
 * an in-session decision arrives in the dock's place. Body: the decision reason, else "Decided
 * {date}" (C6 verb date).
 */
export function DecisionNotice({ p, land, testID }: { p: Participation; land: number; testID?: string }) {
  const tone: 'success' | 'info' = p.status === 'approved' ? 'success' : 'info';
  const lands = tone === 'success' ? land : 0;
  const light = useUplight('land', lands > 0, { replay: lands });
  return (
    <Notice tone={tone} title={`Decision: ${statusLabel[p.status]}`} testID={testID} uplight={tone === 'success' ? light : undefined}>
      {p.decisionReason ?? <DateText iso={p.decidedAt} verb="Decided" />}
    </Notice>
  );
}

/**
 * The Decision dock's slot. Mounted after the screen's arrival, it enters (dur-enter ease-lens,
 * rising 10; reduced: a 120ms fade); once `shown` turns false it stays mounted through its exit (240ms ease-exit,
 * touches off), so the dock and the Decision notice trade places instead of cutting (board `dk`).
 */
export function DockSlot({ shown, children, style, onLayout }: { shown: boolean; children: ReactNode; style?: StyleProp<ViewStyle>; onLayout?: ViewProps['onLayout'] }) {
  const { motion } = useTheme();
  const [mounted, setMounted] = useState(shown);
  if (shown && !mounted) setMounted(true);
  // Shown from the start, the dock arrives with the screen's content root (no entrance of its own);
  // shown later (the participation loaded after the arrival), it enters by itself.
  const opacity = useSharedValue(shown ? 1 : 0);
  const rise = motion.reduced ? 0 : RISE;
  useEffect(() => {
    if (!mounted) return;
    if (shown) {
      opacity.value = withTiming(1, motion.timing.enter);
      return;
    }
    opacity.value = withTiming(0, motion.timing.exit);
    const t = setTimeout(() => setMounted(false), DUR.swap);
    return () => clearTimeout(t);
  }, [shown, mounted]);
  const fade = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: shown ? (1 - opacity.value) * rise : 0 }] }));
  if (!mounted) return null;
  return (
    <Animated.View onLayout={onLayout} style={[style, fade, shown ? null : styles.noTouch]}>
      {children}
    </Animated.View>
  );
}
const RISE = 10;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  noTouch: { pointerEvents: 'none' },
  head: { paddingLeft: 4, paddingBottom: 2, gap: 8 },
  headTop: { flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  headLeft: { flex: 1, minWidth: 0, gap: 8, alignSelf: 'stretch', justifyContent: 'space-between' },
  pillRow: { minHeight: 28, justifyContent: 'center' },
  // Board: a 128dp well, padding 6 12 11 14, the numeral over its two unit lines.
  reward: { width: 128, paddingTop: 6, paddingRight: 12, paddingBottom: 11, paddingLeft: 14 },
  consent: { marginTop: 2, gap: 2 },
  ai: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingTop: 12, paddingRight: 16, paddingBottom: 13, paddingLeft: 12 },
  aiText: { flex: 1, minWidth: 0, gap: 3 },
  rule: { height: 1, marginBottom: 14 },
  notesCard: { borderRadius: 24, paddingTop: 18, paddingRight: 18, paddingBottom: 20, paddingLeft: 18, gap: 14 },
  taskBlock: {},
  taskRow: { flexDirection: 'row', gap: 10 },
  taskLabel: { width: 58, paddingTop: 2, letterSpacing: 0.48 },
  taskText: { flex: 1, minWidth: 0, gap: 4 },
  note: { marginTop: 2 },
  empty: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingTop: 6, paddingBottom: 4, paddingLeft: 4 },
  emptyText: { flex: 1, minWidth: 0, gap: 4 },
  findings: { borderRadius: 24, paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 18, gap: 14 },
  finding: { gap: 6 },
  findingHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  findingTitle: { flex: 1, minWidth: 0, fontSize: 15 },
  section: { gap: 12, paddingTop: 4 },
  form: { borderRadius: 24, paddingTop: 18, paddingRight: 18, paddingBottom: 20, paddingLeft: 18, gap: 14 },
  dispute: { borderRadius: 24, padding: 16, gap: 8 },
  disputeHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  disputeReason: { marginTop: 2 },
});
