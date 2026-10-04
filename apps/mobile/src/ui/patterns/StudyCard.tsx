import { StyleSheet, View } from 'react-native';
import { REWARD_DISCLAIMER } from '@pocket-qa/contracts';
import { GlassTile } from '../../icons';
import { useTheme } from '../../theme/ThemeProvider';
import { Card } from '../card';
import { Text } from '../text';
import { RewardWell, rewardPhrase } from './RewardWell';
import { Clauses, Meta } from './type';

export type StudyCardProps = {
  title: string;
  objective: string;
  /** Reward per approved session, in test credits. */
  rewardCredits: number;
  taskCount: number;
  slotsRemaining: number;
  /** The reward line under the card; default the contracts' REWARD_DISCLAIMER. */
  disclaimer?: string;
  onPress: () => void;
  /** The screens' `study-card-${id}`. */
  testID?: string;
  /** Default "Open study {title}". */
  accessibilityLabel?: string;
  /** Light distance down the list (cardK); default from the screen's entrance step. */
  k?: number;
};

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The Discover study card (A-Discover, Direction A §8 "Study card"): the whole L1 card is one
 * button that sinks into the pressed recipe. Title 19/24 (two lines) beside the 32dp chevron
 * glyph tile; the objective 14/20 muted (two lines); the reward numeral in its lens well with the
 * DM Mono meta ("1 task", "5 slots left") right-aligned on its baseline; the 12/16 disclaimer.
 * The card is one accessibility stop: its label opens the study and its hint reads the facts on it.
 */
export function StudyCard({ title, objective, rewardCredits, taskCount, slotsRemaining, disclaimer = REWARD_DISCLAIMER, onPress, testID, accessibilityLabel, k }: StudyCardProps) {
  const { type } = useTheme();
  const hint = `${rewardPhrase(rewardCredits)}. ${disclaimer.split(' · ').join('. ')}. ${plural(taskCount, 'task', 'tasks')}, ${plural(slotsRemaining, 'slot', 'slots')} left.`;
  return (
    <Card onPress={onPress} testID={testID} accessibilityLabel={accessibilityLabel ?? `Open study ${title}`} accessibilityHint={hint} k={k} style={styles.card}>
      <View style={styles.titleRow}>
        <Text variant="title" numberOfLines={2} style={styles.title}>{title}</Text>
        <GlassTile name="chevron" size="chip" style={styles.chevron} />
      </View>
      <Text variant="bodySm" tone="muted" numberOfLines={2} pretty style={styles.objective}>{objective}</Text>
      <View style={styles.rewardRow}>
        <RewardWell amount={rewardCredits} />
        <View style={styles.meta}>
          <Meta>{plural(taskCount, 'task', 'tasks')}</Meta>
          <Meta>{`${plural(slotsRemaining, 'slot', 'slots')} left`}</Meta>
        </View>
      </View>
      <Clauses parts={disclaimer.split(' · ')} style={[type.disclaimer, styles.note]} />
    </Card>
  );
}

const styles = StyleSheet.create({
  // The board spaces each block itself (6, 18, 12), so the kit card's 8dp gap is turned off.
  card: { gap: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  title: { flex: 1 },
  chevron: { marginTop: -4, marginRight: -2 },
  objective: { marginTop: 6 },
  rewardRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 18 },
  meta: { alignItems: 'flex-end', gap: 4, paddingBottom: 5 },
  note: { marginTop: 12 },
});
