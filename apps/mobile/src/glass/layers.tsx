import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { type AnimatedStyle } from 'react-native-reanimated';
import Svg, { Defs, Path } from 'react-native-svg';
import type { GlassSurface as GlassRecipe } from '../theme/tokens';
import { Grain } from './Grain';
import { cornerStyle, GradientDef, HIDDEN, joinShadows, PASS_THROUGH, roundRectPath, type Corners } from './paint';

// A glass surface is drawn as stacked, pre-rendered layers so that state changes (press, Uplight,
// caustic) only animate a layer's opacity: gradients and shadow values never animate (§11.4).
//
// The surface's own view keeps CSS's `border: 1px solid transparent`, so content sits exactly where
// the boards put it; layers are absolutely positioned at -1 to cover that border box.

export const COVER: ViewStyle = { position: 'absolute', top: -1, left: -1, right: -1, bottom: -1 };

/**
 * Outset shadows of a recipe. React Native draws CSS shadow lists natively (`boxShadow`); an
 * outset shadow is clipped to outside the border box, so this layer needs no background.
 */
export function ShadowLayer({ shadows, radius, corners, style }: { shadows: string[]; radius: number; corners: Corners; style?: StyleProp<AnimatedStyle<ViewStyle>> }) {
  const boxShadow = joinShadows(shadows);
  if (!boxShadow) return null;
  return <Animated.View {...HIDDEN} style={[COVER, PASS_THROUGH, cornerStyle(radius, corners), { boxShadow }, style]} />;
}

/**
 * The body of a recipe at w×h: fill layers on the padding box, the gradient rim as a 1px stroke on
 * the border box (CSS padding-box / border-box backgrounds; a stroke also keeps translucent fills
 * from showing the rim through), then the inset shadows above the fill, then grain.
 */
export function RecipeBody({
  recipe,
  w,
  h,
  corners,
  idPrefix,
  insetShadows,
  grain = 0,
  style,
  under,
}: {
  recipe: GlassRecipe;
  w: number;
  h: number;
  corners: Corners;
  idPrefix: string;
  insetShadows: string[];
  grain?: number;
  style?: StyleProp<AnimatedStyle<ViewStyle>>;
  /** Painted below the fill: the overlay's blur. */
  under?: ReactNode;
}) {
  const r = recipe.radius;
  const inner = { x: 1, y: 1, w: Math.max(0, w - 2), h: Math.max(0, h - 2) };
  const outer = { x: 0, y: 0, w, h };
  const fillPath = roundRectPath(1, 1, inner.w, inner.h, Math.max(0, r - 1), corners);
  const rimPath = roundRectPath(0.5, 0.5, Math.max(0, w - 1), Math.max(0, h - 1), Math.max(0, r - 0.5), corners);
  const insetShadow = joinShadows(insetShadows);
  return (
    <Animated.View {...HIDDEN} style={[COVER, PASS_THROUGH, cornerStyle(r, corners), styles.clip, style]}>
      {under}
      <Svg width={w} height={h} style={StyleSheet.absoluteFill}>
        <Defs>
          {recipe.fill.map((g, i) => (
            <GradientDef key={`f${i}`} id={`${idPrefix}f${i}`} spec={g} box={inner} />
          ))}
          {recipe.rim.map((g, i) => (
            <GradientDef key={`r${i}`} id={`${idPrefix}r${i}`} spec={g} box={outer} />
          ))}
        </Defs>
        {recipe.fill.map((_, i) => (
          <Path key={`f${i}`} d={fillPath} fill={`url(#${idPrefix}f${i})`} />
        ))}
        {recipe.rim.map((_, i) => (
          <Path key={`r${i}`} d={rimPath} fill="none" stroke={`url(#${idPrefix}r${i})`} strokeWidth={1} />
        ))}
      </Svg>
      {insetShadow ? <View style={[styles.inset, PASS_THROUGH, cornerStyle(Math.max(0, r - 1), corners), { boxShadow: insetShadow }]} /> : null}
      {grain > 0 ? <Grain opacity={grain} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  inset: { position: 'absolute', top: 1, left: 1, right: 1, bottom: 1 },
});
