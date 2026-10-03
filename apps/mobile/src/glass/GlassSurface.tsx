import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { MOTION_LEVEL } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import type { GlassRecipes, GlassSurface as GlassRecipe } from '../theme/tokens';
import { GlassBlur } from './GlassBlur';
import { RecipeBody, ShadowLayer } from './layers';
import { cornerStyle, DEFAULT_CAUSTIC, flatColor, flatRim, isCastShadow, PASS_THROUGH, splitShadows, uplitAddition, useSvgId, type Corners } from './paint';

export type GlassLevel = 'ground' | 'card' | 'raised' | 'overlay' | 'pressed';

export type GlassSurfaceProps = Omit<ViewProps, 'style' | 'children'> & {
  /** Glass level (§4). Default 'card' (L1). 'overlay' is the blurred L3 (see GlassBlur). */
  level?: GlassLevel;
  /** L1 light distance: 1 nearest the light, 0.8, 0.64… further down a list (cardK). */
  k?: number;
  /** Any recipe from `useTheme().glass` (primary, secondary, notice('success'), well, …); overrides `level`. */
  recipe?: GlassRecipe;
  radius?: number;
  corners?: Corners;
  /** Grain on the body: true uses the level's opacity (cards 0.056, ground 0.064), a number sets it. */
  grain?: boolean | number;
  /**
   * The lens-blue caustic thrown down-right by glass light passes through (primary, active tile).
   * true: always on. A shared value (0..1) sets its opacity: the entrance brings it in last, a
   * press holds it at 0.6. A recipe's own caustic shadow is moved onto this layer either way.
   */
  caustic?: boolean | SharedValue<number>;
  /**
   * 0..1 press progress for the layers (C5): the pressed recipe fades in and the cast layer goes
   * 1 → 0.6. It also sinks the surface 1dp down-right (not under reduced motion) unless
   * `pressShift` drives the sink.
   */
  pressed?: SharedValue<number>;
  /** The sink's own value (usePressMotion().shift): it releases with ease-release's overshoot, the layers do not. */
  pressShift?: SharedValue<number>;
  pressedRecipe?: GlassRecipe;
  /** Uplight intensity u (useUplight().u): adds the uplit layer (bottom rim, inner pool, spill) at opacity u. */
  uplight?: SharedValue<number>;
  /** The uplit version of the recipe; default glass.uplight.card(1) for cards. */
  uplitRecipe?: GlassRecipe;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

/** The cast shadow an uplit surface keeps drops to 70%: the light from below fills it (§10.1 rule 2). */
const UPLIT_CAST = 0.7;
/** The cast layer while pressed (C5: opacity 1 → 0.6; MOTION_LEVEL.pressCausticScale). */
const PRESSED_CAST = MOTION_LEVEL.pressCausticScale;

function levelRecipe(glass: GlassRecipes, level: GlassLevel, k: number): GlassRecipe {
  switch (level) {
    case 'ground':
      return { radius: 0, fill: [glass.ground.base], rim: [], shadow: undefined };
    case 'raised':
      return glass.raised;
    case 'pressed':
      return glass.cardPressed;
    case 'overlay':
      return glass.overlay;
    case 'card':
    default:
      return glass.card(k);
  }
}

/**
 * A Lens glass surface sized by its children. The recipe's gradient fill, its rim (brightest at the
 * top-left, where the key light is), inner highlight and down-right cast shadow are drawn behind the
 * content once the surface is measured. Light theme: a flat token surface with a hairline rim.
 */
export function GlassSurface(props: GlassSurfaceProps) {
  const { level = 'card', recipe: recipeProp, radius, corners = 'all', style, children, k = 1, ...rest } = props;
  const { glass } = useTheme();
  // Stable recipe objects let LensSurface memoise its shadow and uplight splits.
  const base = useMemo(() => recipeProp ?? levelRecipe(glass, level, k), [recipeProp, glass, level, k]);
  const recipe = useMemo(() => (radius === undefined ? base : { ...base, radius }), [base, radius]);
  if (level === 'overlay' && !recipeProp) {
    const { grain: _g, caustic: _c, pressed: _p, pressShift: _ps, pressedRecipe: _pr, uplight: _u, uplitRecipe: _ur, ...viewProps } = rest;
    return (
      <GlassBlur radius={radius} corners={corners} style={style} {...viewProps}>
        {children}
      </GlassBlur>
    );
  }
  return glass.enabled ? <LensSurface {...props} level={level} recipe={recipe} corners={corners} /> : <FlatSurface {...props} level={level} recipe={recipe} corners={corners} />;
}

function FlatSurface({ recipe, corners = 'all', pressed, pressShift: _ps, pressedRecipe, level: _level, style, children, k: _k, grain: _g, caustic: _c, uplight: _u, uplitRecipe: _ur, radius: _rad, ...viewProps }: GlassSurfaceProps & { recipe: GlassRecipe }) {
  const { glass } = useTheme();
  const rim = flatRim(recipe);
  const down = pressedRecipe ?? glass.cardPressed;
  const pressStyle = useAnimatedStyle(() => ({ opacity: pressed ? pressed.value : 0 }));
  return (
    <View
      {...viewProps}
      style={[
        cornerStyle(recipe.radius, corners),
        { backgroundColor: flatColor(recipe) ?? 'transparent' },
        rim ? { borderWidth: StyleSheet.hairlineWidth, borderColor: rim } : null,
        style,
      ]}
    >
      {pressed ? <Animated.View style={[StyleSheet.absoluteFill, PASS_THROUGH, cornerStyle(recipe.radius, corners), { backgroundColor: flatColor(down) }, pressStyle]} /> : null}
      {children}
    </View>
  );
}

/** A shadow's geometry (offsets, blur, spread, inset) without its colour. */
const geometry = (shadow: string) => shadow.replace(/rgba?\([^)]*\)|#[0-9A-Fa-f]{3,8}/, '').replace(/\s+/g, ' ').trim();

function LensSurface({ recipe, corners = 'all', level, grain, caustic, pressed, pressShift, pressedRecipe, uplight, uplitRecipe, style, children, onLayout, k: _k, radius: _rad, ...viewProps }: GlassSurfaceProps & { recipe: GlassRecipe }) {
  const { glass, motion } = useTheme();
  const id = useSvgId('gs');
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s && s.w === width && s.h === height ? s : { w: width, h: height }));
    onLayout?.(e);
  };

  // The pressed layers (a second body with its own SVG and grain, plus its shadows) mount on the
  // first press and then stay, so a surface that is never pressed never pays for them.
  const [armed, setArmed] = useState(false);
  useAnimatedReaction(
    () => (pressed ? pressed.value > 0 : false),
    (down, prev) => {
      if (down && !prev && !armed) scheduleOnRN(setArmed, true);
    },
    [armed, pressed],
  );

  const r = recipe.radius;
  const parts = splitShadows(recipe.shadow);
  const causticShadows = parts.caustic.length ? parts.caustic : caustic ? [DEFAULT_CAUSTIC] : [];
  const levelGrain = level === 'ground' ? glass.grain.ground : level === 'card' ? glass.grain.card : 0;
  const grainOpacity = typeof grain === 'number' ? grain : grain === true ? levelGrain || glass.grain.card : grain === false ? 0 : levelGrain;

  const downBase = pressed && armed ? (pressedRecipe ?? glass.cardPressed) : null;
  const down = useMemo(() => (downBase ? { ...downBase, radius: r } : null), [downBase, r]);
  const downParts = down ? splitShadows(down.shadow) : null;
  const defaultLit = useMemo(() => glass.uplight.card(1), [glass]);
  const litFull = uplight ? (uplitRecipe ?? defaultLit) : null;
  const lit = useMemo(() => (litFull ? uplitAddition({ ...litFull, radius: r }, recipe) : null), [litFull, recipe, r]);
  const litParts = lit ? splitShadows(lit.shadow) : null;
  // Uplit, a cast the lit recipe keeps (same geometry) dims to 70%; a cast it drops (the contact
  // shadow) fades out with u.
  const casts = useMemo(() => {
    if (!litFull) return { kept: parts.outset, dropped: [] as string[] };
    const litGeometry = new Set(splitShadows(litFull.shadow).outset.map(geometry));
    const dropped = parts.outset.filter((s) => isCastShadow(s) && !litGeometry.has(geometry(s)));
    return { kept: parts.outset.filter((s) => !dropped.includes(s)), dropped };
  }, [litFull, parts]);

  const shift = motion.press.translate;
  // The pressed recipe sits translated 1dp down-right, away from the light (§4 Pressed).
  const staticSink = level === 'pressed' ? shift : 0;
  const sink = pressShift ?? pressed;
  const outerStyle = useAnimatedStyle(() => {
    const p = sink ? sink.value : 0;
    const d = staticSink + p * shift;
    return d ? { transform: [{ translateX: d }, { translateY: d }] } : { transform: [] };
  });
  // C5: the cast layer goes 1 → 0.6 while pressed (never to 0); the pressed recipe's own shadows
  // fade in on their layer above it.
  const baseShadowStyle = useAnimatedStyle(() => {
    const cast = 1 - (1 - PRESSED_CAST) * Math.min(1, Math.max(0, pressed ? pressed.value : 0));
    return { opacity: cast * (1 - (1 - UPLIT_CAST) * (uplight ? uplight.value : 0)) };
  });
  const droppedShadowStyle = useAnimatedStyle(() => {
    const cast = 1 - (1 - PRESSED_CAST) * Math.min(1, Math.max(0, pressed ? pressed.value : 0));
    return { opacity: cast * (1 - (uplight ? uplight.value : 0)) };
  });
  const pressedStyle = useAnimatedStyle(() => ({ opacity: pressed ? pressed.value : 0 }));
  const uplitStyle = useAnimatedStyle(() => ({ opacity: uplight ? uplight.value : 0 }));
  const causticStyle = useAnimatedStyle(() => ({
    opacity: typeof caustic === 'object' && caustic !== null ? caustic.value : 1,
  }));

  return (
    <Animated.View
      {...viewProps}
      onLayout={handleLayout}
      style={[styles.border, cornerStyle(r, corners), size ? null : { backgroundColor: flatColor(recipe) }, style, outerStyle]}
    >
      {size ? (
        <>
          <ShadowLayer shadows={causticShadows} radius={r} corners={corners} style={causticStyle} />
          <ShadowLayer shadows={casts.kept} radius={r} corners={corners} style={baseShadowStyle} />
          <ShadowLayer shadows={casts.dropped} radius={r} corners={corners} style={droppedShadowStyle} />
          {down && downParts ? <ShadowLayer shadows={[...downParts.outset, ...downParts.caustic]} radius={r} corners={corners} style={pressedStyle} /> : null}
          {litParts ? <ShadowLayer shadows={litParts.outset} radius={r} corners={corners} style={uplitStyle} /> : null}
          <RecipeBody recipe={recipe} w={size.w} h={size.h} corners={corners} idPrefix={`${id}a`} insetShadows={parts.inset} grain={grainOpacity} />
          {down && downParts ? <RecipeBody recipe={down} w={size.w} h={size.h} corners={corners} idPrefix={`${id}p`} insetShadows={downParts.inset} grain={grainOpacity} style={pressedStyle} /> : null}
          {lit && litParts ? <RecipeBody recipe={lit} w={size.w} h={size.h} corners={corners} idPrefix={`${id}u`} insetShadows={litParts.inset} style={uplitStyle} /> : null}
        </>
      ) : null}
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  border: { borderWidth: 1, borderColor: 'transparent' },
});

