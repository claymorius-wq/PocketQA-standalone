import { useEffect, useRef } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { DUR } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import type { Tone } from '../theme/tokens';
import { GlassGlyph } from './GlassGlyph';
import { TileSurface, TILE_SIZES, type TileSize } from './GlassTile';
import type { GlyphVariant } from './material';

// S6, "balance weighs" (A-Disputes, Direction A §11.5): the Disputes glyph as its source parts
// (DISPUTES_PARTS: dPost, dBeam, dPanL, dPanR). The beam turns about its hub (16, 8.3) and each
// pan moves with its hanger without turning, so it hangs plumb; 320ms ease-lens, never an
// overshoot (judicial, never celebratory). Reduced motion: the final pose at once. Never lit.
//
// RN adaptation (the spec's `useAnimatedProps` on three SVG groups): each moving part is its own
// GlassGlyph layer, turned or moved by a view transform on the UI thread, so only transforms animate.

/** The beam's angle per pose (degrees, clockwise from the drawn glyph). */
export const BALANCE_POSE = { uphold: 0, level: 6.968, overturn: 13.937 } as const;
export type BalancePose = keyof typeof BALANCE_POSE;

const GRID = 32;
const PIVOT = { x: 16, y: 8.3 };
/** Each pan hangs from the beam end it is drawn at, relative to the hub. */
const HANG_L = { x: 7 - PIVOT.x, y: 11.6 - PIVOT.y };
const HANG_R = { x: 25 - PIVOT.x, y: 9.4 - PIVOT.y };

/** How far a pan's hanger moves (grid units) when the beam turns `deg` clockwise about the hub. */
export function panShift(hang: { x: number; y: number }, deg: number): { x: number; y: number } {
  'worklet';
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: hang.x * c - hang.y * s - hang.x, y: hang.x * s + hang.y * c - hang.y };
}

export type BalanceGlyphProps = {
  pose: BalancePose;
  /** The pose it starts from on mount (the Resolve sheet starts level). Default: `pose`. */
  from?: BalancePose;
  /** Before the first move (ms): +380 in the Resolve sheet once it has landed, +420 on a verdict tile. Later pose changes move at once. */
  delay?: number;
  size?: number;
  variant?: GlyphVariant;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/** The weighing balance glyph. Decorative: the control or text beside it says the outcome. */
export function BalanceGlyph({ pose, from, delay = 0, size = 24, variant = 'face', style, testID }: BalanceGlyphProps) {
  const { motion } = useTheme();
  const angle = useSharedValue<number>(BALANCE_POSE[from ?? pose]);
  const first = useRef(true);
  useEffect(() => {
    const to = BALANCE_POSE[pose];
    const wait = first.current ? delay : 0;
    first.current = false;
    angle.value = motion.reduced ? to : withDelay(wait, withTiming(to, { duration: DUR.enter, easing: motion.ease.lens, reduceMotion: ReduceMotion.Never }));
    // `delay` applies to the first move only.
  }, [pose, motion, angle]);
  const k = size / GRID;
  const beam = useAnimatedStyle(() => ({ transform: [{ rotate: `${angle.value}deg` }] }));
  const left = useAnimatedStyle(() => {
    const d = panShift(HANG_L, angle.value);
    return { transform: [{ translateX: d.x * k }, { translateY: d.y * k }] };
  });
  const right = useAnimatedStyle(() => {
    const d = panShift(HANG_R, angle.value);
    return { transform: [{ translateX: d.x * k }, { translateY: d.y * k }] };
  });
  const box = { width: size, height: size };
  return (
    <View testID={testID} accessible={false} aria-hidden importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={[box, styles.none, style]}>
      <View style={[styles.layer, box]}>
        <GlassGlyph name="dPost" size={size} variant={variant} />
      </View>
      <Animated.View style={[styles.layer, box, left]}>
        <GlassGlyph name="dPanL" size={size} variant={variant} />
      </Animated.View>
      <Animated.View style={[styles.layer, box, right]}>
        <GlassGlyph name="dPanR" size={size} variant={variant} />
      </Animated.View>
      <Animated.View style={[styles.layer, box, styles.hub, beam]}>
        <GlassGlyph name="dBeam" size={size} variant={variant} />
      </Animated.View>
    </View>
  );
}

/**
 * The glyph tile holding the weighing balance (the Resolve sheet's header tile, a resolved
 * dispute's verdict tile). The rim tint carries the outcome, never the glyph.
 */
export function BalanceTile({ size = 'hero', tint, testID, ...glyph }: Omit<BalanceGlyphProps, 'size' | 'style'> & { size?: Exclude<TileSize, 'tab'>; tint?: Tone }) {
  const { glass } = useTheme();
  const dims = TILE_SIZES[size];
  return (
    <TileSurface testID={testID} width={dims.width} height={dims.height} surface={glass.glyphTile({ tint, radius: dims.radius })} ring={glass.stackRing}>
      <BalanceGlyph {...glyph} size={dims.glyph} />
    </TileSurface>
  );
}

const styles = StyleSheet.create({
  none: { pointerEvents: 'none' },
  layer: { position: 'absolute', left: 0, top: 0 },
  hub: { transformOrigin: `${(PIVOT.x / GRID) * 100}% ${(PIVOT.y / GRID) * 100}%` },
});
