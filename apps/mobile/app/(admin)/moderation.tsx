import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { api, ApiError } from '../../src/api/client';
import { GlassSurface } from '../../src/glass';
import { PASS_THROUGH } from '../../src/glass/paint';
import { useFocusRefetch, useAdminStudies } from '../../src/lib/queries';
import { DUR } from '../../src/theme/motion';
import { useTheme } from '../../src/theme/ThemeProvider';
import { radius } from '../../src/theme/tokens';
import { Button, ConfirmSheet, EmptyState, Field, QueryState, Screen, Text } from '../../src/ui';
import { GlideList, ListRow, SectionHeader, SheetFailure } from '../../src/ui/patterns';

// A-Moderation (Direction A v2, CONSISTENCY D2): a visibility ledger. "Visible · n" and
// "Suspended · n" are each one L1 card of list rows (the 40dp Studies tile, the title, the slot
// readout and a trailing compact action). The section is the moderation status, so rows carry no
// pill; the study's lifecycle (published / paused / closed) leads the one mono readout ("closed · 0/5
// slots", DM Mono's own spaces around the dot, C6), so a closed study reads apart from a live one.
// The readout never ellipsizes: beside the compact action on a 390pt phone it wraps after the dot,
// so the slot count ("1/5 slots", the board's readout) is always whole.
// Each sheet starts clean (no earlier reason, no stale failure) and keeps its decision while it leaves.
// S7 "Suspend sinks": a decided row sinks into the pressed recipe (Reinstate lifts it) once the
// sheet has left, then moves to the other section. Never lit (§10.2: admin decisions).

/** A study as the admin list returns it (contracts `Study`). */
type AdminStudy = NonNullable<ReturnType<typeof useAdminStudies>['data']>['items'][number];
type Visibility = AdminStudy['moderation'];

/**
 * S7's beats after a confirmed decision: the sheet leaves (240), then the row sinks (120, ease-press)
 * or lifts (180, ease-lens) in its old section, then it moves. The row is held in its old section
 * this long; it moves when the hold ends and the refetched list says so.
 */
const SINK_AT = DUR.swap;
const HOLD = { suspended: SINK_AT + DUR.tick, ok: SINK_AT + DUR.release } as const;

/** A decided row that S7 still holds in the section it is leaving. */
type Move = { id: string; from: Visibility; held: boolean };

/** No-break space: binds "1/5 slots" and the lifecycle to its dot, so a wrap falls only after the dot. */
const NBSP = ' ';

/** The row's one mono readout: "published · 1/5 slots". It wraps after the dot, never inside a part. */
function ledgerReadout(study: Pick<AdminStudy, 'status' | 'slots' | 'slotsFilled'>): string {
  return `${study.status.replace(/_/g, ' ')}${NBSP}· ${study.slotsFilled}/${study.slots}${NBSP}slots`;
}

/**
 * One ledger row. Suspended rows rest sunk: the pressed recipe sits inset 4dp under the row (the
 * board's carrier, radius 18). A change of `sunk` after mount sinks or lifts it once the sheet has
 * left; a row that mounts already in place is at rest.
 */
function LedgerRow({ study, visible, sunk, divided, onAction }: { study: AdminStudy; visible: boolean; sunk: boolean; divided: boolean; onAction: () => void }) {
  const { colors, glass, motion, type } = useTheme();
  const level = useSharedValue(sunk ? 1 : 0);
  useEffect(() => {
    const to = sunk ? 1 : 0;
    if (level.value === to) return;
    if (motion.reduced) {
      level.value = to;
      return;
    }
    level.value = withDelay(SINK_AT, withTiming(to, sunk ? motion.timing.pressIn : { ...motion.timing.swap, duration: DUR.release }));
  }, [sunk, level, motion]);
  const sinkStyle = useAnimatedStyle(() => ({ opacity: level.value }));
  return (
    <View role="listitem">
      <Animated.View style={[styles.carrier, PASS_THROUGH, sinkStyle]}>
        <GlassSurface recipe={glass.cardPressed} radius={18} grain={false} style={styles.fill} />
      </Animated.View>
      <ListRow
        glyph="studies"
        title={study.title}
        // Under the title: the study's objective (as on main: an admin judges a suspension by it), then
        // the mono readout, which takes a second line rather than clip "1/5 slo…" beside the action.
        meta={
          <View style={styles.meta}>
            <Text variant="bodySm" tone="muted" numberOfLines={2}>{study.objective}</Text>
            <RNText numberOfLines={2} style={[type.meta, { color: colors.textMuted }]}>{ledgerReadout(study)}</RNText>
          </View>
        }
        divided={divided}
        density="ledger"
        dim={!visible}
        trailing={
          <Button
            label={visible ? 'Suspend' : 'Reinstate'}
            icon={visible ? ShieldAlert : ShieldCheck}
            variant={visible ? 'danger' : 'secondary'}
            onPress={onAction}
            testID="moderate-study"
            accessibilityHint={study.title}
            size="compact"
          />
        }
      />
    </View>
  );
}

