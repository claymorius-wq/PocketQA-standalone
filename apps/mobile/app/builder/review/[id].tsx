import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { Evidence } from '@pocket-qa/contracts';
import { api, ApiError } from '../../../src/api/client';
import { PASS_THROUGH, useSvgId } from '../../../src/glass/paint';
import { credits } from '../../../src/lib/format';
import { useAiStatus, useEvidence, useFindings, useParticipation, useStudy, useStudyDisputes } from '../../../src/lib/queries';
import { RequireRole } from '../../../src/screens/RequireRole';
import { canAddFinding, commitStatus, decisionView, type DecisionKind } from '../../../src/screens/review/decision';
import { EvidenceStrip } from '../../../src/screens/review/EvidenceStrip';
import { AiPanel, DecisionNotice, DisputeCard, DockSlot, EvidenceEmpty, FindingsList, FormCard, ReviewHead, ReviewSection, TaskNotes } from '../../../src/screens/review/ReviewParts';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { layout } from '../../../src/theme/tokens';
import { Button, ConfirmSheet, Field, Notice, QueryState, Screen, Segmented, Text } from '../../../src/ui';
import { DecisionBar, SectionHeader } from '../../../src/ui/patterns';
import { TransferCard } from '../../../src/wallet/TransferCard';

// Builder review (A-Review, Direction A v2). The participant head with the reward well, the AI
// panel, the task notes, the evidence strip (its opening reveal is the screen's signature), the
// findings and the form, then the decision: a docked "Decision" bar (L3, the screen's one blur)
// opens the Approve sheet (U7: pilot while open, the Commit pass after success, then the tail lands
// on the "Decision: Approved" notice as the dock leaves) or the Reject sheet (destructive, unlit,
// a reason of at least 10 characters).

/** The ground scrim's fade above the dock's top edge; below the fade it is solid to the screen's bottom. */
const SCRIM_FADE = 32;
/** The content ends where the scrim's fade begins, so nothing at rest sits in the fade. */
const DOCK_CLEARANCE = SCRIM_FADE;
const DECORATIVE = { accessible: false, importantForAccessibility: 'no-hide-descendants', 'aria-hidden': true } as const;

function FindingForm({ participationId, evidence }: { participationId: string; evidence: Evidence[] }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<'blocker' | 'major' | 'minor' | 'info'>('major');
  const [description, setDescription] = useState('');
  const [evidenceId, setEvidenceId] = useState<string>('none');
  const create = useMutation({
    mutationFn: () => api('createFinding', { params: { id: participationId }, body: { title, severity, description, ...(evidenceId !== 'none' ? { evidenceId } : {}) } }),
    onSuccess: () => {
      setTitle('');
      setDescription('');
      qc.invalidateQueries({ queryKey: ['findings', participationId] });
    },
  });
  return (
    <ReviewSection>
      <SectionHeader title="Add a finding" />
      <FormCard testID="finding-form">
        <Field label="Title" value={title} onChangeText={setTitle} testID="finding-title" />
        <Segmented
          testID="finding-severity"
          value={severity}
          onChange={setSeverity}
          options={[
            { value: 'blocker', label: 'Blocker' },
            { value: 'major', label: 'Major' },
            { value: 'minor', label: 'Minor' },
            { value: 'info', label: 'Info' },
          ]}
        />
        <Field label="What happened" value={description} onChangeText={setDescription} multiline testID="finding-description" />
        {evidence.length ? (
          <View style={styles.field}>
            <Text variant="label" tone="muted">LINKED EVIDENCE</Text>
            <Segmented
              testID="finding-evidence"
              value={evidenceId}
              onChange={setEvidenceId}
              options={[{ value: 'none', label: 'None' }, ...evidence.map((e, i) => ({ value: e.id, label: `#${i + 1}` }))]}
            />
          </View>
        ) : null}
        {create.error ? <Notice tone="danger" title="Finding not saved" testID="finding-error">{(create.error as ApiError).message}</Notice> : null}
        <Button label="Add finding" icon="plus" onPress={() => create.mutate()} disabled={title.trim().length < 3 || description.trim().length < 5} loading={create.isPending} testID="finding-submit" />
      </FormCard>
    </ReviewSection>
  );
}

