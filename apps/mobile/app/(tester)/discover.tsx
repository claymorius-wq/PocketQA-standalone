import { router } from 'expo-router';
import { ChevronRight, Compass, Smartphone } from 'lucide-react-native';
import { View } from 'react-native';
import { REWARD_DISCLAIMER } from '@pocket-qa/contracts';
import { useSession } from '../../src/auth/SessionProvider';
import { credits } from '../../src/lib/format';
import { useFocusRefetch, useEligible } from '../../src/lib/queries';
import { useTheme } from '../../src/theme/ThemeProvider';
import { space } from '../../src/theme/tokens';
import { Button, Card, EmptyState, Notice, QueryState, Row, Screen, Text } from '../../src/ui';

export default function Discover() {
  const { user } = useSession();
  const { colors } = useTheme();
  const q = useEligible();
  useFocusRefetch(q);
  return (
    <Screen title="Discover" subtitle="Studies that match your device" testID="discover-screen">
      {!user?.device ? (
        <Notice tone="warning" title="Add your device profile" testID="device-missing">
          Studies are matched to your self-reported device. Add it in Settings to see what’s available.
        </Notice>
      ) : null}
      <QueryState
        query={q}
        empty={(d) =>
          d.items.length === 0 ? (
            <EmptyState
              icon={user?.device ? Compass : Smartphone}
              title={user?.device ? 'No matching studies right now' : 'No device profile yet'}
              body={user?.device ? 'New studies appear here when builders publish them. Check back later.' : 'Add your device in Settings to start matching.'}
              action={!user?.device ? <Button label="Open settings" variant="secondary" onPress={() => router.push('/settings')} testID="open-settings" /> : undefined}
            />
          ) : null
        }
      >
        {(d) => (
          <View style={{ gap: space.md }}>
            {d.items.map((s) => (
              <Card key={s.id} onPress={() => router.push(`/study/${s.id}`)} testID={`study-card-${s.id}`} accessibilityLabel={`Open study ${s.title}`}>
                <Row style={{ justifyContent: 'space-between', flexWrap: 'nowrap' }}>
                  <Text variant="title" style={{ flex: 1 }} numberOfLines={2}>{s.title}</Text>
                  <ChevronRight size={20} color={colors.textMuted} />
                </Row>
                <Text tone="muted" numberOfLines={2}>{s.objective}</Text>
                <Row>
                  <Text variant="heading" tone="primary">{credits(s.rewardCredits)}</Text>
                  <Text variant="small" tone="muted">· {s.taskCount} task{s.taskCount === 1 ? '' : 's'} · {s.slotsRemaining} slot{s.slotsRemaining === 1 ? '' : 's'} left</Text>
                </Row>
                <Text variant="small" tone="muted">{REWARD_DISCLAIMER}</Text>
              </Card>
            ))}
          </View>
        )}
      </QueryState>
    </Screen>
  );
}
