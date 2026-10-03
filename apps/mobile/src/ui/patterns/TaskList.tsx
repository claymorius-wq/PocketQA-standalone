import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { GlassSurface } from '../../glass';
import { useTheme } from '../../theme/ThemeProvider';
import { Text } from '../text';
import { Hairline } from './ListRow';

/** A task as the screens hold it (contracts `tasks[]`). */
export type TaskItem = { id: string; instruction: string; successCriteria?: string | null };

export type TaskListProps = {
  tasks: readonly TaskItem[];
  /**
   * `steps` (A-Study, A-Session, A-Review): one L1 card, each task a step with the DM Mono label
   * "TASK 1", the instruction as a 19/24 title, "Done when: …", then `renderStep`'s content (the
   * notes well, the saved note). `numbered` (A-BStudy): a bare list, "1." in violet mono beside
   * the instruction at 15/22.
   */
  variant?: 'steps' | 'numbered';
  /** Extra content under a step: the tester's notes field and Save, or the read-only note. */
  renderStep?: (task: TaskItem, index: number) => ReactNode;
  /** testID per step; default `task-${index}` (the screens' existing ids). */
  stepTestID?: (index: number) => string | undefined;
  testID?: string;
};

/**
 * The task stepper. Steps are read in order with their position ("Task 1 of 2") and dividers
 * between them are the fading hairline. Nothing animates here: a step's own content (a notice,
 * the Saved swap) brings its motion.
 */
export function TaskList({ tasks, variant = 'steps', renderStep, stepTestID = (i) => `task-${i}`, testID }: TaskListProps) {
  const { colors, type } = useTheme();
  if (variant === 'numbered') {
    return (
      <View testID={testID} role="list">
        {tasks.map((t, i) => (
          <View key={t.id} role="listitem" testID={stepTestID(i)} style={styles.numberedRow}>
            {i > 0 ? <Hairline inset={4} /> : null}
            <RNText style={[type.label, styles.number, { color: colors.violet }]}>{`${i + 1}.`}</RNText>
            <RNText style={[type.body, styles.flex, { color: colors.text }]}>{t.instruction}</RNText>
          </View>
        ))}
      </View>
    );
  }
  return (
    <GlassSurface level="card" testID={testID} role="list" style={styles.card}>
      {tasks.map((t, i) => (
        <View key={t.id} role="listitem" testID={stepTestID(i)} style={styles.step}>
          {i > 0 ? <Hairline inset={-2} style={styles.stepRule} /> : null}
          <Text variant="label" tone="muted">{`TASK ${i + 1}`}</Text>
          <RNText accessibilityHint={`Task ${i + 1} of ${tasks.length}`} style={[type.title, { color: colors.text }]}>
            {t.instruction}
          </RNText>
          {t.successCriteria ? <Text variant="small" tone="muted">{`Done when: ${t.successCriteria}`}</Text> : null}
          {renderStep ? renderStep(t, i) : null}
        </View>
      ))}
    </GlassSurface>
  );
}

const styles = StyleSheet.create({
  // Board padding 18 18 18 20 inside the rim; steps 18 apart with the hairline halfway.
  card: { paddingTop: 18, paddingRight: 18, paddingBottom: 18, paddingLeft: 20, gap: 18 },
  step: { gap: 6 },
  stepRule: { top: -9, right: -2 },
  numberedRow: { flexDirection: 'row', gap: 6, paddingVertical: 12, paddingHorizontal: 4 },
  // "1." in DM Mono 500 13/22, violet (the section numerals' colour), in a 26dp column.
  number: { width: 26, fontSize: 13, lineHeight: 22, letterSpacing: 0 },
  flex: { flex: 1 },
});