function ReviewInner() {
  const { glass, motion } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pq = useParticipation(id);
  const study = useStudy(pq.data?.studyId ?? '');
  const ev = useEvidence(id);
  const findings = useFindings(id);
  const ai = useAiStatus();
  const disputes = useStudyDisputes(pq.data?.studyId ?? '');
  const dispute = disputes.data?.items.find((d) => d.participationId === id);
  const qc = useQueryClient();
  // The sheet's kind outlives its visibility, so a closing sheet keeps its own title and fields.
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<DecisionKind>('approve');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  // U7: the Commit pass is playing in the Approve sheet (the request has succeeded).
  const [passing, setPassing] = useState(false);
  // In-session approvals: each one lands the U7 tail on the Decision notice once.
  const [landed, setLanded] = useState(0);
  const lit = glass.enabled && motion.play.uplightCommit;
  const decide = useMutation({
    mutationFn: (d: DecisionKind) =>
      d === 'approve' ? api('approve', { params: { id }, body: note.trim() ? { note } : {} }) : api('reject', { params: { id }, body: { reason } }),
    onSuccess: (p, d) => {
      // A lit Approve keeps its sheet for the Commit pass and the sheet's onLeave closes it; Reject,
      // reduced motion and the flat light theme close now.
      if (d === 'approve' && lit) setPassing(true);
      else setOpen(false);
      qc.setQueryData(['participation', id], p);
      qc.invalidateQueries({ queryKey: ['studyParticipations', p.studyId] });
      qc.invalidateQueries({ queryKey: ['study', p.studyId] });
    },
  });
  const openSheet = (k: DecisionKind) => {
    decide.reset();
    setKind(k);
    setOpen(true);
  };
  const p = pq.data;
  const view = p ? decisionView(p, passing) : { dock: false, notice: false };

  // The Decision bar is the Screen's dock: the L3 overlay over the content, arriving with the
  // screen's content root; the content ends above it. Edge placement so the dock paints the ground
  // scrim (as Builder study and New study do) from just above its top edge to the screen's bottom:
  // nothing scrolled reads through the glass or shows in the gutter around it. The dock keeps the
  // L3 position itself (12 in from the edges, above the bottom inset) and the scrim leaves with it.
  return (
    <Screen
      testID="review-screen"
      dockPlacement="edge"
      dockClearance={DOCK_CLEARANCE}
      dock={
        // Hidden while QueryState shows the error panel: the sheet lives inside it (as Builder study).
        <DockSlot shown={view.dock && !pq.error} style={styles.boxNone}>
          <DockScrim />
          {/* The gutters sit on an outer View and the capped column inside it (as Builder study's
              dock): width '100%' on the View that carries the margins would overflow them. */}
          <View style={[styles.boxNone, { marginLeft: layout.tabBarInset + insets.left, marginRight: layout.tabBarInset + insets.right, marginBottom: layout.tabBarInset + insets.bottom }]}>
            <View style={[styles.dockColumn, styles.boxNone]}>
              <DecisionBar
                docked
                title="Decision"
                negative={{ label: 'Reject', icon: 'reject', onPress: () => openSheet('reject'), testID: 'review-reject' }}
                positive={{ label: 'Approve', icon: 'approve', onPress: () => openSheet('approve'), testID: 'review-approve' }}
              />
            </View>
          </View>
        </DockSlot>
      }
    >
          <QueryState query={pq}>
            {(p) => (
              <>
                <ReviewHead p={p} />
                <AiPanel available={!!ai.data?.available} />
                <TaskNotes tasks={study.data?.tasks ?? []} notes={p.taskNotes} />
                <ReviewSection>
                  <SectionHeader title="Evidence" />
                  <QueryState query={ev} empty={(d) => (d.items.length === 0 ? <EvidenceEmpty title="No evidence uploaded" body="The tester submitted without recordings or screenshots." /> : null)}>
                    {(d) => <EvidenceStrip items={d.items} />}
                  </QueryState>
                </ReviewSection>
                {findings.data?.items.length || !canAddFinding(p.status) ? (
                  <ReviewSection>
                    <SectionHeader title="Findings" />
                    {findings.data?.items.length ? <FindingsList items={findings.data.items} /> : null}
                    {!canAddFinding(p.status) ? <Text tone="muted" style={styles.inset}>Findings can be added after the tester submits.</Text> : null}
                  </ReviewSection>
                ) : null}
                {canAddFinding(p.status) ? <FindingForm participationId={p.id} evidence={ev.data?.items ?? []} /> : null}
                {view.notice ? <DecisionNotice p={p} land={landed} testID="review-decided" /> : null}
                {dispute ? <DisputeCard dispute={dispute} /> : null}
                {!passing && (p.status === 'approved' || (p.status === 'resolved' && dispute?.outcome === 'overturned')) ? (
                  <TransferCard participationId={p.id} role="builder" canStart />
                ) : null}
                <ConfirmSheet
                  visible={open}
                  title={kind === 'approve' ? `Approve and credit ${credits(p.rewardCredits)}?` : 'Reject this submission?'}
                  body={kind === 'approve' ? 'The tester is credited once. This can’t be undone.' : 'Give a clear reason. The tester can dispute within 7 days.'}
                  confirmLabel={kind === 'approve' ? 'Approve' : 'Reject'}
                  destructive={kind === 'reject'}
                  confirmDisabled={kind === 'reject' && reason.trim().length < 10}
                  // The sheet locks both actions through the Commit pass itself (C4), without a spinner.
                  loading={decide.isPending}
                  status={kind === 'approve' ? commitStatus({ passing, isPending: decide.isPending, isError: decide.isError }) : undefined}
                  onLeave={() => {
                    setPassing(false);
                    setOpen(false);
                    setLanded((n) => n + 1);
                  }}
                  onCancel={() => setOpen(false)}
                  onConfirm={() => decide.mutate(kind)}
                >
                  {kind === 'reject' ? <Field label="Reason" value={reason} onChangeText={setReason} multiline hint="At least 10 characters." testID="reject-reason" /> : <Field label="Note to tester (optional)" value={note} onChangeText={setNote} testID="approve-note" />}
                  {decide.error ? <Notice tone="danger" title="Decision not saved" testID="decision-error">{(decide.error as ApiError).message}</Notice> : null}
                </ConfirmSheet>
              </>
            )}
          </QueryState>
    </Screen>
  );
}