/** One ledger section: the label with its count over one L1 card; an empty section keeps a quiet row. */
function LedgerSection({ title, empty, studies, k, sunk, onAction, testID }: {
  title: 'Visible' | 'Suspended';
  testID: string;
  empty: string;
  studies: AdminStudy[];
  k: number;
  sunk: (s: AdminStudy) => boolean;
  onAction: (s: AdminStudy) => void;
}) {
  return (
    <View style={styles.section}>
      <SectionHeader title={title} variant="label" count={studies.length} />
      <GlassSurface level="card" k={k} role="list" testID={testID} style={styles.ledger}>
        {/* Rows leave in place and the rest glide (S7's item-only moves); a row arriving rises in. */}
        <GlideList gap={0}>
          {studies.length === 0
            ? [
                <View key="none" style={styles.none}>
                  <Text variant="bodySm" tone="muted">{empty}</Text>
                </View>,
              ]
            : studies.map((s, i) => <LedgerRow key={s.id} study={s} visible={title === 'Visible'} sunk={sunk(s)} divided={i > 0} onAction={() => onAction(s)} />)}
        </GlideList>
      </GlassSurface>
    </View>
  );
}

export default function Moderation() {
  const q = useAdminStudies();
  useFocusRefetch(q);
  const qc = useQueryClient();
  const { motion } = useTheme();
  const [target, setTarget] = useState<{ id: string; action: 'suspend' | 'reinstate' } | null>(null);
  const [reason, setReason] = useState('');
  const [move, setMove] = useState<Move | null>(null);
  // The sheet keeps naming the last decision while it plays its exit (native), so its title never flips.
  const [shown, setShown] = useState(target);
  if (target && target !== shown) setShown(target);
  const action = (target ?? shown)?.action;
  const mod = useMutation({
    mutationFn: () => api('moderateStudy', { params: { id: target!.id }, body: { action: target!.action, reason } }),
    onSuccess: (study) => {
      // The reason stays while the sheet animates out; the next open() clears it.
      setTarget(null);
      qc.invalidateQueries({ queryKey: ['adminStudies'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
      // S7 (UI only): hold the decided row in the section it leaves while it sinks or lifts.
      if (!motion.reduced) setMove({ id: study.id, from: study.moderation === 'suspended' ? 'ok' : 'suspended', held: true });
    },
  });

  // The hold ends after the sink; the row then moves as soon as the list reflects the decision.
  useEffect(() => {
    if (!move?.held) return;
    const t = setTimeout(() => setMove((m) => (m && m.id === move.id ? { ...m, held: false } : m)), HOLD[move.from === 'ok' ? 'suspended' : 'ok']);
    return () => clearTimeout(t);
  }, [move]);
  const items = q.data?.items;
  useEffect(() => {
    if (!move || move.held) return;
    const s = items?.find((x) => x.id === move.id);
    if (!s || s.moderation !== move.from) setMove(null);
  }, [move, items]);

  const placed = (s: AdminStudy): Visibility => (move && move.id === s.id && move.held ? move.from : s.moderation);
  // A held row already shows where it is going: it sinks (or lifts) before it moves.
  const sunk = (s: AdminStudy) => (move && move.id === s.id ? move.from === 'ok' : s.moderation === 'suspended');
  // A row is labelled by the section it sits in; while S7 holds it there, its action waits for the move.
  const open = (s: AdminStudy) => {
    if (move?.held && move.id === s.id) return;
    // A new sheet starts clean: no reason from a cancelled sheet, no failure from an earlier attempt
    // (a request still running, after the pending escape, is never detached).
    setReason('');
    if (!mod.isPending) mod.reset();
    setTarget({ id: s.id, action: s.moderation === 'ok' ? 'suspend' : 'reinstate' });
  };
  // Reset on open only (above): Cancel leaves the body alone so the sheet does not change as it leaves.
  const cancel = () => setTarget(null);

  return (
    <Screen title="Moderation" subtitle="Published and past studies" testID="moderation-screen">
      <QueryState query={q} empty={(d) => (d.items.length === 0 ? <EmptyState icon={ShieldCheck} title="Nothing to moderate" body="Published studies appear here." /> : null)}>
        {(d) => (
          <View style={styles.ledgerColumn}>
            <LedgerSection testID="moderation-visible" title="Visible" empty="No visible studies" studies={d.items.filter((s) => placed(s) === 'ok')} k={1} sunk={sunk} onAction={open} />
            <LedgerSection testID="moderation-suspended" title="Suspended" empty="No suspended studies" studies={d.items.filter((s) => placed(s) === 'suspended')} k={0.8} sunk={sunk} onAction={open} />
          </View>
        )}
      </QueryState>
      <ConfirmSheet visible={!!target} title={action === 'suspend' ? 'Suspend study?' : 'Reinstate study?'} body="Every moderation action is recorded in the audit log with your reason." confirmLabel={action === 'suspend' ? 'Suspend' : 'Reinstate'} destructive={action === 'suspend'} moment="none" confirmDisabled={reason.trim().length < 5} loading={mod.isPending} onCancel={cancel} onConfirm={() => mod.mutate()}>
        <Field label="Reason" value={reason} onChangeText={setReason} hint="At least 5 characters." multiline testID="moderation-reason" />
        {mod.error ? <SheetFailure title="Action failed" message={(mod.error as ApiError).message} /> : null}
      </ConfirmSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  ledgerColumn: { gap: 24 },
  section: { gap: 10 },
  ledger: { borderRadius: radius.card, paddingVertical: 4 },
  // The board's carrier: the pressed recipe inset 4dp from the row, radius 24 − 4 − 2.
  carrier: { position: 'absolute', top: 4, right: 4, bottom: 4, left: 4 },
  none: { minHeight: 56, justifyContent: 'center', paddingHorizontal: 16 },
  meta: { gap: 2 },
});
