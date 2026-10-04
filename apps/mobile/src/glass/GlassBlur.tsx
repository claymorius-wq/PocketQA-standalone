import { BlurView } from 'expo-blur';
import { createContext, useContext, useState, type ReactNode, type RefObject } from 'react';
import { Platform, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { RecipeBody, ShadowLayer } from './layers';
import { cornerStyle, flatColor, flatRim, opaqueOver, splitShadows, useSvgId, type Corners } from './paint';

// L3 overlay (§4): the only real blur, on the tab bar or bottom dock and on sheets. Blur never
// animates. Android blurs only with the Dimezis method on API 31+ and a BlurTargetView holding
// the content behind (the caller passes it as `blurTarget`, e.g. TabsLayout's per-scene target);
// everywhere blur is unavailable the overlay becomes solid (its translucent fill composited over
// the ground), never a see-through panel over busy content.

const WEB_BACKDROP = 'blur(24px)'; // the spec's CSS value; expo-blur's web view would add saturate(180%)

/**
 * The BlurTargetView holding the content behind an overlay, for every GlassBlur below it that is
 * given no `blurTarget` of its own. Screen provides it to its `dock` (the dock floats outside the
 * target it blurs; a GlassBlur inside its own target would blur itself).
 */
export const BlurTargetContext = createContext<RefObject<View | null> | null>(null);

/** Whether a real backdrop blur can be drawn here. */
export function blurAvailable(hasTarget: boolean): boolean {
  if (Platform.OS === 'ios') return true;
  if (Platform.OS === 'android') return hasTarget && typeof Platform.Version === 'number' && Platform.Version >= 31;
  if (Platform.OS === 'web') {
    const css = (globalThis as { CSS?: { supports?: (property: string, value: string) => boolean } }).CSS;
    return !!css?.supports && (css.supports('backdrop-filter', 'blur(1px)') || css.supports('-webkit-backdrop-filter', 'blur(1px)'));
  }
  return false;
}

export type GlassBlurProps = Omit<ViewProps, 'style'> & {
  /** Default: the overlay radius (26). Sheets pass 28 with corners="top". */
  radius?: number;
  corners?: Corners;
  /** Android blur target: the BlurTargetView holding the content behind the overlay (default: BlurTargetContext). */
  blurTarget?: RefObject<View | null>;
  /** false forces the solid fallback (e.g. a sheet in a Modal, whose window cannot see the target). */
  blur?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

/** The L3 overlay surface: backdrop blur + translucent gradient fill + masked rim + shadows. */
export function GlassBlur({ radius, corners = 'all', blurTarget, blur = true, style, children, onLayout, ...viewProps }: GlassBlurProps) {
  const { glass, colors } = useTheme();
  const contextTarget = useContext(BlurTargetContext);
  const id = useSvgId('gb');
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const handleLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s && s.w === width && s.h === height ? s : { w: width, h: height }));
    onLayout?.(e);
  };
  const recipe = { ...glass.overlay, radius: radius ?? glass.overlay.radius };

  if (!glass.enabled) {
    const rim = flatRim(recipe);
    return (
      <View {...viewProps} onLayout={onLayout} style={[cornerStyle(recipe.radius, corners), { backgroundColor: flatColor(recipe) }, rim ? { borderWidth: StyleSheet.hairlineWidth, borderColor: rim } : null, style]}>
        {children}
      </View>
    );
  }

  const target = blurTarget ?? contextTarget ?? undefined;
  const live = blur && blurAvailable(!!target);
  const fill = live ? recipe.fill : recipe.fill.map((g) => opaqueOver(g, colors.background));
  const body = { ...recipe, fill };
  const parts = splitShadows(recipe.shadow);
  const r = recipe.radius;
  const backdrop = !live ? null : Platform.OS === 'web' ? (
    <View style={[StyleSheet.absoluteFill, cornerStyle(r, corners), { backdropFilter: WEB_BACKDROP, WebkitBackdropFilter: WEB_BACKDROP } as unknown as ViewStyle]} />
  ) : (
    <BlurView
      intensity={glass.overlay.blurIntensity}
      tint={glass.overlay.blurTint}
      blurMethod={glass.overlay.blurMethod}
      blurTarget={Platform.OS === 'android' ? target : undefined}
      style={StyleSheet.absoluteFill}
    />
  );

  return (
    <View {...viewProps} onLayout={handleLayout} style={[styles.border, cornerStyle(r, corners), size ? null : { backgroundColor: flatColor({ ...recipe, fill: recipe.fill.map((g) => opaqueOver(g, colors.background)) }) }, style]}>
      {size ? (
        <>
          <ShadowLayer shadows={[...parts.outset, ...parts.caustic]} radius={r} corners={corners} />
          <RecipeBody recipe={body} w={size.w} h={size.h} corners={corners} idPrefix={id} insetShadows={parts.inset} under={backdrop} />
        </>
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  border: { borderWidth: 1, borderColor: 'transparent' },
});
