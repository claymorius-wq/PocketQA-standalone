import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { GradientRule } from '../../glass/paint';
import { useTheme } from '../../theme/ThemeProvider';
import { ClauseDot } from './type';

// The section rule beside a heading (A-Session "Tasks", "Evidence"): lit at its near end, violet,
// gone by the far end.
const RULE = [
  { offset: 0, color: '#D6E0FF', opacity: 0.22 },
  { offset: 0.4, color: '#8C7BFF', opacity: 0.1 },
  { offset: 1, color: '#D6E0FF', opacity: 0 },
];

export type SectionHeaderProps = {
  title: string;
  /**
   * `heading`: Instrument Sans 600 16/22 (History, Tasks, Participants, Evidence).
   * `label`: DM Mono 500 12/16 uppercase muted (Next in queue, Visible · 2, day labels).
   */
  variant?: 'heading' | 'label';
  /** A count after the title, "Visible · 2" (the section is the status, so rows carry no pill). */
  count?: number;
  /** The fading rule that runs from the title to the far edge (heading only). */
  rule?: boolean;
  /** Trailing content on the header line (a compact action). */
  right?: ReactNode;
  testID?: string;
};

/** A section's header line. It is a header for assistive tech; the count is read with the title. */
export function SectionHeader({ title, variant = 'heading', count, rule = false, right, testID }: SectionHeaderProps) {
  const { colors, type } = useTheme();
  const label = variant === 'label';
  // The label's count sits 0.28em either side of the dot (A-Moderation "VISIBLE · 2"): a DM Mono
  // space is a full 0.6em cell, so the two spaces are set at the size that makes them 0.28em,
  // untracked. The text still reads "Visible · 2" as one string.
  const gap = <RNText style={[styles.sepSpace, { fontSize: type.label.fontSize ? type.label.fontSize * SEP_SPACE : undefined }]}> </RNText>;
  const content =
    count === undefined ? (label ? title.toUpperCase() : title) : label ? (
      <>
        {title.toUpperCase()}
        {gap}·{gap}
        {count}
      </>
    ) : (
      <>
        {title}
        <ClauseDot fontSize={type.heading.fontSize} fontFamily={type.heading.fontFamily} />
        {count}
      </>
    );
  return (
    <View testID={testID} style={[styles.row, label ? styles.labelRow : styles.headingRow]}>
      <RNText accessibilityRole="header" style={[label ? type.label : type.heading, { color: label ? colors.textMuted : colors.text }]}>
        {content}
      </RNText>
      {rule && !label ? <GradientRule stops={RULE} style={styles.rule} /> : null}
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

/** A mono space set at this fraction of the label size is 0.28em of it (0.28 / 0.6). */
const SEP_SPACE = 0.28 / 0.6;

const styles = StyleSheet.create({
  sepSpace: { letterSpacing: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headingRow: { paddingLeft: 4, paddingRight: 2 },
  labelRow: { marginLeft: 4 },
  rule: { flex: 1, height: 1 },
  right: { marginLeft: 'auto' },
});
