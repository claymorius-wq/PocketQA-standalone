import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Eye, Hourglass, X } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { STUCK_AFTER_DAYS, type StuckSubmission } from '@pocket-qa/contracts';
import { EvidenceItem } from '../../src/evidence/EvidenceItem';
import { api, ApiError } from '../../src/api/client';
import { credits, when } from '../../src/lib/format';
import { useAdminStuck, useEvidence, useFocusRefetch } from '../../src/lib/queries';
import { space } from '../../src/theme/tokens';
import { Button, Card, ConfirmSheet, EmptyState, Field, Notice, QueryState, Row, Screen, StatusPill, Text } from '../../src/ui';

/**
 * Read-only view of the work, so an admin deciding instead of the study owner sees what
 * was asked, the tester's notes and the evidence (playback is admin-authorized server side).
 */
function StuckWork({ item }: { item: StuckSubmission }) {
  const [open, setOpen] = useState(false);
  const ev = useEvidence(item.participation.id, open);
  if (!open) return <Button label="Review work" icon={Eye} variant="secondary" onPress={() => setOpen(true)} testID="stuck-review" />;
  return (
    <View style={{ gap: space.sm }} testID="stuck-work">
      {item.tasks.map((t, i) => (
        <View key={t.id} style={{ gap: space.xs }}>
          <Text variant="label" tone="muted">TASK {i + 1}</Text>
          <Text>{t.instruction}</Text>
          <Text variant="small" testID={`stuck-note-${i}`}>{item.participation.taskNotes.find((n) => n.taskId === t.id)?.note || 'No notes.'}</Text>
        </View>
      ))}
      <QueryState query={ev} empty={(d) => (d.items.length === 0 ? <Text variant="small" tone="muted" testID="stuck-no-evidence">No evidence uploaded.</Text> : null)}>
        {(d) => <View style={{ gap: space.sm }}>{d.items.map((e) => <EvidenceItem key={e.id} e={e} />)}</View>}
      </QueryState>
    </View>
  );
}

export default function Stuck() {
  const q = useAdminStuck();
  useFocusRefetch(q);
  const qc = useQueryClient();
  const [target, setTarget] = useState<{ id: string; decision: 'approve' | 'reject' } | null>(null);
  const [reason, setReason] = useState('');
  const decide = useMutation({
    mutationFn: () => api('adminDecide', { params: { id: target!.id }, body: { decision: target!.decision, reason } }),
    onSuccess: () => {
      setTarget(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['adminStuck'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
  return (
    <Screen title="Stuck work" subtitle={`Submitted work no builder can review: builder suspended or deleted, or waiting ${STUCK_AFTER_DAYS}+ days`} testID="stuck-screen">
      <QueryState query={q} empty={(d) => (d.items.length === 0 ? <EmptyState icon={Hourglass} title="Nothing stuck" body="Submissions appear here only when their builder can't review them." /> : null)}>
        {(d) => (
          <View style={{ gap: space.md }}>
            {d.items.map((s) => (
              <Card key={s.participation.id} testID={`stuck-${s.reason}`}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <StatusPill status="pending" label={s.reason === 'builder_inactive' ? `Builder ${s.builderStatus}` : 'Overdue'} />
                  <Text variant="small" tone="muted">Submitted {when(s.participation.submittedAt)}</Text>
                </Row>
                <Text variant="heading">{s.studyTitle}</Text>
                <Text variant="small">{s.participation.testerDisplayName ?? 'Tester'} · {credits(s.participation.rewardCredits)} on approval · {s.participation.taskNotes.length} note(s)</Text>
                <StuckWork item={s} />
                <Row>
                  <Button label="Approve" icon={Check} onPress={() => setTarget({ id: s.participation.id, decision: 'approve' })} testID="stuck-approve" />
                  <Button label="Reject" icon={X} variant="danger" onPress={() => setTarget({ id: s.participation.id, decision: 'reject' })} testID="stuck-reject" />
                </Row>
              </Card>
            ))}
          </View>
        )}
      </QueryState>
      <ConfirmSheet
        visible={!!target}
        title={target?.decision === 'approve' ? 'Approve stuck submission?' : 'Reject stuck submission?'}
        body="You are deciding instead of the study owner. Your reason is recorded in the audit log and shown to the tester."
        confirmLabel={target?.decision === 'approve' ? 'Approve' : 'Reject'}
        destructive={target?.decision === 'reject'}
        confirmDisabled={reason.trim().length < 10}
        loading={decide.isPending}
        onCancel={() => setTarget(null)}
        onConfirm={() => decide.mutate()}
      >
        <Field label="Reason (audited)" value={reason} onChangeText={setReason} multiline hint="At least 10 characters." testID="stuck-reason" />
        {decide.error ? <Notice tone="danger" title="Not decided" testID="stuck-error">{(decide.error as ApiError).message}</Notice> : null}
      </ConfirmSheet>
    </Screen>
  );
}
