import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, G, LinearGradient, Mask, Rect, Stop } from 'react-native-svg';
import type { GlassRecipes } from '../theme/tokens';
import { useTheme } from '../theme/ThemeProvider';
import { Grain } from './Grain';
import { KeyLightContext, keyExposure, type KeyLight } from './keyLight';
import { GradientDef, HIDDEN, PASS_THROUGH, useSvgId } from './paint';

const MAX_SCALE_WIDTH = 430;

type PoolStyle = ReturnType<typeof useAnimatedStyle>;
/** What a GroundFade needs to repaint a strip of its Ground: the ground's size and the pool's live exposure. */
const GroundPaintContext = createContext<{ size: { w: number; h: number } | null; poolStyle: PoolStyle } | null>(null);

export type GroundProps = {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Play "light first" on mount (§11.3): exposure 0.6 → 1 over 700ms ease-lens. Off under reduced motion. */
  enter?: boolean;
  testID?: string;
};

/**
 * L0, the screen ground (§4): the 165° base, the key pool from the top-left, the light shaft, the
 * violet falloff in the far corner and grain. It fills its parent and provides the key light that
 * Uplight moments and sheets dim. Light theme: a flat `colors.background`.
 */
export function Ground({ children, style, enter = true, testID }: GroundProps) {
  const { glass, colors, motion } = useTheme();
  const sheet = useSharedValue(0);
  const [moments, setMoments] = useState<readonly SharedValue<number>[]>([]);
  const keyLight = useMemo<KeyLight>(
    () => ({
      sheet,
      register: (u) => {
        setMoments((m) => [...m, u]);
        return () => setMoments((m) => m.filter((x) => x !== u));
      },
    }),
    [sheet],
  );
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s && s.w === width && s.h === height ? s : { w: width, h: height }));
  };

  const playEntrance = enter && glass.enabled && !motion.reduced;
  const entrance = useSharedValue(playEntrance ? glass.exposure.entranceFrom : glass.exposure.rest);
  useEffect(() => {
    if (playEntrance) entrance.value = withTiming(glass.exposure.rest, motion.timing.settle);
    // Mount only: the light arrives once per screen; later exposure changes come from the key light.
  }, []);

  const { rest, uplit, sheet: sheetLevel } = glass.exposure;
  const poolStyle = useAnimatedStyle(() => {
    let up = 0;
    for (const m of moments) up = Math.max(up, m.value);
    return { opacity: entrance.value * keyExposure(rest, uplit, sheetLevel, up, sheet.value) };
  }, [moments, rest, uplit, sheetLevel]);

  const paint = useMemo(() => ({ size, poolStyle }), [size, poolStyle]);

  return (
    <KeyLightContext.Provider value={keyLight}>
      <GroundPaintContext.Provider value={paint}>
        <View testID={testID} onLayout={onLayout} style={[styles.root, { backgroundColor: colors.background }, style]}>
          {glass.enabled && size ? <GroundLight w={size.w} h={size.h} poolStyle={poolStyle} poolTestID={testID ? `${testID}-pool` : undefined} /> : null}
          {children}
        </View>
      </GroundPaintContext.Provider>
    </KeyLightContext.Provider>
  );
}

/** The ground's light boxes in px for a w × h ground (positions are on the 390-wide board). */
function groundBoxes(g: GlassRecipes['ground'], w: number, h: number) {
  // One uniform factor for both axes, capped at a large phone (430), keeps the pool a corner light
  // on wide web windows instead of a stretched band.
  const k = Math.min(w, MAX_SCALE_WIDTH) / g.referenceWidth;
  const pool = { x: g.keyPool.left * k, y: g.keyPool.top * k, w: g.keyPool.width * k, h: g.keyPool.height * k };
  const falloff = { w: g.falloff.width * k, h: g.falloff.height * k };
  const fall = { x: w - falloff.w - g.falloff.right * k, y: h - falloff.h - g.falloff.bottom * k, ...falloff };
  const shaft = { x: g.shaft.left * k, y: g.shaft.top * k, w: g.shaft.width * k, h: g.shaft.height * k };
  return { pool, fall, shaft };
}

