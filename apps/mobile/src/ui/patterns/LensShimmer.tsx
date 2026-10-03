import { StyleSheet, Text as RNText, View } from 'react-native';
import { FlutedLens } from '../../glass';
import { useTheme } from '../../theme/ThemeProvider';
import { Spinner } from '../spinner';

export type LensShimmerProps = {
  /** The row's words, default "Loading…". Also the region's accessible name. */
  label?: string;
  /**
   * Draw the 72dp fluted lens above the row, resolving once (S1: the scene slides 16dp into place
   * over 700ms, the glint crosses at +220). Only where no other lens is on screen (§9): the root
   * "Starting Pocket QA…" and a list region whose header lens has stepped aside.
   */
  lens?: boolean;
  /** Default `loading-state`, the kit's LoadingState id, so either can stand in a QueryState. */
  testID?: string;
};

/**
 * Loading (CONSISTENCY C7, A-States 03), the one build: the kit's LoadingState renders it. The
 * spinner row "Loading…" with `aria-busy`, optionally under the fluted lens. No skeleton cards and no placeholder bars, ever: the lens's refraction
 * shimmer (S1, once, never looping) is the only "shimmer" Lens draws. When data arrives the screen
 * swaps this out and its cards rise with the normal entrance. Reduced motion: the lens is still,
 * the spinner slows to 1600ms.
 */
export function LensShimmer({ label = 'Loading…', lens = false, testID = 'loading-state' }: LensShimmerProps) {
  const { colors, type } = useTheme();
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      aria-busy
      style={lens ? styles.lensColumn : styles.row}
    >
      {lens ? <FlutedLens size={72} /> : null}
      <View style={styles.row}>
        <Spinner />
        <RNText style={[type.body, { color: colors.textMuted }]}>{label}</RNText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  lensColumn: { alignItems: 'center', gap: 14, paddingVertical: 32 },
});
