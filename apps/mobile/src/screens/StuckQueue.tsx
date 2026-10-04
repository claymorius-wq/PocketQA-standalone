import { Check, Eye, X } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import type { StuckSubmission } from '@pocket-qa/contracts';
import { EvidenceItem } from '../evidence/EvidenceItem';
import { GlassSurface, Well } from '../glass';
import { credits } from '../lib/format';
import { useEvidence } from '../lib/queries';
import { focusSheetTarget } from '../motion/sheet';
import { DUR } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { space } from '../theme/tokens';
import { Button, QueryState, StatusPill, Text } from '../ui';
import { Byline, DateText, DecisionBar, GlideList, Hairline, ListRow, Meta, plural, SectionHeader } from '../ui/patterns';

// The admin Stuck triage queue (A-Stuck; Direction A §13, CONSISTENCY D2). The oldest stuck
// submission is the focus card (its pill and submitted date, the title, the byline); every other one
// is an item in one "Next in queue" card (the 40dp hourglass row, the reason pill, the age readout).
// Admin moments are never lit.
//
// Every item is fully actionable in place, as on main: each `stuck-<reason>` node (the focus card,
// and each queue item) holds its own byline, "Review work" (stuck-review, opening stuck-work with
// stuck-note-N / stuck-no-evidence) and its own Reject / Approve pair (stuck-reject, stuck-approve).
// e2e/remaining-scope.spec.ts filters an item by testID and text and clicks inside it, so no item
// may depend on being the oldest. Deliberate deviations from the board: "Review work" is kept (the
// board draws the work inline in the focus card only), queue items carry the work and the pair too,
// and the pair follows DecisionBar / C4 order (Reject left, Approve right) where the board draws
// Approve | Reject.
//
// S8 "queue settles": after a decision on the focus card the sheet leaves (240ms), the card sinks
// into the pressed recipe (120ms ease-press), then the next item takes the focus slot: its content
// rises 48dp over 240ms ease-lens and fades in over 120ms at +120, while its queue item fades out
// and the items below glide up (GlideList). A decided queue item fades out in place and the items
// below glide up. RN adaptations: the slot's height jumps to the new content (no height animation on
// layout, ADR 0006 budget), and the last card gives way to the EmptyState as soon as the refetch
// returns it. Reduced motion: the final state at once.

/** The pill on a stuck item: who can't review it. */
export function reasonLabel(s: StuckSubmission): string {
  return s.reason === 'builder_inactive' ? `Builder ${s.builderStatus}` : 'Overdue';
}

const DAY_MS = 86_400_000;

/** How long the work has waited, as the queue row's mono readout ("8 days"); null without a date. */
export function stuckAge(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const days = Math.max(0, Math.floor((now - Date.parse(iso)) / DAY_MS));
  return plural(days, 'day', 'days');
}

/**
 * The focus card and the queue behind it. Items arrive oldest first (the API orders by submission
 * time), so the focus is the oldest; the queue keeps the API's order.
 */
export function splitQueue(items: readonly StuckSubmission[]): { focus: StuckSubmission | null; rest: StuckSubmission[] } {
  return { focus: items[0] ?? null, rest: items.slice(1) };
}

/** The incoming focus content starts this far below its slot (the board's RISE). */
const RISE = 48;
/** The sheet leaves (240ms), then the decided card sinks (120ms); then it is filed away. */
const SEAL_MS = DUR.swap + DUR.tick;

export type StuckDecision = 'approve' | 'reject';
type OnDecide = (id: string, decision: StuckDecision) => void;