function GroundLight({ w, h, poolStyle, poolTestID }: { w: number; h: number; poolStyle: ReturnType<typeof useAnimatedStyle>; poolTestID?: string }) {
  const { glass } = useTheme();
  const id = useSvgId('ground');
  const g = glass.ground;
  const { pool, fall, shaft } = groundBoxes(g, w, h);
  return (
    <View {...HIDDEN} style={[StyleSheet.absoluteFill, PASS_THROUGH]}>
      <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
        <Defs>
          <GradientDef id={`${id}b`} spec={g.base} box={{ x: 0, y: 0, w, h }} />
        </Defs>
        <Rect x={0} y={0} width={w} height={h} fill={`url(#${id}b)`} />
      </Svg>
      <Animated.View testID={poolTestID} style={[StyleSheet.absoluteFill, poolStyle]}>
        <Svg width={w} height={h}>
          <Defs>
            <GradientDef id={`${id}p`} spec={g.keyPool.gradient} box={pool} />
          </Defs>
          <Rect x={pool.x} y={pool.y} width={pool.w} height={pool.h} fill={`url(#${id}p)`} />
        </Svg>
      </Animated.View>
      <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
        <Defs>
          <GradientDef id={`${id}s`} spec={g.shaft.gradient} box={{ x: 0, y: 0, w: shaft.w, h: shaft.h }} />
          <GradientDef id={`${id}f`} spec={g.falloff.gradient} box={fall} />
        </Defs>
        {/* CSS rotates the shaft about its top-left corner (transform-origin 0 0). */}
        <G transform={`translate(${shaft.x} ${shaft.y}) rotate(${g.shaft.rotate})`}>
          <Rect x={0} y={0} width={shaft.w} height={shaft.h} fill={`url(#${id}s)`} />
        </G>
        <Rect x={fall.x} y={fall.y} width={fall.w} height={fall.h} fill={`url(#${id}f)`} />
      </Svg>
      <Grain opacity={glass.grain.ground} />
    </View>
  );
}

/** Steps the grain takes to fade out with a GroundFade (a mask cannot reach an Image on native). */
const GRAIN_STEPS = 4;

/**
 * A strip of the enclosing Ground repainted over the content, opaque from `top` for `solid` px and
 * then fading out by `top + height`, so content scrolling out under a stack header fades into the
 * ground instead of being cut. The same base, pool (at the pool's live exposure), shaft, falloff
 * and grain (the grain tile aligned with the Ground's, so the opaque part is the ground itself),
 * windowed to the strip and masked by a vertical gradient; drawn once (no blur, no animation).
 * Light: the flat background colour fading out. Outside a Ground, or before it has laid out: nothing.
 *
 * `anchor="bottom"` mirrors it for a screen's edge dock (Sign in): the strip is the ground's last
 * `height` px (`top` is not used), opaque for its bottom `solid` px and fading out upward.
 */
