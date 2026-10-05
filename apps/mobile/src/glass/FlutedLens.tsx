import { memo, useEffect, useRef, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
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
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';
import { CYCLE, DUR, MOTION_DISTANCE, MOTION_LEVEL, SIGNATURE } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import type { GlassRecipes } from '../theme/tokens';
import { Grain } from './Grain';
import { GradientDef, HIDDEN, PASS_THROUGH, useSvgId } from './paint';

// The fluted lens (§9), Pocket QA's signature motif: reeded glass in front of an ultramarine
// sphere. Every rib is a small cylindrical lens, so it shows its slice of the scene mirrored and
// compressed (scaleX −m about the rib centre), sampled k × (ribCentre − S/2) further out; the
// sphere breaks into stepped crescents across neighbouring ribs. The scene is padded by pad × S so
// no sample falls off its edge.
//
// Only allowed as the brand mark, on the recorder card while recording, and in EmptyState; never
// as a texture, never twice on a screen.

const GLINT_WIDTH = 0.46; // of the lens
const GLINT_FROM = -0.6; // translateX, in glint widths
const GLINT_TO = 2.4;
const GLINT_PEAK_AT = 0.3;
// The record core on the board's recorder: 36px in a 96px lens, lit from inside.
const CORE_SIZE = 36 / 96;
const CORE_IDLE: number = MOTION_LEVEL.coreIdle;
/** Board sizes → [radius, ribs] (flute(P, S, R, ribs) calls in the boards); other sizes use the formula. */
const FLUTE_SIZES: Record<number, [number, number]> = { 40: [14, 6], 46: [16, 7], 54: [18, 7], 64: [20, 8], 72: [22, 8], 96: [22, 11], 104: [30, 12], 220: [54, 22] };

export type FlutedLensProps = {
  /** Outer size in dp. Rib widths stay 7–10px (7 ribs at 54, 12 at 104, 22 at 220). */
  size?: number;
  /** Corner radius; default the board's for that size (FLUTE_SIZES), else ≈ 0.28 × size. */
  radius?: number;
  ribs?: number;
  /** S1 refraction shimmer: plays on mount (unless false) and each time this key changes. Never loops. */
  shimmerKey?: number;
  shimmerOnMount?: boolean;
  /** Delay before the shimmer (ms); the glint follows 220ms later. */
  shimmerDelay?: number;
  /**
   * Extra scene travel (px), driven by the caller on the UI thread: the intro's pager carries the
   * lens, and the scene behind the ribs drifts with it, so the glass refracts as it moves. Added
   * to the shimmer and clamped to the scene's padding, so no rib ever samples past its edge.
   */
  drift?: SharedValue<number>;
  /**
   * The recorder lens (S2). true: the record core breathes and the ribs drift; false: the core
   * rests unlit at 0.3 (reached by the light cut, 180ms ease-exit). Omit for the brand mark.
   */
  recording?: boolean;
  /** EmptyState glyph, floating in front of the refracted sphere (half the lens is the spec size). */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

export function FlutedLens({ size = 54, radius, ribs, shimmerKey = 0, shimmerOnMount = true, shimmerDelay = 0, drift, recording, children, style, testID }: FlutedLensProps) {
  const { glass, motion } = useTheme();
  const id = useSvgId('fl');
  const f = glass.flute;
  const S = size;
  const board = FLUTE_SIZES[S];
  const R = radius ?? board?.[0] ?? Math.round(S * 0.28);
  const n = ribs ?? board?.[1] ?? f.ribs(S);
  const w = S / n;
  const pad = Math.round(S * f.pad);
  const W = S + 2 * pad;

  const shift = useSharedValue(0);
  const glintX = useSharedValue(0);
  const glintO = useSharedValue(0);
  const animate = glass.enabled && motion.play.shimmer;
  const mounted = useRef(false);

  useEffect(() => {
    const isMount = !mounted.current;
    mounted.current = true;
    if (!animate || recording || (isMount && !shimmerOnMount)) return;
    const slide = MOTION_DISTANCE.shimmerSlide;
    shift.value = withSequence(withTiming(-slide, { duration: 0 }), withDelay(shimmerDelay, withTiming(0, motion.timing.settle)));
    const glintDelay = shimmerDelay + SIGNATURE.glintDelay;
    const peak = Math.round(DUR.rise * GLINT_PEAK_AT);
    glintX.value = withSequence(withTiming(0, { duration: 0 }), withDelay(glintDelay, withTiming(1, motion.timing.refract)));
    glintO.value = withSequence(
      withTiming(0, { duration: 0 }),
      withDelay(glintDelay, withTiming(1, { ...motion.timing.refract, duration: peak })),
      withTiming(0, { ...motion.timing.refract, duration: DUR.rise - peak }),
    );
    // shimmerKey is the trigger; the other inputs only shape one run.
  }, [shimmerKey]);

  // S2 rib drift: the scene slides 6px and back on a 5600ms ease-breathe loop while recording.
  useEffect(() => {
    if (recording === undefined) return;
    cancelAnimation(shift);
    if (recording && glass.enabled && motion.play.ribDrift) {
      shift.value = withRepeat(withTiming(MOTION_DISTANCE.ribDrift, { ...motion.timing.breatheHalf, duration: CYCLE.drift / 2 }), -1, true);
    } else {
      shift.value = withTiming(0, motion.timing.cut);
    }
  }, [recording, glass.enabled, motion, shift]);

  useEffect(
    () => () => {
      cancelAnimation(shift);
      cancelAnimation(glintX);
      cancelAnimation(glintO);
    },
    [shift, glintX, glintO],
  );

  // With a drift, the scene travels at most until the outer rib's sample (its slice, w / m wide,
  // sampled k × (centre − S/2) further out) reaches the edge of the padded scene: about 20 at the
  // 104 brand lens, so the 16 of S1 is untouched. Without one, the shimmer is exactly as before.
  const travel = Math.max(0, pad - (w / (2 * f.m) - w / 2) - f.k * (S / 2 - w / 2));
  const sceneStyle = useAnimatedStyle(() => {
    const x = drift ? Math.max(-travel, Math.min(travel, shift.value + drift.value)) : shift.value;
    return { transform: [{ translateX: x }] };
  });
  const glintW = (S - 2) * GLINT_WIDTH;
  const glintStyle = useAnimatedStyle(() => ({
    opacity: glintO.value,
    transform: [{ translateX: glintW * (GLINT_FROM + (GLINT_TO - GLINT_FROM) * glintX.value) }],
  }));

  const ribViews = [];
  for (let i = 0; i < n; i++) {
    const L = i * w;
    const c = L + w / 2;
    const off = f.k * (c - S / 2);
    // RN scales about the view's centre, which sits at lens x = S/2, so a scene point at lens x
    // lands at S/2 + t − m(x − S/2). Solving for x = c + off → c gives t: the rib shows the slice
    // sampled `off` further out, mirrored and compressed (the boards' transform-origin construction).
    const t = (c - S / 2) * (1 + f.m) + f.m * off;
    ribViews.push(
      <View key={i} style={[styles.rib, { left: L, width: w + 0.4 }]}>
        <View style={{ position: 'absolute', top: 0, left: -L - pad, width: W, height: S, transform: [{ translateX: t }, { scaleX: -f.m }] }}>
          <Animated.View style={[{ width: W, height: S }, sceneStyle]}>
            <Scene id={`${id}s${i}`} S={S} W={W} pad={pad} scene={f.scene} />
          </Animated.View>
        </View>
      </View>,
    );
  }

  return (
    <View testID={testID} {...HIDDEN} style={[{ width: S, height: S, borderRadius: R, boxShadow: f.shadow }, PASS_THROUGH, style]}>
      <Svg width={S} height={S} style={StyleSheet.absoluteFill}>
        <Defs>
          <GradientDef id={`${id}rim`} spec={f.rim} box={{ x: 0, y: 0, w: S, h: S }} />
        </Defs>
        <Rect x={0} y={0} width={S} height={S} rx={R} ry={R} fill={`url(#${id}rim)`} />
      </Svg>
      <View style={[styles.inner, { borderRadius: R - 1, backgroundColor: f.scene.backing }]}>
        {ribViews}
        <Svg width={S} height={S} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id={`${id}shade`} x1={0} y1={0} x2={1} y2={0}>
              {f.ribShade.stops.map((s, i) => (
                <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
              ))}
            </LinearGradient>
          </Defs>
          {Array.from({ length: n }, (_, i) => (
            <Rect key={i} x={i * w} y={0} width={w + 0.4} height={S} fill={`url(#${id}shade)`} />
          ))}
        </Svg>
        <View style={[StyleSheet.absoluteFill, { borderRadius: R - 1, boxShadow: f.innerShadow }]} />
        <Specular id={`${id}spec`} />
        <Animated.View style={[styles.glint, { width: glintW }, glintStyle]}>
          <Line id={`${id}gl`} width={glintW} height={2} peakAt={0.5} />
        </Animated.View>
        <Grain opacity={glass.grain.lens} />
        {children ? <View style={styles.front}>{children}</View> : null}
      </View>
      {recording !== undefined ? <RecordCore id={`${id}core`} S={S} live={recording} /> : null}
    </View>
  );
}

/** The scene behind the ribs: lavender ground, ultramarine sphere, its specular. Static; memoized per rib. */
const Scene = memo(function Scene({ id, S, W, pad, scene }: { id: string; S: number; W: number; pad: number; scene: GlassRecipes['flute']['scene'] }) {
  const lens = { x: pad, y: 0, w: S, h: S };
  return (
    <Svg width={W} height={S}>
      <Defs>
        <GradientDef id={`${id}g`} spec={scene.ground} box={{ x: 0, y: 0, w: W, h: S }} />
        <GradientDef id={`${id}b`} spec={scene.sphere} box={lens} />
        <GradientDef id={`${id}h`} spec={scene.specular} box={lens} />
      </Defs>
      <Rect x={0} y={0} width={W} height={S} fill={`url(#${id}g)`} />
      <Rect x={0} y={0} width={W} height={S} fill={`url(#${id}b)`} />
      <Rect x={0} y={0} width={W} height={S} fill={`url(#${id}h)`} />
    </Svg>
  );
});

/** The 1px specular along the top edge (left 8% → right 30%). */
function Specular({ id }: { id: string }) {
  return (
    <View style={styles.specular}>
      <Line id={id} width="100%" height={1} peakAt={0.35} />
    </View>
  );
}

function Line({ id, width, height, peakAt }: { id: string; width: number | '100%'; height: number; peakAt: number }) {
  return (
    <Svg width={width} height={height}>
      <Defs>
        <LinearGradient id={id} x1={0} y1={0} x2={1} y2={0}>
          <Stop offset={0} stopColor="#FFFFFF" stopOpacity={0} />
          <Stop offset={peakAt} stopColor="#FFFFFF" stopOpacity={1} />
          <Stop offset={1} stopColor="#FFFFFF" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width="100%" height={height} fill={`url(#${id})`} />
    </Svg>
  );
}

/**
 * The record core (S2): lit from inside, it breathes with the live Uplight (scale 1 → 1.06,
 * opacity 0.8 → 1 on the 1400ms ease-breathe cycle). Stopping is the light cut to its unlit 0.3 in
 * 180ms. Reduced motion: steady at 0.9.
 */
function RecordCore({ id, S, live }: { id: string; S: number; live: boolean }) {
  const { glass, motion } = useTheme();
  const level = useSharedValue(live ? MOTION_LEVEL.glowFrom : CORE_IDLE);
  const scale = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(level);
    cancelAnimation(scale);
    if (!live) {
      scale.value = withTiming(1, motion.timing.cut);
      level.value = withTiming(CORE_IDLE, motion.timing.cut);
      return;
    }
    const steady = glass.enabled ? motion.liveSteady : MOTION_LEVEL.reducedSteady;
    if (steady !== null) {
      scale.value = 1;
      level.value = withTiming(steady, motion.timing.tick);
      return;
    }
    level.value = withSequence(withTiming(MOTION_LEVEL.glowFrom, motion.timing.tick), withRepeat(withTiming(1, motion.timing.breatheHalf), -1, true));
    scale.value = withRepeat(withTiming(MOTION_LEVEL.coreScale, motion.timing.breatheHalf), -1, true);
  }, [live, glass.enabled, motion, level, scale]);
  useEffect(
    () => () => {
      cancelAnimation(level);
      cancelAnimation(scale);
    },
    [level, scale],
  );
  return <CoreView id={id} S={S} level={level} scale={scale} />;
}

