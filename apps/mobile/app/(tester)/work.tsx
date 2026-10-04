import { formatUnits, tokenAmount } from '../../src/lib/money';
import { router } from 'expo-router';
import { ClipboardList, Compass } from 'lucide-react-native';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { Participation } from '@pocket-qa/contracts';
import { statusLabel, when } from '../../src/lib/format';
import { useFocusRefetch, useMyParticipations } from '../../src/lib/queries';
import { useTheme } from '../../src/theme/ThemeProvider';
import { layout } from '../../src/theme/tokens';
import { GlassTile } from '../../src/icons';
import { Button, Card, EmptyState, QueryState, Screen, StatusPill } from '../../src/ui';
import { DateText, RewardWell, rewardPhrase } from '../../src/ui/patterns';
import { ScreenContext } from '../../src/ui/screen';

// My work (A-Work, Direction A §13): the tester's sessions as L1 cards, in the order the server
// sends them (the board has no status groups). Each card is one button: the status pill (the live LED on
// IN PROGRESS) beside the 32dp chevron tile, then "Joined <date>" and the reward in its lens well.
// Signature: a status that changes on refetch swaps only its pill, in 120ms (StatusPill); the
// light never moves here. A list that changes after the screen has arrived is new content and
// rises 6dp over 240ms (ease-lens; a 120ms fade under reduced motion), the list only.

export default function Work() {
  const q = useMyParticipations();
  useFocusRefetch(q);
  return (
    <Screen title="My work" subtitle="Sessions you’ve joined" testID="work-screen">
      <QueryState
        query={q}
        empty={(d) =>
          d.items.length === 0 ? (
            <NewContent contentKey="empty">
              <EmptyState
                icon={ClipboardList}
                title="Nothing here yet"
                body="Join a study from Discover to start a session."
                action={<Button label="Find studies" variant="secondary" icon={Compass} onPress={() => router.push('/discover')} />}
                actionStretch
              />
            </NewContent>
          ) : null
        }
      >
        {(d) => (
          <NewContent contentKey={d.items.map((p) => p.id).join('|')}>
            {d.items.map((p) => (
              <SessionCard key={p.id} p={p} />
            ))}
          </NewContent>
        )}
      </QueryState>
    </Screen>
  );
}

/** "50 test credits" / "if approved" beside the numeral; one test credit reads singular, as `credits()` does. */
function rewardUnit(n: number): readonly [string, string] {
  return [n === 1 ? 'test credit' : 'test credits', 'if approved'];
}

function SessionCard({ p }: { p: Participation }) {
  // One accessibility stop: the label opens the session, the hint reads what the card shows.
  const token = p.reward.kind === 'token' ? p.reward : null;
  const hint = `${statusLabel[p.status] ?? p.status}. Joined ${when(p.consentedAt)}. ${token ? `${tokenAmount(token.units)} if approved` : rewardPhrase(p.rewardCredits, rewardUnit(p.rewardCredits))}.`;
  return (
    <Card onPress={() => router.push(`/participation/${p.id}`)} testID={`participation-card-${p.id}`} accessibilityLabel="Open session" accessibilityHint={hint} style={styles.card}>
      <View style={styles.top}>
        <StatusPill status={p.status} label={statusLabel[p.status]} testID={`participation-status-${p.id}`} />
        <GlassTile name="chevron" size="chip" style={styles.chevron} />
      </View>
      <View style={styles.bottom}>
        <View style={styles.joined}>
          <DateText verb="Joined" iso={p.consentedAt} />
        </View>
        {token ? <RewardWell amount={0} display={formatUnits(token.units)} unit={['simulated USDC', 'if approved']} /> : <RewardWell amount={p.rewardCredits} unit={rewardUnit(p.rewardCredits)} />}
      </View>
    </Card>
  );
}

/**
 * The board's list swap (A-Work `an.list`): content that mounts or changes after the screen's own
 * arrival (the list replacing the loading row, an empty state turning into a list, a session added
 * or gone on refetch) rises 6dp and fades in over dur-swap ease-lens; reduced motion fades over
 * 120ms in place. Content that arrives with the screen rides its arrival and does not move again.
 * A status change alone keeps the same ids, so only its pill swaps.
 */
function NewContent({ contentKey, children }: { contentKey: string; children: ReactNode }) {
  const { motion } = useTheme();
  const screen = useContext(ScreenContext);
  const [lateMount] = useState(() => !!screen && Date.now() > (screen.settledAt ?? screen.mountedAt));
  const progress = useSharedValue(lateMount ? 0 : 1);
  const rise = motion.entrance.headerRise;
  const last = useRef<string | null>(lateMount ? null : contentKey);
  useEffect(() => {
    if (last.current === contentKey) return;
    last.current = contentKey;
    progress.value = 0;
    progress.value = withTiming(1, motion.reduced ? motion.timing.enter : motion.timing.swap);
  }, [contentKey, progress, motion]);
  const style = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateY: (1 - progress.value) * rise }] }));
  return <Animated.View style={[styles.list, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  list: { gap: layout.listGap },
  // The board spaces the rows itself (12 between them), so the kit card's 8dp gap is turned off.
  card: { gap: 0 },
  // The board stacks a study title under the pill; Participation carries no title, so the pill row
  // centres on the chevron and the Joined/reward row sits 8dp below, keeping the card one compact unit.
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  // The board's tile reaches 2dp out into the corner; centring replaces its 2dp lift.
  chevron: { marginRight: -2 },
  bottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8 },
  joined: { flexShrink: 1, minWidth: 0 },
});
