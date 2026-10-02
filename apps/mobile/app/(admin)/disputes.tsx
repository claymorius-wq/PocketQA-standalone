import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Gavel } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { api, ApiError } from '../../src/api/client';
import { when } from '../../src/lib/format';
import { useFocusRefetch, useAdminDisputes, useEvidence, useParticipation } from '../../src/lib/queries';
import { space } from '../../src/theme/tokens';
import { Button, Card, ConfirmSheet, EmptyState, Field, Notice, QueryState, Row, Screen, Segmented, StatusPill, Text } from '../../src/ui';

function DisputeContext({ participationId }: { participationId: string }) {
  const p = useParticipation(participationId);
  const ev = useEvidence(participationId);
  if (!p.data) return null;
  return (
    <View style={{ gap: 2 }}>
      <Text variant="small">Rejection reason: {p.data.decisionReason ?? '—'}</Text>
      <Text variant="small" tone="muted">{p.data.testerDisplayName ?? 'Tester'} · {ev.data?.items.length ?? 0} evidence item(s) · {p.data.taskNotes.length} note(s)</Text>
    </View>
  );
}

export default function Disputes() {
  const q = useAdminDisputes();
  useFocusRefetch(q);
  const qc = useQueryClient();
  const [target, setTarget] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'upheld' | 'overturned'>('upheld');
  const [note, setNote] = useState('');
  const resolve = useMutation({
    mutationFn: () => api('resolveDispute', { params: { id: target! }, body: { outcome, note } }),
    onSuccess: () => {
      setTarget(null);
      setNote('');
      qc.invalidateQueries({ queryKey: ['adminDisputes'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
  return (
    <Screen title="Disputes" subtitle="Testers contesting a rejection" testID="disputes-screen">
      <QueryState query={q} empty={(d) => (d.items.length === 0 ? <EmptyState icon={Gavel} title="No disputes" body="When a tester disputes a rejection, it appears here." /> : null)}>
        {(d) => (
          <View style={{ gap: space.md }}>
            {d.items.map((x) => (
              <Card key={x.id} testID={`dispute-${x.status}`}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <StatusPill status={x.status} />
                  <Text variant="small" tone="muted">{when(x.createdAt)}</Text>
                </Row>
                <Text>{x.reason}</Text>
                <DisputeContext participationId={x.participationId} />
                {x.status === 'open' ? (
                  <Button label="Resolve" icon={Gavel} variant="secondary" onPress={() => setTarget(x.id)} testID="dispute-resolve" />
                ) : (
                  <Text variant="small" tone="muted">{x.outcome === 'overturned' ? 'Overturned: reward credited.' : 'Upheld.'} {x.resolutionNote}</Text>
                )}
              </Card>
            ))}
          </View>
        )}
      </QueryState>
      <ConfirmSheet visible={!!target} title="Resolve dispute" body="Overturning credits the tester once from the study budget." confirmLabel="Resolve" confirmDisabled={note.trim().length < 5} loading={resolve.isPending} onCancel={() => setTarget(null)} onConfirm={() => resolve.mutate()}>
        <Segmented
          testID="dispute-outcome"
          value={outcome}
          onChange={setOutcome}
          options={[
            { value: 'upheld', label: 'Uphold rejection' },
            { value: 'overturned', label: 'Overturn' },
          ]}
        />
        <Field label="Resolution note" value={note} onChangeText={setNote} multiline testID="dispute-note" />
        {resolve.error ? <Notice tone="danger" title="Not resolved">{(resolve.error as ApiError).message}</Notice> : null}
      </ConfirmSheet>
    </Screen>
  );
}
