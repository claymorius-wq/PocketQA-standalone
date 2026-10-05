import { Platform, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { useTheme } from '../../theme/ThemeProvider';
import { TOUCH } from '../../theme/tokens';
import { FocusPressable } from '../focus';

// Page dots under a pager (the intro): one dot per page, the page in view drawn as a longer pill
// in `primary`. The pill follows the pager's scroll position on the UI thread, so it stretches
// from dot to dot under the finger. Only transform and opacity move (§11.1): two round caps slide
// apart and the bar between them scales, all inside one layer whose opacity is how close its page
// is. That layer composites offscreen (Android applies a view's opacity to each child otherwise;
// iOS and the web group it already), so the parts never double their alpha where they overlap.
//
// Each dot is a 48dp button that opens its page (TOUCH, the repo minimum). The page in view is the
// current one: `aria-current` on the web, the selected state on native. Not on the boards yet: a
// proposal for design sign-off (docs/progress.md).

const DOT = 8;
const PILL = 24;
/** How far each cap travels out from the dot's centre when its page is in view. */
const SPREAD = (PILL - DOT) / 2;

export type PageDotsProps = {
  count: number;
  /** The page in view (settled): its dot is the current one for assistive tech. */
  current: number;
  /** The pager's scroll position in pages (0 … count − 1), on the UI thread. */
  position: SharedValue<number>;
  onSelect: (index: number) => void;
  testID?: string;
  /** Each dot's testID is `${dotTestID}-${index}`. */
  dotTestID?: string;
};

export function PageDots({ count, current, position, onSelect, testID, dotTestID }: PageDotsProps) {
  return (
    <View style={styles.row} testID={testID}>
      {Array.from({ length: count }, (_, i) => (
        <Dot key={i} index={i} count={count} current={i === current} position={position} onPress={() => onSelect(i)} testID={dotTestID ? `${dotTestID}-${i}` : undefined} />
      ))}
    </View>
  );
}

function Dot({ index, count, current, position, onPress, testID }: { index: number; count: number; current: boolean; position: SharedValue<number>; onPress: () => void; testID?: string }) {
  const { colors } = useTheme();
  // a: 1 with this page in view, 0 a page or more away.
  const pill = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - Math.abs(position.value - index)) }));
  const left = useAnimatedStyle(() => ({ transform: [{ translateX: -SPREAD * Math.max(0, 1 - Math.abs(position.value - index)) }] }));
  const right = useAnimatedStyle(() => ({ transform: [{ translateX: SPREAD * Math.max(0, 1 - Math.abs(position.value - index)) }] }));
  const bar = useAnimatedStyle(() => ({ transform: [{ scaleX: Math.max(0, 1 - Math.abs(position.value - index)) }] }));
  // react-native-web maps aria-current (RN has no such prop); native reads the selected state.
  const web = Platform.OS === 'web' ? ({ 'aria-current': current ? 'step' : undefined } as object) : null;
  return (
    <FocusPressable
      ringRadius={TOUCH / 2}
      style={styles.hit}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Go to page ${index + 1} of ${count}`}
      accessibilityState={{ selected: current }}
      {...web}
      testID={testID}
    >
      <View style={styles.slot}>
        <View style={[styles.dot, { backgroundColor: colors.borderStrong }]} />
        <Animated.View needsOffscreenAlphaCompositing style={[StyleSheet.absoluteFill, pill]} testID={testID ? `${testID}-pill` : undefined}>
          <Animated.View style={[styles.dot, styles.cap, { backgroundColor: colors.primary }, left]} />
          <Animated.View style={[styles.bar, { backgroundColor: colors.primary }, bar]} />
          <Animated.View style={[styles.dot, styles.cap, { backgroundColor: colors.primary }, right]} />
        </Animated.View>
      </View>
    </FocusPressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  hit: { width: TOUCH, height: TOUCH, alignItems: 'center', justifyContent: 'center' },
  // The pill's full extent; the resting dot sits in its middle.
  slot: { width: PILL, height: DOT, alignItems: 'center', pointerEvents: 'none' },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
  cap: { position: 'absolute', top: 0, left: SPREAD },
  bar: { position: 'absolute', top: 0, left: DOT / 2, width: PILL - DOT, height: DOT },
});
