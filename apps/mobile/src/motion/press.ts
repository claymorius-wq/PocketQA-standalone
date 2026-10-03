import { useCallback, useEffect } from 'react';
import { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useMotion } from '../theme/motion';

// Press and release (Direction A §11.4): 120ms ease-press into the pressed recipe (translate 1px
// down-right, inner shadow in, caustic shrinks to 60%), 180ms ease-release back with the curve's
// overshoot. Nothing scales and gradients never animate: only the translate and the opacity of
// pre-rendered rest/pressed layers move (GlassSurface reads `progress`). Reduced motion: the
// layers still swap, no translate. No haptics: expo-haptics is not a dependency.

/** One shared press value `progress` (0 rest → 1 pressed) and the content translate, on the UI thread. */
export function usePressMotion(disabled = false) {
  const motion = useMotion();
  const p = useSharedValue(0);
  const pressIn = useCallback(() => {
    p.value = withTiming(1, motion.timing.pressIn);
  }, [p, motion]);
  const pressOut = useCallback(() => {
    p.value = withTiming(0, motion.timing.release);
  }, [p, motion]);
  // Disabling mid-press never delivers onPressOut, which would leave the control sunk.
  useEffect(() => {
    if (disabled) p.value = withTiming(0, motion.timing.release);
  }, [disabled, p, motion]);

  const translate = motion.press.translate;
  // The release curve overshoots past 0 on purpose: that is the spec's "1px overshoot back".
  const motionStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: p.value * translate }, { translateY: p.value * translate }],
  }));
  return { progress: p, pressIn, pressOut, motionStyle };
}
