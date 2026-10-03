import { useEffect } from 'react';
import Animated, { cancelAnimation, Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { HIDDEN } from '../glass/paint';
import { CYCLE } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { useScreenFocused } from './screen';

// A leaf module (theme, paint, reanimated and the screen focus hook only), so LensButton
// (ui/button.tsx), LoadingState (ui/index.tsx) and the patterns share the one spinner without an
// import cycle.

/**
 * The busy spinner (CONSISTENCY C4, C7): the 18dp arc the buttons and the loading row use, a 0.28
 * ring with a quarter arc, in `color` (primary by default). One turn per `CYCLE.spin` (800ms,
 * linear); reduced motion slows it to `CYCLE.spinReduced` (1600ms) and never freezes it. The only
 * loop a waiting screen may run (§11.6), and it stops while its screen is unfocused (tab scenes
 * stay mounted), like the live LED. Decorative: the control or region around it carries the busy state.
 */
export function Spinner({ size = 18, color, testID }: { size?: number; color?: string; testID?: string }) {
  const { colors, motion } = useTheme();
  const focused = useScreenFocused();
  const turn = useSharedValue(0);
  const cycle = motion.reduced ? CYCLE.spinReduced : CYCLE.spin;
  useEffect(() => {
    if (!focused) {
      cancelAnimation(turn);
      return;
    }
    turn.value = 0;
    turn.value = withRepeat(withTiming(360, { duration: cycle, easing: Easing.linear, reduceMotion: ReduceMotion.Never }), -1, false);
    return () => cancelAnimation(turn);
  }, [cycle, focused, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  const c = color ?? colors.primary;
  return (
    <Animated.View testID={testID} {...HIDDEN} style={[{ width: size, height: size }, spin]}>
      <Svg width={size} height={size} viewBox="0 0 18 18">
        <Circle cx={9} cy={9} r={7} fill="none" stroke={c} strokeOpacity={0.28} strokeWidth={2.4} />
        <Path d="M9 2a7 7 0 0 1 7 7" fill="none" stroke={c} strokeWidth={2.4} strokeLinecap="round" />
      </Svg>
    </Animated.View>
  );
}
