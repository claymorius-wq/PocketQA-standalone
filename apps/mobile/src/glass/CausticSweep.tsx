import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { DUR, SIGNATURE } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { cssLinearVector } from '../theme/gradient';
import { cornerStyle, DEFAULT_CAUSTIC, HIDDEN, PASS_THROUGH, useSvgId, type Corners } from './paint';

// S4 (§11.5): a 105° white band, 34% of the button wide, crosses it from −140% to 330% of its own
// width in 560ms ease-refract while its opacity goes 0 → 1 (by 18%) → 1 (82%) → 0, clipped to the
// button. Plays when a primary becomes enabled and when it fires; never on hover, never on a loop,
// never twice in a row (the 1200ms guard).
// The down-right caustic brightens with it: a second caustic shadow layer at half the band's opacity.

const BAND_PEAK = 0.8; // band centre alpha on the boards (0.75 on the Submit dock)
const FADE = 0.18; // opacity keyframes at 18% and 82%
const CAUSTIC_BOOST = 0.5;

export type CausticSweepProps = {
  /** Each change to a positive value plays one sweep; a change within SIGNATURE.sweepGuard (1200ms) of the last sweep is ignored (never twice in a row). */
  playKey: number;
  /** The button's radius (default 18) so the band is clipped to it. */
  radius?: number;
  corners?: Corners;
};

/** Place as the last child of the primary button's surface (absolute fill, never takes touches). */
export function CausticSweep({ playKey, radius = 18, corners = 'all' }: CausticSweepProps) {
  const { glass, motion } = useTheme();
  const id = useSvgId('cs');
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const progress = useSharedValue(0);
  const opacity = useSharedValue(0);
  const busyUntil = useRef(0);
  const live = glass.enabled && motion.play.causticSweep;

  useEffect(() => {
    if (!live || playKey <= 0) return;
    const now = Date.now();
    if (now < busyUntil.current) return;
    busyUntil.current = now + SIGNATURE.sweepGuard;
    const sweep = motion.timing.refract;
    const edge = { ...sweep, duration: Math.round(DUR.rise * FADE) };
    progress.value = withSequence(withTiming(0, { duration: 0 }), withTiming(1, sweep));
    opacity.value = withSequence(
      withTiming(0, { duration: 0 }),
      withTiming(1, edge),
      withTiming(1, { duration: DUR.rise - 2 * edge.duration }),
      withTiming(0, edge),
    );
    // playKey is the trigger; the other values only shape the sweep.
  }, [playKey]);

  const bandW = (size?.w ?? 0) * SIGNATURE.sweepBandWidth;
  const bandStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateX: bandW * (SIGNATURE.sweepFrom + (SIGNATURE.sweepTo - SIGNATURE.sweepFrom) * progress.value) }],
  }));

  const boostStyle = useAnimatedStyle(() => ({ opacity: opacity.value * CAUSTIC_BOOST }));

  if (!live) return null;
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s && s.w === width && s.h === height ? s : { w: width, h: height }));
  };
  const v = size ? cssLinearVector(SIGNATURE.sweepAngle, bandW, size.h) : null;
  return (
    <>
      <Animated.View {...HIDDEN} style={[StyleSheet.absoluteFill, PASS_THROUGH, cornerStyle(radius, corners), styles.boost, boostStyle]} />
      <View {...HIDDEN} onLayout={onLayout} style={[StyleSheet.absoluteFill, PASS_THROUGH, cornerStyle(radius, corners), styles.clip]}>
        {size && v ? (
          <Animated.View style={[styles.band, { width: bandW }, bandStyle]}>
            <Svg width={bandW} height={size.h}>
              <Defs>
                <LinearGradient id={id} gradientUnits="userSpaceOnUse" x1={v.x1} y1={v.y1} x2={v.x2} y2={v.y2}>
                  <Stop offset={0} stopColor="#FFFFFF" stopOpacity={0} />
                  <Stop offset={0.5} stopColor="#FFFFFF" stopOpacity={BAND_PEAK} />
                  <Stop offset={1} stopColor="#FFFFFF" stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Rect x={0} y={0} width={bandW} height={size.h} fill={`url(#${id})`} />
            </Svg>
          </Animated.View>
        ) : null}
      </View>
    </>
  );
}

/** A sweep key that advances when `on` turns true (a primary becoming enabled), never on mount. */
export function useSweepOnEnable(on: boolean): number {
  const [key, setKey] = useState(0);
  const prev = useRef(on);
  useEffect(() => {
    if (on && !prev.current) setKey((k) => k + 1);
    prev.current = on;
  }, [on]);
  return key;
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  // An outset shadow paints only outside the box, so this layer never covers the glass.
  boost: { boxShadow: DEFAULT_CAUSTIC },
  band: { position: 'absolute', top: 0, bottom: 0, left: 0 },
});