export function StuckQueue({ items, decided, onDecide }: {
  items: readonly StuckSubmission[];
  /** The participation just decided (the mutation's onSuccess); `n` tells two decisions apart. */
  decided: { id: string; n: number } | null;
  onDecide: OnDecide;
}) {
  const { motion } = useTheme();
  // Decided ids stay hidden until the refetch drops them (the decision already succeeded).
  const [filed, setFiled] = useState<ReadonlySet<string>>(() => new Set());
  // The decided focus card, held in the focus slot while it sinks, even if the refetch already dropped it.
  const [sealing, setSealing] = useState<StuckSubmission | null>(null);
  // Focus changes after mount: the focus content rises in on a move, never on the screen's own entrance.
  const [moves, setMoves] = useState(0);
  // The card last shown in the focus slot: the refetch can drop a decided item in the same render
  // that reports the decision, and the sink still belongs to the card the admin just decided.
  const shown = useRef<StuckSubmission | null>(null);

  const [seen, setSeen] = useState(decided?.n ?? 0);
  if (decided && decided.n !== seen) {
    setSeen(decided.n);
    const wasFocus = shown.current?.participation.id === decided.id;
    if (wasFocus && !motion.reduced) {
      setSealing(items.find((s) => s.participation.id === decided.id) ?? shown.current);
    } else {
      // A queue item (or any item under reduced motion) is filed at once; GlideList fades it out.
      setFiled((prev) => new Set(prev).add(decided.id));
      if (wasFocus) setMoves((m) => m + 1);
    }
  }

  useEffect(() => {
    if (!sealing) return;
    const t = setTimeout(() => {
      setFiled((prev) => new Set(prev).add(sealing.participation.id));
      setSealing(null);
      setMoves((m) => m + 1);
    }, SEAL_MS);
    return () => clearTimeout(t);
  }, [sealing]);

  const live = items.filter((s) => !filed.has(s.participation.id) && s.participation.id !== sealing?.participation.id);
  const { focus: chosen, rest } = splitQueue(live);
  const focus = sealing ?? chosen;
  const queue = sealing ? live : rest;
  useEffect(() => {
    shown.current = focus;
  });

  return (
    <View style={styles.main}>
      {focus ? <FocusCard item={focus} sealed={!!sealing} rise={moves > 0} onDecide={onDecide} /> : null}
      {queue.length > 0 ? <Queue items={queue} onDecide={onDecide} /> : null}
    </View>
  );
}

/** The focus card's shell stays in its slot; its content is keyed by item, so a move remounts only the content. */
function FocusCard({ item, sealed, rise, onDecide }: { item: StuckSubmission; sealed: boolean; rise: boolean; onDecide: OnDecide }) {
  const { motion } = useTheme();
  // S8's sink: the pressed recipe's layers come in and the card sinks 1dp (C5), after the sheet left.
  const sink = useSharedValue(0);
  useEffect(() => {
    sink.value = sealed ? withDelay(DUR.swap, withTiming(1, motion.timing.pressIn)) : 0;
  }, [sealed, sink, motion]);
  return (
    <GlassSurface
      level="card"
      pressed={sink}
      pressShift={sink}
      testID={`stuck-${item.reason}`}
      accessibilityElementsHidden={sealed}
      importantForAccessibility={sealed ? 'no-hide-descendants' : 'auto'}
      style={[styles.focus, sealed ? styles.inert : null]}
    >
      <FocusContent key={item.participation.id} item={item} rise={rise} onDecide={onDecide} />
    </GlassSurface>
  );
}

function FocusContent({ item, rise, onDecide }: { item: StuckSubmission; rise: boolean; onDecide: OnDecide }) {
  const { motion } = useTheme();
  const titleRef = useRef<View>(null);
  const moving = rise && !motion.reduced;
  const y = useSharedValue(moving ? RISE : 0);
  const opacity = useSharedValue(moving ? 0 : 1);
  useEffect(() => {
    if (!rise) return;
    if (!motion.reduced) {
      // The rise runs the whole 240ms; the content shows once the outgoing card is gone (+120).
      y.value = withTiming(0, motion.timing.swap);
      opacity.value = withDelay(DUR.tick, withTiming(1, motion.timing.tick));
    }
    // Focus follows the move to the new title (the board's LQ.focus after the swap).
    const t = setTimeout(() => focusSheetTarget(titleRef.current), motion.reduced ? 60 : DUR.swap);
    return () => clearTimeout(t);
    // Mount only: each move remounts this content.
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: y.value }] }));
  const p = item.participation;
  return (
    <Animated.View style={style}>
      <View style={styles.pillRow}>
        <StatusPill status="pending" label={reasonLabel(item)} />
        <DateText iso={p.submittedAt} verb="Submitted" style={styles.date} />
      </View>
      {/* The focus target after a move. Native groups the title into one heading; web keeps the inner heading. */}
      <View ref={titleRef} accessible={Platform.OS !== 'web'} accessibilityRole={Platform.OS === 'web' ? undefined : 'header'} style={styles.title}>
        <Text variant="title">{item.studyTitle}</Text>
      </View>
      <ItemActions item={item} onDecide={onDecide} />
    </Animated.View>
  );
}

/**
 * What every item carries, in the focus card and in each queue item alike (main's per-item card):
 * the byline, the work behind "Review work", and the item's own decision pair (DecisionBar: Reject
 * left, Approve right, the order of every sheet). The pair only opens the sheet.
 */