/**
 * The ground behind the dock (Builder study's scrim, static): clear SCRIM_FADE above the dock's top
 * edge, solid from there to the screen's bottom, ending on the ground's base colour (flat theme:
 * the background throughout).
 */
function DockScrim() {
  const { colors, glass } = useTheme();
  const id = useSvgId('rv-scrim');
  const [height, setHeight] = useState(0);
  const base = glass.ground.base.stops;
  const top = colors.background;
  const end = glass.enabled ? (base[base.length - 1]?.color ?? colors.background) : colors.background;
  return (
    <View {...DECORATIVE} onLayout={(e) => setHeight(e.nativeEvent.layout.height)} style={[styles.scrim, PASS_THROUGH]}>
      {height > 0 ? (
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <Stop offset={0} stopColor={top} stopOpacity={0} />
              <Stop offset={Math.min(1, SCRIM_FADE / height)} stopColor={top} stopOpacity={1} />
              <Stop offset={1} stopColor={end} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
        </Svg>
      ) : null}
    </View>
  );
}

export default function Review() {
  return (
    <RequireRole role="builder">
      <ReviewInner />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  inset: { paddingLeft: 4 },
  boxNone: { pointerEvents: 'box-none' },
  dockColumn: { width: '100%', maxWidth: 744, alignSelf: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, top: -SCRIM_FADE, bottom: 0 },
});
