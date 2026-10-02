import { ScrollText } from 'lucide-react-native';
import { View } from 'react-native';
import { when } from '../../src/lib/format';
import { useFocusRefetch, useAudit } from '../../src/lib/queries';
import { space } from '../../src/theme/tokens';
import { Card, EmptyState, QueryState, Row, Screen, Text } from '../../src/ui';

export default function Audit() {
  const q = useAudit();
  useFocusRefetch(q);
  return (
    <Screen title="Audit log" subtitle="Every admin action, newest first" testID="audit-screen">
      <QueryState query={q} empty={(d) => (d.items.length === 0 ? <EmptyState icon={ScrollText} title="No admin actions yet" body="Dispute resolutions and moderation appear here." /> : null)}>
        {(d) => (
          <View style={{ gap: space.sm }}>
            {d.items.map((a) => (
              <Card key={a.id} testID="audit-entry">
                <Row style={{ justifyContent: 'space-between' }}>
                  <Text variant="heading">{a.action}</Text>
                  <Text variant="small" tone="muted">{when(a.createdAt)}</Text>
                </Row>
                <Text variant="small">{a.reason}</Text>
                <Text variant="small" tone="muted">{a.targetType} {a.targetId.slice(0, 8)}</Text>
              </Card>
            ))}
          </View>
        )}
      </QueryState>
    </Screen>
  );
}