function ItemActions({ item, onDecide }: { item: StuckSubmission; onDecide: OnDecide }) {
  const p = item.participation;
  return (
    <>
      <View style={styles.byline}>
        <Byline name={p.testerDisplayName ?? 'Tester'} parts={[`${credits(p.rewardCredits)} on approval`, `${p.taskNotes.length} note(s)`]} />
      </View>
      <StuckWork item={item} />
      <DecisionBar
        style={styles.actions}
        negative={{ label: 'Reject', icon: X, onPress: () => onDecide(p.id, 'reject'), testID: 'stuck-reject' }}
        positive={{ label: 'Approve', icon: Check, onPress: () => onDecide(p.id, 'approve'), testID: 'stuck-approve' }}
      />
    </>
  );
}

/**
 * Read-only view of the work, so an admin deciding instead of the study owner sees what was asked,
 * the tester's notes and the evidence (playback is admin-authorized server side). The evidence is
 * fetched only once the admin opens it.
 */
function StuckWork({ item }: { item: StuckSubmission }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const ev = useEvidence(item.participation.id, open);
  if (!open) {
    return (
      <View style={styles.work}>
        <Button label="Review work" icon={Eye} variant="secondary" onPress={() => setOpen(true)} testID="stuck-review" style={styles.review} />
      </View>
    );
  }
  // The board's task well: TASK n in violet mono, the instruction, the tester's note, hairlines between.
  return (
    <Well radius={16} testID="stuck-work" style={[styles.work, styles.well]}>
      {item.tasks.map((t, i) => (
        <View key={t.id} style={styles.task}>
          {i > 0 ? <Hairline inset={0} /> : null}
          <Text variant="label" style={{ color: colors.violet }}>TASK {i + 1}</Text>
          <Text>{t.instruction}</Text>
          <Text variant="bodySm" tone="muted" testID={`stuck-note-${i}`}>{item.participation.taskNotes.find((n) => n.taskId === t.id)?.note || 'No notes.'}</Text>
        </View>
      ))}
      <View style={styles.evidence}>
        {item.tasks.length > 0 ? <Hairline inset={0} /> : null}
        <QueryState query={ev} empty={(d) => (d.items.length === 0 ? <Text variant="small" tone="muted" testID="stuck-no-evidence">No evidence uploaded.</Text> : null)}>
          {(d) => <View style={styles.evidenceList}>{d.items.map((e) => <EvidenceItem key={e.id} e={e} />)}</View>}
        </QueryState>
      </View>
    </Well>
  );
}

/**
 * "Next in queue": one L1 card of items. Each item leads with the board's row (40dp hourglass tile,
 * title, the reason pill, the age readout), then its submitted date and the same actions as the
 * focus card, so every item can be reviewed and decided where it is.
 */
function Queue({ items, onDecide }: { items: readonly StuckSubmission[]; onDecide: OnDecide }) {
  const [now] = useState(() => Date.now());
  return (
    <View style={styles.queue}>
      <SectionHeader title="Next in queue" variant="label" />
      <GlassSurface level="card" k={0.8} role="list" style={styles.queueCard}>
        <GlideList gap={0}>
          {items.map((s, i) => {
            const age = stuckAge(s.participation.submittedAt, now);
            return (
              // Main's per-item `stuck-<reason>` node, holding the item's own work and decision pair.
              <View key={s.participation.id} role="listitem" testID={`stuck-${s.reason}`} style={styles.item}>
                <ListRow
                  glyph="stuck"
                  title={s.studyTitle}
                  meta={<StatusPill status="pending" label={reasonLabel(s)} />}
                  trailing={age ? <Meta>{age}</Meta> : undefined}
                  divided={i > 0}
                />
                <View style={styles.itemBody}>
                  <DateText iso={s.participation.submittedAt} verb="Submitted" />
                  <ItemActions item={s} onDecide={onDecide} />
                </View>
              </View>
            );
          })}
        </GlideList>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  // The board's main column: the focus card, then "Next in queue", 24 apart.
  main: { gap: 24 },
  focus: { borderRadius: 24, paddingTop: 18, paddingRight: 18, paddingBottom: 18, paddingLeft: 20 },
  inert: { pointerEvents: 'none' },
  pillRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  date: { marginLeft: 'auto', flexShrink: 1, textAlign: 'right' },
  title: { marginTop: 14 },
  byline: { marginTop: 4 },
  work: { marginTop: 16 },
  review: { alignSelf: 'flex-start' },
  well: { paddingHorizontal: 16 },
  task: { gap: 4, paddingTop: 14, paddingBottom: 13 },
  evidence: { paddingTop: 12, paddingBottom: 14 },
  evidenceList: { gap: space.sm },
  actions: { marginTop: 16 },
  queue: { gap: 10 },
  queueCard: { borderRadius: 24, padding: 6 },
  item: { paddingBottom: 16 },
  // The item's body sits on the row's 16dp reading edge, under the tile.
  itemBody: { paddingHorizontal: 16 },
});
