import { useEffect, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { CYCLE, MOTION_DISTANCE, MOTION_LEVEL, UPLIGHT, useMotion } from '../theme/motion';

// S2 record core breathing and the U3 Live grade (Direction A §10.4, §11.5): the only loops in the
// product. One breath value b (0 ↔ 1, 1400ms ease-breathe cycle) drives the core scale 1 → 1.06,
// core and glow 0.8 → 1, the floor 0.72 → 1 and the LED 0.55 → 1; the ribs drift 6dp over 5600ms.
// A level value gates all of it: it rises with the Uplight (560ms ease-uplight) when recording
// starts, and on stop the light is cut (→ 0 in 180ms ease-exit), never faded gently.
// Reduced motion: no loop, no drift; the core and LED hold 0.9 and the floor 0.86 (§11.7).

const CORE_SCALE = MOTION_LEVEL.coreScale - 1;
const GLOW_FROM = MOTION_LEVEL.glowFrom;
const LED_FROM = MOTION_LEVEL.ledFrom;
const FLOOR_FROM = UPLIGHT.live.from;
const FLOOR_SCALE_FROM = UPLIGHT.floorScaleFrom;
/** The record core's body when not recording (unlit glass, as on the motion board). */
export const CORE_IDLE_OPACITY = MOTION_LEVEL.coreIdle;

export type LiveLevels = { scale: number; coreOpacity: number; glow: number; floor: number; floorScale: number; led: number };

/**
 * Every live output for breath `b`, gate `level` (both 0..1). `steady`/`floorSteady` are the
 * reduced-motion holds (null breathes).
 */
export function liveLevels(b: number, level: number, steady: number | null, floorSteady: number | null, coreIdleArg?: number): LiveLevels {
  'worklet';
  // The default lives in the body, not the signature: the worklet transform captures what the
  // body reads, not default-parameter initialisers, so a signature default was undefined on the
  // UI thread ("Property 'CORE_IDLE_OPACITY' doesn't exist", native run 2026-10-04).
  const coreIdle = coreIdleArg ?? CORE_IDLE_OPACITY;
  const lit = steady ?? GLOW_FROM + (1 - GLOW_FROM) * b;
  return {
    scale: steady === null ? 1 + CORE_SCALE * b * level : 1,
    coreOpacity: coreIdle + (lit - coreIdle) * level,
    glow: lit * level,
    floor: (floorSteady ?? FLOOR_FROM + (1 - FLOOR_FROM) * b) * level,
    floorScale: floorSteady === null ? FLOOR_SCALE_FROM + (1 - FLOOR_SCALE_FROM) * level : 1,
    led: (steady ?? LED_FROM + (1 - LED_FROM) * b) * level,
  };
}

export type LiveBreath = {
  breath: SharedValue<number>;
  level: SharedValue<number>;
  drift: SharedValue<number>;
  styles: {
    core: ReturnType<typeof useAnimatedStyle>;
    glow: ReturnType<typeof useAnimatedStyle>;
    /** For the Uplight floor under the recorder card: opacity = u, scaleY from the bottom edge. */
    floor: ReturnType<typeof useAnimatedStyle>;
    led: ReturnType<typeof useAnimatedStyle>;
    /** translateX for the flute's rib scene while recording. */
    drift: ReturnType<typeof useAnimatedStyle>;
  };
};

/**
 * The live loop, shared by everything that breathes together while `active` (recording): pass
 * its `styles` to the core, its glow, the floor, the recorder LED and the flute ribs.
 */
export function useLiveBreath(active: boolean, coreIdle = CORE_IDLE_OPACITY): LiveBreath {
  const motion = useMotion();
  const breath = useSharedValue(0);
  const level = useSharedValue(0);
  const drift = useSharedValue(0);
  const loops = motion.play.breathe;
  useEffect(() => {
    if (active) {
      level.value = withTiming(1, motion.reduced ? motion.timing.tick : motion.timing.rise);
      if (loops) {
        breath.value = 0;
        breath.value = withRepeat(withTiming(1, motion.timing.breatheHalf), -1, true);
        drift.value = 0;
        drift.value = withRepeat(
          withTiming(MOTION_DISTANCE.ribDrift, { duration: CYCLE.drift / 2, easing: motion.ease.breathe, reduceMotion: ReduceMotion.Never }),
          -1,
          true,
        );
      }
    } else {
      // The light cut: the recording really ended.
      level.value = withTiming(0, motion.timing.cut);
      drift.value = withTiming(0, motion.timing.cut);
    }
    return () => {
      cancelAnimation(breath);
      cancelAnimation(drift);
    };
  }, [active, loops, motion, breath, level, drift]);

  const steady = motion.liveSteady;
  const floorSteady = motion.uplightLiveSteady;
  const core = useAnimatedStyle(() => {
    const v = liveLevels(breath.value, level.value, steady, floorSteady, coreIdle);
    return { opacity: v.coreOpacity, transform: [{ scale: v.scale }] };
  });
  const glow = useAnimatedStyle(() => {
    const v = liveLevels(breath.value, level.value, steady, floorSteady, coreIdle);
    return { opacity: v.glow, transform: [{ scale: v.scale }] };
  });
  const floor = useAnimatedStyle(() => {
    const v = liveLevels(breath.value, level.value, steady, floorSteady, coreIdle);
    return { opacity: v.floor, transform: [{ scaleY: v.floorScale }], transformOrigin: 'bottom' };
  });
  const led = useAnimatedStyle(() => ({ opacity: liveLevels(breath.value, level.value, steady, floorSteady, coreIdle).led }));
  const driftStyle = useAnimatedStyle(() => ({ transform: [{ translateX: drift.value }] }));
  return { breath, level, drift, styles: { core, glow, floor, led, drift: driftStyle } };
}

/**
 * The record core: `children` is the core body (the pink-lavender sphere), `glow` its pre-blurred
 * glow, drawn behind it. Both scale together; the glow carries the light, the body never goes
 * below its idle opacity.
 */
export function BreathingCore({ live, size, glow, children, style, testID }: {
  live: LiveBreath;
  size: number;
  glow?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={[{ width: size, height: size }, styles.center, style]} testID={testID}>
      {glow ? <Animated.View style={[styles.fill, live.styles.glow]}>{glow}</Animated.View> : null}
      <Animated.View style={[styles.fill, styles.center, live.styles.core]}>{children}</Animated.View>
    </View>
  );
}

/**
 * The live LED on IN PROGRESS and UPLOADING pills: a 6dp dot breathing 0.55 ↔ 1 on the 1400ms
 * cycle while `active` (pass false off screen so the loop stops). `shadow` is the pill tone's
 * ring and glow (`glass.ledShadow(tone)`). Reduced motion: steady at 0.9.
 */
export function LiveLed({ active = true, color, shadow, size = 6, testID }: { active?: boolean; color: string; shadow?: string; size?: number; testID?: string }) {
  const motion = useMotion();
  const breath = useSharedValue(0);
  const loops = active && motion.play.breathe;
  useEffect(() => {
    if (loops) {
      breath.value = 0;
      breath.value = withRepeat(withTiming(1, motion.timing.breatheHalf), -1, true);
    }
    return () => cancelAnimation(breath);
  }, [loops, motion, breath]);
  const steady = motion.liveSteady;
  const style = useAnimatedStyle(() => ({ opacity: liveLevels(breath.value, 1, steady, null).led }));
  return (
    <Animated.View
      testID={testID}
      importantForAccessibility="no"
      accessibilityElementsHidden
      style={[{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, boxShadow: shadow }, style]}
    />
  );
}

const styles = StyleSheet.create({
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, pointerEvents: 'none' },
  center: { alignItems: 'center', justifyContent: 'center' },
});