function CoreView({ id, S, level, scale }: { id: string; S: number; level: SharedValue<number>; scale: SharedValue<number> }) {
  const { glass } = useTheme();
  const d = S * CORE_SIZE;
  const style = useAnimatedStyle(() => ({ opacity: level.value, transform: [{ scale: scale.value }] }));
  const face = glass.recordCore.face;
  // The board's core fades out by 72% of its radius: #FFF3FB → #F6B6E0 (42%) → transparent violet (72%).
  const stops = [
    { offset: 0, color: face.stops[0]?.color ?? '#FFF3FB', opacity: 1 },
    { offset: 0.42, color: face.stops[1]?.color ?? '#F6B6E0', opacity: 1 },
    { offset: 0.72, color: face.stops[2]?.color ?? '#A983F2', opacity: 0 },
  ];
  return (
    <Animated.View style={[styles.core, { left: (S - d) / 2, top: (S - d) / 2, width: d, height: d }, style]}>
      <Svg width={d} height={d}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            {stops.map((s, i) => (
              <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
            ))}
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={d} height={d} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  inner: { position: 'absolute', top: 1, left: 1, right: 1, bottom: 1, overflow: 'hidden' },
  rib: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden' },
  specular: { position: 'absolute', left: '8%', right: '30%', top: 0, height: 1 },
  glint: { position: 'absolute', top: 0, left: 0, height: 2 },
  front: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', transform: [{ translateX: -2 }, { translateY: -2 }] },
  core: { position: 'absolute' },
});