export function GroundFade({ top: topEdge = 0, height, solid = 0, anchor = 'top' }: { top?: number; height: number; solid?: number; anchor?: 'top' | 'bottom' }) {
  const paint = useContext(GroundPaintContext);
  const { glass, colors } = useTheme();
  const id = useSvgId('gfade');
  const size = paint?.size;
  if (!paint || !size || height <= 0) return null;
  const { w, h } = size;
  const g = glass.ground;
  const { pool, fall, shaft } = groundBoxes(g, w, h);
  const bottom = anchor === 'bottom';
  const top = bottom ? h - height : topEdge;
  const viewBox = `0 ${top} ${w} ${height}`;
  const hold = Math.min(1, Math.max(0, solid / height));
  // Each Svg is its own document on native, so each carries its own mask.
  const mask = (m: string) => (
    <>
      <LinearGradient id={`${m}g`} gradientUnits="userSpaceOnUse" x1={0} y1={top} x2={0} y2={top + height}>
        <Stop offset={0} stopColor="#FFFFFF" stopOpacity={bottom ? 0 : 1} />
        <Stop offset={bottom ? 1 - hold : hold} stopColor="#FFFFFF" stopOpacity={1} />
        <Stop offset={1} stopColor="#FFFFFF" stopOpacity={bottom ? 1 : 0} />
      </LinearGradient>
      <Mask id={m} maskUnits="userSpaceOnUse" x={0} y={top} width={w} height={height}>
        <Rect x={0} y={top} width={w} height={height} fill={`url(#${m}g)`} />
      </Mask>
    </>
  );
  if (!glass.enabled) {
    return (
      <Svg width={w} height={height} viewBox={viewBox}>
        <Defs>{mask(`${id}m`)}</Defs>
        <Rect x={0} y={top} width={w} height={height} fill={colors.background} mask={`url(#${id}m)`} />
      </Svg>
    );
  }
  return (
    <View style={{ width: w, height }}>
      <Svg width={w} height={height} viewBox={viewBox} style={StyleSheet.absoluteFill}>
        <Defs>
          {mask(`${id}m`)}
          <GradientDef id={`${id}b`} spec={g.base} box={{ x: 0, y: 0, w, h }} />
          <GradientDef id={`${id}s`} spec={g.shaft.gradient} box={{ x: 0, y: 0, w: shaft.w, h: shaft.h }} />
          <GradientDef id={`${id}f`} spec={g.falloff.gradient} box={fall} />
        </Defs>
        <G mask={`url(#${id}m)`}>
          <Rect x={0} y={0} width={w} height={h} fill={`url(#${id}b)`} />
          <G transform={`translate(${shaft.x} ${shaft.y}) rotate(${g.shaft.rotate})`}>
            <Rect x={0} y={0} width={shaft.w} height={shaft.h} fill={`url(#${id}s)`} />
          </G>
          <Rect x={fall.x} y={fall.y} width={fall.w} height={fall.h} fill={`url(#${id}f)`} />
        </G>
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, paint.poolStyle]}>
        <Svg width={w} height={height} viewBox={viewBox}>
          <Defs>
            {mask(`${id}n`)}
            <GradientDef id={`${id}p`} spec={g.keyPool.gradient} box={pool} />
          </Defs>
          <Rect x={pool.x} y={pool.y} width={pool.w} height={pool.h} fill={`url(#${id}p)`} mask={`url(#${id}n)`} />
        </Svg>
      </Animated.View>
      <FadeGrain top={top} height={height} solid={Math.round(hold * height)} opacity={glass.grain.ground} bottom={bottom} />
    </View>
  );
}

/**
 * The Ground's grain over a GroundFade: full over the opaque part, then GRAIN_STEPS bands of falling
 * opacity across the fade (≤ 1.6% steps of a 6.4% grain: invisible). Each band shows the tile at the
 * Ground's own offset, so the grain lines up with the grain it covers. `bottom`: the opaque part is
 * the strip's end and the bands fade upward.
 */
function FadeGrain({ top, height, solid, opacity, bottom = false }: { top: number; height: number; solid: number; opacity: number; bottom?: boolean }) {
  const fade = height - solid;
  const step = fade / GRAIN_STEPS;
  const bands = [{ y: bottom ? fade : 0, h: solid, k: 1 }];
  for (let i = 0; i < GRAIN_STEPS && fade > 0; i++) {
    const y = bottom ? fade - step * (i + 1) : solid + (fade * i) / GRAIN_STEPS;
    bands.push({ y, h: step, k: 1 - (i + 0.5) / GRAIN_STEPS });
  }
  return (
    <>
      {bands
        .filter((b) => b.h > 0)
        .map((b) => (
          <View key={b.y} style={[styles.band, { top: b.y, height: b.h }]}>
            {/* The tile box spans from the Ground's top edge, so the repeat starts where the Ground's does. */}
            <View style={[styles.band, { top: -(top + b.y), height: top + height }]}>
              <Grain opacity={opacity * b.k} />
            </View>
          </View>
        ))}
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
  band: { position: 'absolute', left: 0, right: 0, overflow: 'hidden', pointerEvents: 'none' },
});
