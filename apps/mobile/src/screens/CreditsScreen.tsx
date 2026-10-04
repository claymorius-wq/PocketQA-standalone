import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Coins, Plus } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { CREDITS_DISCLAIMER } from '@pocket-qa/contracts';
import { api, ApiError } from '../api/client';
import { useSession } from '../auth/SessionProvider';
import { credits, when } from '../lib/format';
import { useCredits, useFocusRefetch } from '../lib/queries';
import { space } from '../theme/tokens';
import { Button, Card, EmptyState, Notice, QueryState, Row, Screen, Section, Segmented, Text } from '../ui';

const KIND_LABEL: Record<string, string> = {
  test_topup: 'Local test top-up',
  study_reserve: 'Reserved for a study',
  reward_credit: 'Approved work',
  study_release: 'Released from a closed study',
  dispute_credit: 'Dispute overturned',
};

export function CreditsScreen({ title }: { title: string }) {
  const { user, features } = useSession();
  const q = useCredits();
  useFocusRefetch(q);
  const qc = useQueryClient();
  const [amount, setAmount] = useState<'500' | '1000' | '5000'>('1000');
  const topUp = useMutation({
    mutationFn: () => api('topUp', { body: { amount: Number(amount) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credits'] }),
  });
  return (
    <Screen title={title} subtitle={CREDITS_DISCLAIMER} testID="credits-screen">
      <QueryState query={q}>
        {(data) => (
          <>
            <Card testID="balance-card">
              <Text variant="label" tone="muted">BALANCE</Text>
              <Text variant="display" testID="credit-balance">{credits(data.balance)}</Text>
              <Text variant="small" tone="muted">{data.disclaimer}. Credits can’t be withdrawn or exchanged.</Text>
            </Card>
            {user?.role === 'builder' && !features.testCredits ? (
              <Notice tone="info" title="Funding isn’t available yet" testID="funding-unavailable">
                Test credits are off on this deployment, and paying with real money isn’t enabled yet. You can draft studies; publishing needs funding.
              </Notice>
            ) : null}
            {user?.role === 'builder' && features.testCredits ? (
              <Card>
                <Text variant="heading">Add local test credits</Text>
                <Text variant="small" tone="muted">Fund studies in this local build. No money changes hands.</Text>
                <Segmented
                  testID="topup-amount"
                  value={amount}
                  onChange={setAmount}
                  options={[
                    { value: '500', label: '500' },
                    { value: '1000', label: '1,000' },
                    { value: '5000', label: '5,000' },
                  ]}
                />
                {topUp.error ? <Notice tone="danger" title="Top-up failed">{(topUp.error as ApiError).message}</Notice> : null}
                <Button label="Add test credits" icon={Plus} onPress={() => topUp.mutate()} loading={topUp.isPending} testID="topup-submit" />
              </Card>
            ) : null}
            <Section title="History">
              {data.entries.length === 0 ? (
                <EmptyState
                  icon={Coins}
                  title="No activity yet"
                  body={user?.role === 'tester' ? 'Credits appear here when a builder approves your work.' : 'Top-ups, study reserves and releases appear here.'}
                />
              ) : (
                <View style={{ gap: space.sm }}>
                  {data.entries.map((e) => (
                    <Card key={e.id} testID={`ledger-${e.kind}`}>
                      <Row style={{ justifyContent: 'space-between' }}>
                        <Text variant="heading">{KIND_LABEL[e.kind] ?? e.kind}</Text>
                        <Text variant="heading" tone={e.amount >= 0 ? 'success' : 'default'}>
                          {e.amount >= 0 ? '+' : '−'}
                          {Math.abs(e.amount).toLocaleString('en-US')}
                        </Text>
                      </Row>
                      <Text variant="small" tone="muted">{when(e.createdAt)}</Text>
                    </Card>
                  ))}
                </View>
              )}
            </Section>
          </>
        )}
      </QueryState>
    </Screen>
  );
}
