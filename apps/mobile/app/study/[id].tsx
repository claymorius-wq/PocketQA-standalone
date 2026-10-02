import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RequireRole } from '../../src/screens/RequireRole';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowRight, ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { REWARD_DISCLAIMER } from '@pocket-qa/contracts';
import { api, ApiError } from '../../src/api/client';
import { credits } from '../../src/lib/format';
import { recordingCapability } from '../../src/lib/capability';
import { useTesterStudy } from '../../src/lib/queries';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button, Card, Checkbox, Notice, QueryState, Row, Screen, Section, Text } from '../../src/ui';

function StudyDetailInner() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useTesterStudy(id);
  const qc = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const cap = recordingCapability();
  const consent = useMutation({
    mutationFn: (v: number) => api('consent', { params: { id }, body: { consentVersion: v, accepted: true } }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['eligible'] });
      qc.invalidateQueries({ queryKey: ['participations'] });
      router.replace(`/participation/${p.id}`);
    },
  });
  return (
    <Screen testID="study-detail-screen">
      <QueryState query={q}>
        {(s) => (
          <>
            <Text variant="display">{s.title}</Text>
            <Text tone="muted">{s.objective}</Text>
            <Card>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="heading" tone="primary">{credits(s.rewardCredits)}</Text>
                <Text variant="small" tone="muted">{s.slotsRemaining} slot{s.slotsRemaining === 1 ? '' : 's'} left</Text>
              </Row>
              <Text variant="small" tone="muted" testID="reward-disclaimer">{REWARD_DISCLAIMER}. Test credits have no cash value.</Text>
              {s.buildUnderTest ? <Text variant="small">Build under test: {s.buildUnderTest}</Text> : null}
            </Card>
            <Section title="Tasks">
              {s.tasks.map((t, i) => (
                <Card key={t.id}>
                  <Text variant="label" tone="muted">TASK {i + 1}</Text>
                  <Text>{t.instruction}</Text>
                  {t.successCriteria ? <Text variant="small" tone="muted">Done when: {t.successCriteria}</Text> : null}
                </Card>
              ))}
            </Section>
            <Section title="Recording on this device">
              {cap.available ? (
                <Notice tone="info" title="Screen recording available">Android asks for permission every session. You review every clip and choose what to upload.</Notice>
              ) : (
                <Notice tone="warning" title="Recording unavailable" testID="recording-unavailable">{cap.reason}</Notice>
              )}
            </Section>
            {s.myParticipationId ? (
              <Button label="Open your session" icon={ArrowRight} onPress={() => router.replace(`/participation/${s.myParticipationId}`)} testID="open-session" />
            ) : (
              <Section title="Consent">
                <Card testID="consent-card">
                  <Row>
                    <ShieldCheck size={20} color={colors.primary} />
                    <Text variant="heading">Consent (version {s.consentVersion})</Text>
                  </Row>
                  <Text testID="consent-text">{s.consentText}</Text>
                  <Checkbox checked={agreed} onChange={setAgreed} label="I have read and agree to this consent text." testID="consent-checkbox" />
                  {consent.error ? <Notice tone="danger" title="Couldn’t join" testID="consent-error">{(consent.error as ApiError).message}</Notice> : null}
                  <Button label="Consent and join" onPress={() => consent.mutate(s.consentVersion)} disabled={!agreed} loading={consent.isPending} testID="consent-submit" />
                </Card>
              </Section>
            )}
          </>
        )}
      </QueryState>
    </Screen>
  );
}

export default function StudyDetail() {
  return (
    <RequireRole role="tester">
      <StudyDetailInner />
    </RequireRole>
  );
}
