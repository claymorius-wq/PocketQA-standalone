import { useCallback, useEffect } from 'react';
import { ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { DUR, useMotion } from '../theme/motion';

// Press and release (Direction A §11.4, CONSISTENCY C5): 120ms ease-press into the pressed recipe
// (translate 1px down-right, the cast layer 1 → 0.6, the pressed layer in, caustic shrinks to 60%).
// Release runs two curves: the transform comes back over 180ms ease-release with its 1px
// overshoot (the one place ease-release is used), the layer opacities over 180ms ease-lens, so
// no opacity ever overshoots. Nothing scales and gradients never animate: only the translate and
// the opacity of pre-rendered rest/pressed layers move (GlassSurface reads `progress` for the
// layers and `shift` for its sink). Reduced motion: the layers still swap, no translate. No
// haptics: expo-haptics is not a dependency.

/**
 * Two shared press values on the UI thread: `progress` (0 rest → 1 pressed) for the layer
 * crossfade, and `shift` for the 1dp sink (`motionStyle`, GlassSurface `pressShift`).
 */
export function usePressMotion(disabled = false) {
  const motion = useMotion();
  const layers = useSharedValue(0);
  const shift = useSharedValue(0);
  const pressIn = useCallback(() => {
    layers.value = withTiming(1, motion.timing.pressIn);
    shift.value = withTiming(1, motion.timing.pressIn);
  }, [layers, shift, motion]);
  const pressOut = useCallback(() => {
    layers.value = withTiming(0, { duration: DUR.release, easing: motion.ease.lens, reduceMotion: ReduceMotion.Never });
    shift.value = withTiming(0, motion.timing.release);
  }, [layers, shift, motion]);
  // Disabling mid-press never delivers onPressOut, which would leave the control sunk.
  useEffect(() => {
    if (disabled) pressOut();
  }, [disabled, pressOut]);

  const translate = motion.press.translate;
  // The release curve overshoots past 0 on purpose: that is the spec's "1px overshoot back".
  const motionStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shift.value * translate }, { translateY: shift.value * translate }],
  }));
  return { progress: layers, shift, pressIn, pressOut, motionStyle };
}
