import { router } from 'expo-router';
import { ClipboardList } from 'lucide-react-native';
import { View } from 'react-native';
import { credits, statusLabel, when } from '../../src/lib/format';
import { useFocusRefetch, useMyParticipations } from '../../src/lib/queries';
import { space } from '../../src/theme/tokens';
import { Button, Card, EmptyState, QueryState, Row, Screen, StatusPill, Text } from '../../src/ui';

export default function Work() {
  const q = useMyParticipations();
  useFocusRefetch(q);
  return (
    <Screen title="My work" subtitle="Sessions you’ve joined" testID="work-screen">
      <QueryState
        query={q}
        empty={(d) =>
          d.items.length === 0 ? (
            <EmptyState icon={ClipboardList} title="Nothing here yet" body="Join a study from Discover to start a session." action={<Button label="Find studies" variant="secondary" onPress={() => router.push('/discover')} />} />
          ) : null
        }
      >
        {(d) => (
          <View style={{ gap: space.md }}>
            {d.items.map((p) => (
              <Card key={p.id} onPress={() => router.push(`/participation/${p.id}`)} testID={`participation-card-${p.id}`} accessibilityLabel="Open session">
                <Row style={{ justifyContent: 'space-between' }}>
                  <StatusPill status={p.status} label={statusLabel[p.status]} testID={`participation-status-${p.id}`} />
                  <Text variant="small" tone="muted">Joined {when(p.consentedAt)}</Text>
                </Row>
                <Text variant="heading">{credits(p.rewardCredits)} if approved</Text>
              </Card>
            ))}
          </View>
        )}
      </QueryState>
    </Screen>
  );
}
