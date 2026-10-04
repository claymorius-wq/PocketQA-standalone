import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Gavel } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { api, ApiError } from '../../src/api/client';
import { GlassSurface, Well } from '../../src/glass';
import { HIDDEN, PASS_THROUGH, useSvgId } from '../../src/glass/paint';
import { BalanceTile } from '../../src/icons';
import { useFocusRefetch, useAdminDisputes, useEvidence, useParticipation } from '../../src/lib/queries';
import { focusSheetTarget } from '../../src/motion/sheet';
import { DUR } from '../../src/theme/motion';
import { useTheme } from '../../src/theme/ThemeProvider';
import { layout, radius } from '../../src/theme/tokens';
import { Button, ConfirmSheet, EmptyState, Field, QueryState, Screen, Segmented, StatusPill, Text } from '../../src/ui';
import { Clauses, DateText, Hairline } from '../../src/ui/patterns';

// A-Disputes (Direction A v2, CONSISTENCY D2): claim cards. Each card leads with the tester's claim
// as a hanging quote, the rejection reason sits in a well, and the byline ends in an auto-width
// secondary Resolve. A resolved card rests sunk (the pressed recipe) with its verdict row under the
// byline. Admin resolutions are judicial, never celebratory: nothing here is ever lit (§10.2).
// The Resolve sheet starts clean for each dispute (Uphold, an empty note, no stale failure), and its
// balance tile keeps the last pose while the sheet animates out.

/** A dispute as the admin list returns it (contracts `Dispute`). */
type Dispute = NonNullable<ReturnType<typeof useAdminDisputes>['data']>['items'][number];
/** One resolution as it was confirmed: the request's variables. */
type Resolution = { id: string; outcome: 'upheld' | 'overturned'; note: string };

/** L1 light distance down the list (§2 cardK). */
const CARD_K = [1, 0.8, 0.64] as const;
/** S6 hand-off: the card sinks at +240 (after the sheet leaves) and the verdict enters at +300. */
const SINK_DELAY = DUR.swap;
const VERDICT_DELAY = 300;
/** S6 "balance weighs": the verdict tile's balance settles at +420; the Resolve sheet's leaves level at +380, once it has landed. */
const VERDICT_WEIGH_AT = 420;
const SHEET_WEIGH_AT = 380;

type DisputeContextData = { reason: string; name: string; evidence: number; notes: number };

/** The participation behind a dispute: the rejection reason and the tester's byline. */
function useDisputeContext(participationId: string): DisputeContextData | null {
  const p = useParticipation(participationId);
  const ev = useEvidence(participationId);
  if (!p.data) return null;
  return { reason: p.data.decisionReason ?? '—', name: p.data.testerDisplayName ?? 'Tester', evidence: ev.data?.items.length ?? 0, notes: p.data.taskNotes.length };
}

/** The claim's hanging quote mark (the board's 12×10 violet mark, hung 16dp left of the first line). */
function QuoteMark() {
  const { colors, glass } = useTheme();
  const id = useSvgId('qm');
  return (
    <Svg {...HIDDEN} width={12} height={10} viewBox="0 0 12 10" style={styles.quote}>
      {glass.enabled ? (
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="12" y2="10" gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#C9C2FF" />
            <Stop offset="0.55" stopColor="#8C7BFF" />
            <Stop offset="1" stopColor="#5E4FC4" />
          </LinearGradient>
        </Defs>
      ) : null}
      <Path
        fill={glass.enabled ? `url(#${id})` : colors.violet}
        d="M5 0.3C2.2 1.2 0.2 3.6 0.2 6.6C0.2 8.6 1.3 9.7 2.7 9.7C4.1 9.7 5 8.7 5 7.4C5 6.1 4.1 5.2 2.9 5.2C2.6 5.2 2.3 5.3 2.1 5.4C2.5 3.4 3.6 1.9 5.4 1.1Z M11.6 0.3C8.8 1.2 6.8 3.6 6.8 6.6C6.8 8.6 7.9 9.7 9.3 9.7C10.7 9.7 11.6 8.7 11.6 7.4C11.6 6.1 10.7 5.2 9.5 5.2C9.2 5.2 8.9 5.3 8.7 5.4C9.1 3.4 10.2 1.9 12 1.1Z"
      />
    </Svg>
  );
}

/**
 * The verdict row under a resolved card's byline: the 36dp Disputes tile (rim neutral for upheld,
 * success for overturned; its balance weighs from level to the verdict, S6) and the outcome sentence. `live`: the dispute was resolved while this card
 * was on screen, so the row rises in at +300 and takes focus; a card that loads resolved is at rest.
 */
