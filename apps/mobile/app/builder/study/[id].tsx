import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RequireRole } from '../../../src/screens/RequireRole';
import { router, useLocalSearchParams } from 'expo-router';
import { Ban, ChevronRight, Pause, Play, Rocket, Users } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { api, ApiError } from '../../../src/api/client';
import { credits, statusLabel, when } from '../../../src/lib/format';
import { useStudy, useStudyParticipations } from '../../../src/lib/queries';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { space } from '../../../src/theme/tokens';
import { Button, Card, ConfirmSheet, EmptyState, Notice, QueryState, Row, Screen, Section, StatusPill, Text } from '../../../src/ui';

type Action = 'publish' | 'pause' | 'resume' | 'close';
const ROUTE = { publish: 'publishStudy', pause: 'pauseStudy', resume: 'resumeStudy', close: 'closeStudy' } as const;

function BuilderStudyInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const q = useStudy(id);
  const parts = useStudyParticipations(id);
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<Action | null>(null);
  const act = useMutation({
    mutationFn: (a: Action) => api(ROUTE[a], { params: { id } }),
    onSuccess: (s) => {
      setConfirm(null);
      qc.setQueryData(['study', id], s);
      qc.invalidateQueries({ queryKey: ['studies'] });
      qc.invalidateQueries({ queryKey: ['credits'] });
      qc.invalidateQueries({ queryKey: ['studyParticipations', id] });
    },
  });
  const copy: Record<Action, { title: string; body: string; label: string }> = {
    publish: { title: 'Publish this study?', body: 'Reward × slots is reserved from your test credits, and matching testers can join.', label: 'Publish' },
    pause: { title: 'Pause this study?', body: 'No new testers can join. Testers already in progress can finish.', label: 'Pause' },
    resume: { title: 'Resume this study?', body: 'Matching testers can join again.', label: 'Resume' },
    close: { title: 'Close this study?', body: 'Testers who haven’t submitted are withdrawn, and unused credits return to your balance.', label: 'Close study' },
  };
  return (
    <Screen testID="builder-study-screen">
      <QueryState query={q}>
        {(s) => (
          <>
            <Row style={{ justifyContent: 'space-between' }}>
              <StatusPill status={s.status} testID="study-status" />
              {s.moderation === 'suspended' ? <StatusPill status="suspended" label="Suspended by moderation" /> : null}
            </Row>
            <Text variant="display">{s.title}</Text>
            <Text tone="muted">{s.objective}</Text>
            <Card testID="budget-card">
              <Text variant="label" tone="muted">BUDGET · TEST CREDITS</Text>
              <Row style={{ justifyContent: 'space-between' }}>
                <View><Text variant="small" tone="muted">Reserved</Text><Text variant="heading" testID="budget-reserved">{s.budget.reserved.toLocaleString('en-US')}</Text></View>
                <View><Text variant="small" tone="muted">Awarded</Text><Text variant="heading" testID="budget-awarded">{s.budget.awarded.toLocaleString('en-US')}</Text></View>
                <View><Text variant="small" tone="muted">Committed</Text><Text variant="heading">{s.budget.committed.toLocaleString('en-US')}</Text></View>
                <View><Text variant="small" tone="muted">Available</Text><Text variant="heading" testID="budget-available">{s.budget.available.toLocaleString('en-US')}</Text></View>
              </Row>
              <Text variant="small" tone="muted">{credits(s.rewardCredits)} × {s.slots} slots · {s.slotsFilled} filled</Text>
            </Card>
            {act.error ? <Notice tone="danger" title="Action failed" testID="study-action-error">{(act.error as ApiError).message}</Notice> : null}
            <Row>
              {s.status === 'draft' ? <Button label="Publish" icon={Rocket} onPress={() => setConfirm('publish')} testID="study-publish" /> : null}
              {s.status === 'published' ? <Button label="Pause" icon={Pause} variant="secondary" onPress={() => setConfirm('pause')} testID="study-pause" /> : null}
              {s.status === 'paused' ? <Button label="Resume" icon={Play} onPress={() => setConfirm('resume')} testID="study-resume" /> : null}
              {s.status !== 'closed' ? <Button label="Close" icon={Ban} variant="danger" onPress={() => setConfirm('close')} testID="study-close" /> : null}
            </Row>
            <Section title="Tasks">
              {s.tasks.map((t, i) => (
                <Text key={t.id}>{i + 1}. {t.instruction}</Text>
              ))}
            </Section>
            <Section title="Participants">
              <QueryState
                query={parts}
                empty={(d) => (d.items.length === 0 ? <EmptyState icon={Users} title="No testers yet" body={s.status === 'draft' ? 'Publish the study so matching testers can join.' : 'Matching testers will appear here when they consent.'} /> : null)}
              >
                {(d) => (
                  <View style={{ gap: space.sm }}>
                    {d.items.map((p) => (
                      <Card key={p.id} onPress={() => router.push(`/builder/review/${p.id}`)} testID={`builder-participation-${p.id}`} accessibilityLabel={`Review ${p.testerDisplayName ?? 'tester'}`}>
                        <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                          <View style={{ flex: 1, gap: 4 }}>
                            <Text variant="heading">{p.testerDisplayName ?? 'Tester'}</Text>
                            <Row>
                              <StatusPill status={p.status} label={statusLabel[p.status]} />
                              <Text variant="small" tone="muted">{p.submittedAt ? `Submitted ${when(p.submittedAt)}` : `Joined ${when(p.consentedAt)}`}</Text>
                            </Row>
                          </View>
                          <ChevronRight size={20} color={colors.textMuted} />
                        </Row>
                      </Card>
                    ))}
                  </View>
                )}
              </QueryState>
            </Section>
            <ConfirmSheet
              visible={confirm !== null}
              title={confirm ? copy[confirm].title : ''}
              body={confirm ? copy[confirm].body : ''}
              confirmLabel={confirm ? copy[confirm].label : ''}
              destructive={confirm === 'close'}
              loading={act.isPending}
              onCancel={() => setConfirm(null)}
              onConfirm={() => confirm && act.mutate(confirm)}
            >
              {act.error ? <Notice tone="danger" title="Action failed" testID="study-action-sheet-error">{(act.error as ApiError).message}</Notice> : null}
            </ConfirmSheet>
          </>
        )}
      </QueryState>
    </Screen>
  );
}

export default function BuilderStudy() {
  return (
    <RequireRole role="builder">
      <BuilderStudyInner />
    </RequireRole>
  );
}
