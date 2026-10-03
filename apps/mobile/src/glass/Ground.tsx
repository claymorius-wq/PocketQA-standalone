import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Defs, G, Rect } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { Grain } from './Grain';
import { KeyLightContext, keyExposure, type KeyLight } from './keyLight';
import { GradientDef, HIDDEN, PASS_THROUGH, useSvgId } from './paint';

const MAX_SCALE_WIDTH = 430;

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

  return (
    <KeyLightContext.Provider value={keyLight}>
      <View testID={testID} onLayout={onLayout} style={[styles.root, { backgroundColor: colors.background }, style]}>
        {glass.enabled && size ? <GroundLight w={size.w} h={size.h} poolStyle={poolStyle} poolTestID={testID ? `${testID}-pool` : undefined} /> : null}
        {children}
      </View>
    </KeyLightContext.Provider>
  );
}

function GroundLight({ w, h, poolStyle, poolTestID }: { w: number; h: number; poolStyle: ReturnType<typeof useAnimatedStyle>; poolTestID?: string }) {
  const { glass } = useTheme();
  const id = useSvgId('ground');
  const g = glass.ground;
  // Positions are px on the 390-wide board. One uniform factor for both axes, capped at a large
  // phone (430), keeps the pool a corner light on wide web windows instead of a stretched band.
  const k = Math.min(w, MAX_SCALE_WIDTH) / g.referenceWidth;
  const pool = { x: g.keyPool.left * k, y: g.keyPool.top * k, w: g.keyPool.width * k, h: g.keyPool.height * k };
  const falloff = { w: g.falloff.width * k, h: g.falloff.height * k };
  const fall = { x: w - falloff.w - g.falloff.right * k, y: h - falloff.h - g.falloff.bottom * k, ...falloff };
  const shaft = { x: g.shaft.left * k, y: g.shaft.top * k, w: g.shaft.width * k, h: g.shaft.height * k };
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

const styles = StyleSheet.create({
  root: { flex: 1, overflow: 'hidden' },
});
