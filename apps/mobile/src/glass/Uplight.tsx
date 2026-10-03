import { useEffect, useRef, useState } from 'react';
import { StyleSheet, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import Svg, { Defs, Rect } from 'react-native-svg';
import { MOTION_DISTANCE, MOTION_LEVEL, UPLIGHT } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { useKeyLight } from './keyLight';
import { GradientDef, HIDDEN, PASS_THROUGH, useSvgId } from './paint';

// Uplight (§10): the second light, rising from below at the eight earned moments. It adds light
// and never casts a shadow; one colour family whatever the tone; one floor per screen; while it is
// lit the key light dims to 0.72 (Ground follows the brightest moment registered with its key light).
// Destructive, pending and failing states are never lit: callers pass active=false for them.

/**
 * Commit: 0 → 1 (560 ease-uplight), hold 120, → 0 (700 ease-lens); motes ride it. U1 on success, U2, U4, U7 confirm.
 * Earned: 0 → 1 (560 ease-uplight), → 0.45 (700 ease-lens), then static. U5, U6, U8.
 * Live: 0.72 ↔ 1 on a 1400ms ease-breathe cycle until it stops, then the light cut (180 ease-exit). U3.
 * Pilot: static 0.35 (sign-in) or 0.55 (commit sheet), rising over 560ms after `delay`. U1 at rest, U7 open.
 */
export type UplightGrade = 'commit' | 'earned' | 'live' | 'pilot';

export type UplightOptions = {
  /** Pilot level: UPLIGHT.pilot.signIn (0.35, default) or UPLIGHT.pilot.sheet (0.55). */
  level?: number;
  /** Delay before the rise (ms). A commit sheet's pilot waits UPLIGHT.pilot.delay (260) for the sheet. */
  delay?: number;
  /** Earned / pilot: start at the resting value with no rise (a screen that opens already approved). */
  startAtRest?: boolean;
};

export type Uplight = {
  /** Intensity u, 0..1, on the UI thread: drive the floor, uplit surfaces and the lit numeral with it. */
  u: SharedValue<number>;
  /** Floor scaleY (0.3 → 1 with the rise; transform-origin bottom). */
  scaleY: SharedValue<number>;
  /** Increments once per Commit pass: the motes ride it. */
  pass: number;
  /** false in light theme: nothing is drawn and u stays 0. */
  enabled: boolean;
};

/**
 * Drives one Uplight moment. `active` turns it on (for Commit, each false → true edge plays one
 * pass, which always ends at 0); turning it off is the light cut. Reduced motion (§11.7): resting
 * values appear with a 120ms fade (Earned 0.45, Pilot level, Live 0.86) and Commit shows nothing.
 */
export function useUplight(grade: UplightGrade, active: boolean, options: UplightOptions = {}): Uplight {
  const { glass, motion } = useTheme();
  const keyLight = useKeyLight();
  const enabled = glass.enabled;
  const u = useSharedValue(0);
  const scaleY = useSharedValue(1);
  const [pass, setPass] = useState(0);
  const { level = UPLIGHT.pilot.signIn, delay = 0, startAtRest = false } = options;
  const first = useRef(true);

  // The ground dims for the brightest registered moment; a dark one (u = 0) never counts.
  useEffect(() => keyLight?.register(u), [keyLight, u]);

  useEffect(() => {
    const mount = first.current;
    first.current = false;
    cancelAnimation(u);
    cancelAnimation(scaleY);
    if (!enabled) {
      u.value = 0;
      return;
    }
    if (!active) {
      u.value = withTiming(0, motion.timing.cut);
      return;
    }
    const rest = grade === 'earned' ? UPLIGHT.earned.rest : grade === 'pilot' ? level : grade === 'live' ? UPLIGHT.live.from : 0;
    if (motion.reduced) {
      scaleY.value = 1;
      const shown = grade === 'live' ? UPLIGHT.live.reducedRest : rest;
      u.value = withTiming(shown, motion.timing.tick);
      return;
    }
    // A rise always starts low and compressed unless the light is already up (Pilot → Commit).
    if (u.value < 0.01) scaleY.value = UPLIGHT.floorScaleFrom;
    const rise = withDelay(delay, withTiming(1, motion.timing.rise));
    const grow = withDelay(delay, withTiming(1, motion.timing.rise));
    switch (grade) {
      case 'commit':
        scaleY.value = grow;
        u.value = withSequence(rise, withDelay(UPLIGHT.commit.hold, withTiming(0, motion.timing.settle)));
        setPass((p) => p + 1);
        break;
      case 'earned':
        if (startAtRest && mount) {
          scaleY.value = 1;
          u.value = rest;
          break;
        }
        scaleY.value = grow;
        u.value = withSequence(rise, withTiming(rest, motion.timing.settle));
        break;
      case 'pilot':
        if (startAtRest && mount) {
          scaleY.value = 1;
          u.value = rest;
          break;
        }
        scaleY.value = grow;
        u.value = withDelay(delay, withTiming(rest, motion.timing.rise));
        break;
      case 'live':
        // The floor itself does not scale while live (the board's recorder floor only breathes).
        scaleY.value = 1;
        u.value = withSequence(
          withDelay(delay, withTiming(UPLIGHT.live.from, motion.timing.rise)),
          withRepeat(withTiming(UPLIGHT.live.to, motion.timing.breatheHalf), -1, true),
        );
        break;
    }
    // u and scaleY are stable shared values.
  }, [active, grade, level, delay, enabled, motion, startAtRest, u, scaleY]);

  useEffect(
    () => () => {
      cancelAnimation(u);
      cancelAnimation(scaleY);
    },
    [u, scaleY],
  );

  return { u, scaleY, pass, enabled };
}

export type UplightFloorProps = {
  light: Uplight;
  /** The subject's centre as a fraction of the floor's width (default 0.5). */
  x?: number;
  /** Floor height in dp (the boards use 160–300). Keep it in the bottom 42% of the screen. */
  height?: number;
  /** Dust motes during a Commit pass (§10.3). Default true; they never loop. */
  motes?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * The light from below (§10.3 floor): three ellipses (source, halo, pool) anchored at the bottom of
 * the moment's container at the subject's x. Place it first inside a position-relative container so
 * it sits under the content; its opacity is u and it grows from the bottom edge.
 */
export function UplightFloor({ light, x = 0.5, height = 300, motes = true, style }: UplightFloorProps) {
  const { glass, colors, motion } = useTheme();
  const id = useSvgId('uf');
  const [w, setW] = useState(0);
  const floorStyle = useAnimatedStyle(() => ({ opacity: light.u.value, transform: [{ scaleY: light.scaleY.value }] }));
  if (!light.enabled) return null;
  const onLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    setW((prev) => (prev === width ? prev : width));
  };
  const layers = glass.uplight.floor.layers;
  return (
    <Animated.View {...HIDDEN} onLayout={onLayout} style={[styles.floor, PASS_THROUGH, { height }, floorStyle, style]}>
      {w > 0 ? (
        <Svg width={w} height={height}>
          <Defs>
            {layers.map((g, i) => (
              <GradientDef key={i} id={`${id}${i}`} spec={{ ...g, cx: x }} box={{ x: 0, y: 0, w, h: height }} />
            ))}
          </Defs>
          {layers.map((_, i) => (
            <Rect key={i} x={0} y={0} width={w} height={height} fill={`url(#${id}${i})`} />
          ))}
        </Svg>
      ) : null}
      {motes && motion.play.motes
        ? glass.uplight.motes.map(([mx, my, d], i) => <Mote key={i} index={i} pass={light.pass} x={mx} y={my} d={d} color={colors.upSource} />)
        : null}
    </Animated.View>
  );
}

const MOTE_START = 160; // the motes follow the rise by 160ms on the board
const MOTE_STAGGER = 40;

function Mote({ index, pass, x, y, d, color }: { index: number; pass: number; x: number; y: number; d: number; color: string }) {
  const { motion } = useTheme();
  const opacity = useSharedValue(0);
  const lift = useSharedValue<number>(MOTION_DISTANCE.moteRise);
  useEffect(() => {
    if (pass === 0) return;
    const delay = MOTE_START + index * MOTE_STAGGER;
    const peakAt = Math.round(UPLIGHT.moteDuration * 0.4);
    const ease = motion.ease.lens;
    opacity.value = withSequence(
      withTiming(0, { duration: 0 }),
      withDelay(delay, withTiming(MOTION_LEVEL.motePeak, { duration: peakAt, easing: ease })),
      withTiming(0, { duration: UPLIGHT.moteDuration - peakAt, easing: ease }),
    );
    lift.value = withSequence(
      withTiming(MOTION_DISTANCE.moteRise, { duration: 0 }),
      withDelay(delay, withTiming(-MOTION_DISTANCE.moteRise, { duration: UPLIGHT.moteDuration, easing: ease })),
    );
  }, [pass, index, motion, opacity, lift]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: lift.value }] }));
  return <Animated.View style={[styles.mote, { left: `${x * 100}%`, bottom: `${y * 100}%`, width: d, height: d, borderRadius: d / 2, backgroundColor: color }, style]} />;
}

/**
 * The lit numeral (U5, U6 balances only): `text-shadow: 0 0 18px rgba(141,176,255,0.55·u)` on an
 * Animated.Text. React Native draws one text shadow, so the spec's 1px specular is dropped.
 */
export function useUplightNumeralStyle(light: Uplight) {
  const { glass } = useTheme();
  const lit = glass.uplight.numeral(1);
  // The token gives the shadow at u = 1; scale its alpha by u on the UI thread.
  const [, r = '0', g = '0', b = '0', a = '0'] = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(String(lit.textShadowColor ?? '')) ?? [];
  const rgb = `${r},${g},${b}`;
  const alpha = Number(a);
  const radius = lit.textShadowRadius ?? 0;
  const enabled = light.enabled && radius > 0;
  return useAnimatedStyle((): TextStyle => {
    if (!enabled) return {};
    return {
      textShadowColor: `rgba(${rgb},${alpha * light.u.value})`,
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: radius,
    };
  });
}

const styles = StyleSheet.create({
  floor: { position: 'absolute', left: 0, right: 0, bottom: 0, transformOrigin: '50% 100%' },
  mote: { position: 'absolute' },
});