function Verdict({ dispute, live }: { dispute: Dispute; live: boolean }) {
  const { motion, type, colors } = useTheme();
  const overturned = dispute.outcome === 'overturned';
  const [from] = useState(() => (live ? 0 : 1));
  const shown = useSharedValue(from);
  const rise = motion.reduced ? 0 : 6;
  const ref = useRef<RNText>(null);
  useEffect(() => {
    if (!live) return;
    const delay = motion.reduced ? 0 : VERDICT_DELAY;
    shown.value = withDelay(delay, withTiming(1, motion.timing.enter));
    const t = setTimeout(() => focusSheetTarget(ref.current), delay);
    return () => clearTimeout(t);
    // Mount only: the verdict enters once.
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: shown.value, transform: [{ translateY: (1 - shown.value) * rise }] }));
  return (
    <Animated.View style={[styles.verdict, style]}>
      <Hairline inset={0} />
      <BalanceTile size="notice" tint={overturned ? 'success' : 'neutral'} pose={overturned ? 'overturn' : 'uphold'} from={live ? 'level' : undefined} delay={VERDICT_WEIGH_AT} />
      <RNText ref={ref} style={[type.small, styles.verdictText, { color: colors.textMuted }]}>
        <RNText style={{ color: colors.text, fontFamily: type.heading.fontFamily, fontWeight: type.heading.fontWeight }}>{overturned ? 'Overturned: reward credited.' : 'Upheld.'}</RNText> {dispute.resolutionNote}
      </RNText>
    </Animated.View>
  );
}

/**
 * The rejection reason's well. It is absent until the participation loads; when it arrives after
 * the card mounted it fades in (opacity only, the kit's enter timing) instead of popping in. A card
 * whose context is already cached mounts it at rest.
 */
function ReasonWell({ reason, late }: { reason: string; late: boolean }) {
  const { colors, type, motion } = useTheme();
  const [from] = useState(() => (late ? 0 : 1));
  const shown = useSharedValue(from);
  useEffect(() => {
    if (from === 1) return;
    shown.value = withTiming(1, motion.timing.enter);
    // Mount only: the well enters once.
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: shown.value }));
  return (
    <Animated.View style={[styles.reasonWell, style]}>
      <Well radius={14} style={styles.reasonWellInner}>
        <RNText style={[type.bodySm, { color: colors.text }]}>
          <RNText style={{ color: colors.textMuted }}>Rejection reason:</RNText> {reason}
        </RNText>
      </Well>
    </Animated.View>
  );
}

/** One claim card (D2). The participation's context fills in when it loads; Resolve never waits for it. */
function DisputeCard({ dispute, k, onResolve }: { dispute: Dispute; k: number; onResolve: () => void }) {
  const { colors, type, motion } = useTheme();
  const context = useDisputeContext(dispute.participationId);
  // The context loaded after this card mounted (cold load), so its well fades in rather than pops.
  const [contextLate] = useState(context === null);
  const open = dispute.status === 'open';
  // A dispute that was open when this card mounted and is resolved now was decided on screen (S6).
  const [openedHere] = useState(open);
  const live = openedHere && !open;
  // Resolved cards rest sunk into the pressed recipe: a state, so its layers are kept under reduced
  // motion (the kit drops only the 1dp shift there).
  const sunk = useSharedValue(open ? 0 : 1);
  useEffect(() => {
    const to = open ? 0 : 1;
    if (sunk.value === to) return;
    sunk.value = withDelay(motion.reduced ? 0 : SINK_DELAY, withTiming(to, motion.timing.pressIn));
  }, [open, sunk, motion]);

  return (
    <GlassSurface level="card" k={k} pressed={sunk} testID={`dispute-${dispute.status}`} style={styles.card}>
      <View style={styles.head}>
        <StatusPill status={dispute.status} />
        <DateText iso={dispute.createdAt} style={styles.date} />
      </View>
      <View style={styles.claim}>
        <QuoteMark />
        <Text variant="title">{dispute.reason}</Text>
      </View>
      {context ? <ReasonWell reason={context.reason} late={contextLate} /> : null}
      <View style={styles.byline}>
        <View style={styles.bylineText}>
          {context ? (
            <>
              <RNText style={[type.small, { color: colors.text, fontFamily: type.heading.fontFamily, fontWeight: type.heading.fontWeight }]}>{context.name}</RNText>
              <Clauses parts={[`${context.evidence} evidence item(s)`, `${context.notes} note(s)`]} />
            </>
          ) : null}
        </View>
        {open ? <Button label="Resolve" icon={Gavel} variant="secondary" onPress={onResolve} testID="dispute-resolve" accessibilityHint={dispute.reason} /> : null}
      </View>
      {open ? null : <Verdict dispute={dispute} live={live} />}
    </GlassSurface>
  );
}

