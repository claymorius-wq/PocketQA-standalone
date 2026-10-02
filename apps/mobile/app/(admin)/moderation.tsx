import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { api, ApiError } from '../../src/api/client';
import { useFocusRefetch, useAdminStudies } from '../../src/lib/queries';
import { space } from '../../src/theme/tokens';
import { Button, Card, ConfirmSheet, EmptyState, Field, Notice, QueryState, Row, Screen, StatusPill, Text } from '../../src/ui';

export default function Moderation() {
  const q = useAdminStudies();
  useFocusRefetch(q);
  const qc = useQueryClient();
  const [target, setTarget] = useState<{ id: string; action: 'suspend' | 'reinstate' } | null>(null);
  const [reason, setReason] = useState('');
  const mod = useMutation({
    mutationFn: () => api('moderateStudy', { params: { id: target!.id }, body: { action: target!.action, reason } }),
    onSuccess: () => {
      setTarget(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['adminStudies'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
  return (
    <Screen title="Moderation" subtitle="Published and past studies" testID="moderation-screen">
      <QueryState query={q} empty={(d) => (d.items.length === 0 ? <EmptyState icon={ShieldCheck} title="Nothing to moderate" body="Published studies appear here." /> : null)}>
        {(d) => (
          <View style={{ gap: space.md }}>
            {d.items.map((s) => (
              <Card key={s.id}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <StatusPill status={s.status} />
                  <StatusPill status={s.moderation} label={s.moderation === 'ok' ? 'Visible' : 'Suspended'} />
                </Row>
                <Text variant="heading">{s.title}</Text>
                <Text variant="small" tone="muted" numberOfLines={2}>{s.objective}</Text>
                <Button
                  label={s.moderation === 'ok' ? 'Suspend' : 'Reinstate'}
                  icon={s.moderation === 'ok' ? ShieldAlert : ShieldCheck}
                  variant={s.moderation === 'ok' ? 'danger' : 'secondary'}
                  onPress={() => setTarget({ id: s.id, action: s.moderation === 'ok' ? 'suspend' : 'reinstate' })}
                  testID="moderate-study"
                />
              </Card>
            ))}
          </View>
        )}
      </QueryState>
      <ConfirmSheet visible={!!target} title={target?.action === 'suspend' ? 'Suspend study?' : 'Reinstate study?'} body="Every moderation action is recorded in the audit log with your reason." confirmLabel={target?.action === 'suspend' ? 'Suspend' : 'Reinstate'} destructive={target?.action === 'suspend'} confirmDisabled={reason.trim().length < 5} loading={mod.isPending} onCancel={() => setTarget(null)} onConfirm={() => mod.mutate()}>
        <Field label="Reason" value={reason} onChangeText={setReason} multiline testID="moderation-reason" />
        {mod.error ? <Notice tone="danger" title="Action failed">{(mod.error as ApiError).message}</Notice> : null}
      </ConfirmSheet>
    </Screen>
  );
}
