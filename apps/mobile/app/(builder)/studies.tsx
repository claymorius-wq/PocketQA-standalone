import { router } from 'expo-router';
import { FlaskConical, Plus } from 'lucide-react-native';
import { View } from 'react-native';
import { credits } from '../../src/lib/format';
import { useFocusRefetch, useStudies } from '../../src/lib/queries';
import { space } from '../../src/theme/tokens';
import { Button, Card, EmptyState, QueryState, Row, Screen, StatusPill, Text } from '../../src/ui';

export default function Studies() {
  const q = useStudies();
  useFocusRefetch(q);
  const newBtn = <Button label="New" icon={Plus} onPress={() => router.push('/builder/new-study')} testID="new-study" />;
  return (
    <Screen title="Studies" subtitle="Your usability studies" right={newBtn} testID="studies-screen">
      <QueryState
        query={q}
        empty={(d) =>
          d.items.length === 0 ? (
            <EmptyState icon={FlaskConical} title="No studies yet" body="Create a study with tasks and device criteria, then fund it with test credits to publish." action={<Button label="Create a study" icon={Plus} onPress={() => router.push('/builder/new-study')} testID="empty-new-study" />} />
          ) : null
        }
      >
        {(d) => (
          <View style={{ gap: space.md }}>
            {d.items.map((s) => (
              <Card key={s.id} onPress={() => router.push(`/builder/study/${s.id}`)} testID={`builder-study-${s.id}`} accessibilityLabel={`Open study ${s.title}`}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <StatusPill status={s.status} testID="builder-study-status" />
                  {s.moderation === 'suspended' ? <StatusPill status="suspended" label="Suspended by moderation" /> : null}
                </Row>
                <Text variant="title">{s.title}</Text>
                <Text variant="small" tone="muted">
                  {s.slotsFilled}/{s.slots} slots · {credits(s.rewardCredits)} each · {s.budget.available.toLocaleString('en-US')} available
                </Text>
              </Card>
            ))}
          </View>
        )}
      </QueryState>
    </Screen>
  );
}
