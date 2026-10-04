import type { Study } from '@pocket-qa/contracts';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { GlassTile } from '../icons';
import { credits } from '../lib/format';
import { useTheme } from '../theme/ThemeProvider';
import { Card, StatusPill, Text } from '../ui';
import { SlotMeter } from '../ui/patterns';

// The builder study card (A-BStudies): the whole L1 card is one button. The status pill row
// (plus the moderation pill when suspended), the title 19/24 beside the 32dp chevron tile, then
// the slot meter's well on the left and the reward and the available credits on the right.

/** Light distance down the list (A-BStudies CARD_SH, §2 cardK): 1, 0.8, 0.64, then 0.51 for the rest. */
const LIST_K = [1, 0.8, 0.64, 0.512] as const;
/** A closed study takes one further 0.64 step (unlit glass). */
const CLOSED_STEP = 0.64;

export function studyCardK(index: number, status: string): number {
  const k = LIST_K[Math.min(Math.max(0, index), LIST_K.length - 1)]!;
  return status === 'closed' ? k * CLOSED_STEP : k;
}

/**
 * Slots whose reward was awarded, for the meter's pale pips. The list carries the awarded credits
 * (reward and dispute credits, `budget.awarded`) and the per-slot reward, which only drafts can
 * change, so each awarded slot is one reward. Never more than the slots taken.
 */
export function awardedSlots(s: Pick<Study, 'rewardCredits' | 'slotsFilled' | 'budget'>): number {
  if (s.rewardCredits <= 0) return 0;
  return Math.max(0, Math.min(s.slotsFilled, Math.floor(s.budget.awarded / s.rewardCredits)));
}

export function BuilderStudyCard({ study: s, index, onPress }: { study: Study; index: number; onPress: () => void }) {
  const { colors, type } = useTheme();
  return (
    <Card onPress={onPress} testID={`builder-study-${s.id}`} accessibilityLabel={`Open study ${s.title}`} k={studyCardK(index, s.status)} style={styles.card}>
      <View style={styles.pills}>
        <StatusPill status={s.status} testID="builder-study-status" />
        {s.moderation === 'suspended' ? <StatusPill status="suspended" label="Suspended by moderation" /> : null}
      </View>
      <View style={styles.titleRow}>
        <Text variant="title" style={styles.title}>{s.title}</Text>
        <GlassTile name="chevron" size="chip" style={styles.chevron} />
      </View>
      <View style={styles.footer}>
        <SlotMeter slots={s.slots} filled={s.slotsFilled} awarded={awardedSlots(s)} status={s.status} />
        <View style={styles.money}>
          <Text variant="small" tone="muted" style={styles.right}>{credits(s.rewardCredits)} each</Text>
          <View style={styles.available}>
            <RNText style={[type.display, styles.availableValue, { color: colors.text }]}>{s.budget.available.toLocaleString('en-US')}</RNText>
            <Text variant="small" tone="muted">available</Text>
          </View>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  // Board padding 16 16 16 18; each block spaces itself (12, 14), so the kit card's gap is off.
  card: { gap: 0, paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 18 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 12 },
  title: { flex: 1 },
  chevron: { marginTop: -4 },
  footer: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, marginTop: 14 },
  money: { flexShrink: 1, alignItems: 'flex-end', gap: 2, paddingBottom: 1 },
  right: { textAlign: 'right' },
  available: { flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  // Red Hat Display 400 at 22/26 (the display face at the board's figure size), tabular.
  availableValue: { fontSize: 22, lineHeight: 26, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
});