export default function Disputes() {
  const q = useAdminDisputes();
  useFocusRefetch(q);
  const qc = useQueryClient();
  const [target, setTarget] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'upheld' | 'overturned'>('upheld');
  const [note, setNote] = useState('');
  // The tile's pose while the sheet is open, kept through its exit (the outcome resets when the next sheet opens).
  const [shownOutcome, setShownOutcome] = useState(outcome);
  if (target && outcome !== shownOutcome) setShownOutcome(outcome);
  const pose = target ? outcome : shownOutcome;
  const resolve = useMutation({
    // Bound to what was confirmed (the dispute, the verdict and the note), never to the sheet's
    // latest state: a request the browser holds while offline still resolves the right dispute.
    mutationFn: (r: Resolution) => api('resolveDispute', { params: { id: r.id }, body: { outcome: r.outcome, note: r.note } }),
    onSuccess: () => {
      // The note stays while the sheet animates out; the next open() clears it.
      setTarget(null);
      qc.invalidateQueries({ queryKey: ['adminDisputes'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
  // A sheet opened for a new dispute starts from Uphold with an empty note and no earlier failure,
  // so the S6 weigh never starts from the last verdict's pose. Reset on open only: Cancel leaves the
  // body as it is, so nothing in the sheet changes while it animates out.
  // While a resolution is still being sent (Cancel works again after the pending escape), any
  // Resolve reopens that resolution's own sheet, as it was sent: it takes the result, and no
  // second resolution can race it.
  const open = (id: string) => {
    const sending = resolve.isPending ? resolve.variables : undefined;
    if (sending) {
      setOutcome(sending.outcome);
      setNote(sending.note);
      setTarget(sending.id);
      return;
    }
    setOutcome('upheld');
    setNote('');
    resolve.reset();
    setTarget(id);
  };
  const cancel = () => setTarget(null);
  return (
    <Screen title="Disputes" subtitle="Testers contesting a rejection" testID="disputes-screen">
      <QueryState query={q} empty={(d) => (d.items.length === 0 ? <EmptyState icon={Gavel} title="No disputes" body="When a tester disputes a rejection, it appears here." /> : null)}>
        {(d) => (
          <View style={styles.list}>
            {d.items.map((x, i) => (
              <DisputeCard key={x.id} dispute={x} k={CARD_K[Math.min(i, CARD_K.length - 1)] ?? 1} onResolve={() => open(x.id)} />
            ))}
          </View>
        )}
      </QueryState>
      {/* Resolve is judicial: never lit (moment none), whichever verdict is chosen. */}
      <ConfirmSheet
        visible={!!target}
        title="Resolve dispute"
        body="Overturning credits the tester once from the study budget."
        confirmLabel="Resolve"
        moment="none"
        // S6: the header balance leaves level once the sheet has landed, then follows the choice.
        tile={<BalanceTile pose={pose === 'overturned' ? 'overturn' : 'uphold'} from="level" delay={SHEET_WEIGH_AT} />}
        confirmDisabled={note.trim().length < 5}
        loading={resolve.isPending}
        status={resolve.isError ? 'error' : undefined}
        error={resolve.error ? (resolve.error as ApiError).message : null}
        failureTitle="Not resolved"
        onCancel={cancel}
        onConfirm={() => target && resolve.mutate({ id: target, outcome, note })}
      >
        <Segmented
          testID="dispute-outcome"
          value={outcome}
          onChange={setOutcome}
          options={[
            { value: 'upheld', label: 'Uphold rejection' },
            { value: 'overturned', label: 'Overturn' },
          ]}
        />
        <Field label="Resolution note" value={note} onChangeText={setNote} hint="At least 5 characters." multiline testID="dispute-note" />
      </ConfirmSheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { gap: layout.listGap },
  card: {
    borderRadius: radius.card,
    paddingTop: layout.cardPadding.top,
    paddingRight: layout.cardPadding.right,
    paddingBottom: layout.cardPadding.bottom,
    paddingLeft: layout.cardPadding.left,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 },
  date: { marginLeft: 'auto' },
  // The quote hangs in the card's left padding, so the claim's text keeps the card's reading line.
  claim: { marginTop: 12 },
  quote: { position: 'absolute', left: -16, top: 5, ...PASS_THROUGH },
  reasonWell: { marginTop: 10 },
  reasonWellInner: { paddingTop: 11, paddingRight: 14, paddingBottom: 12, paddingLeft: 14 },
  byline: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  // Reserves the byline's two 18-line rows while the participation loads, so the card does not grow.
  bylineText: { flex: 1, minWidth: 0, minHeight: 40 },
  verdict: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, minHeight: 52, paddingTop: 12 },
  verdictText: { flex: 1, minWidth: 0 },
});
