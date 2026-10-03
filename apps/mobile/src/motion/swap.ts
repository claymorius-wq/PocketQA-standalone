import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { DUR, useMotion } from '../theme/motion';

// Small state swaps (Direction A §11.4, §13): the tab tile slide and the 120ms cross-fades of
// lit/muted glyphs, tab label colour layers and status pills. Swaps keep their 120ms fade under
// reduced motion (meaning survives); only the tile's travel is dropped.

/**
 * Cross-fade between two pre-rendered layers (lit/muted glyph, old/new pill): `onStyle` fades in
 * as `on` turns true, `offStyle` fades out, over dur-tick. No animation on mount.
 */
export function useCrossfade(on: boolean) {
  const motion = useMotion();
  const v = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    v.value = withTiming(on ? 1 : 0, motion.timing.tick);
  }, [on, v, motion]);
  const onStyle = useAnimatedStyle(() => ({ opacity: v.value }));
  const offStyle = useAnimatedStyle(() => ({ opacity: 1 - v.value }));
  return { onStyle, offStyle };
}

/**
 * The tab bar's violet tile: translateX to `index × step` on spring-tab (web: dur-swap 240ms
 * ease-release per §11.1–11.2; the motion board's demo uses 320). Reduced motion: it jumps. A change of `step`
 * (the bar was re-measured) also jumps, so rotation or resizing never animates.
 */
export function useTabTile(index: number, step: number) {
  const motion = useMotion();
  const x = useSharedValue(index * step);
  const lastStep = useRef(step);
  useEffect(() => {
    const target = index * step;
    const resized = lastStep.current !== step;
    lastStep.current = step;
    if (resized || !motion.spring.tab) x.value = target;
    else if (Platform.OS === 'web') x.value = withTiming(target, { ...motion.timing.release, duration: DUR.swap });
    else x.value = withSpring(target, motion.spring.tab);
  }, [index, step, x, motion]);
  return useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));
}
