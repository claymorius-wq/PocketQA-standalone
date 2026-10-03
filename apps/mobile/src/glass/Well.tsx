import { useMemo, type ReactNode } from 'react';
import type { StyleProp, ViewProps, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { GlassSurface as GlassRecipe } from '../theme/tokens';
import { GlassSurface } from './GlassSurface';

/** `focusError`: an errored input while focused keeps the error fill and rim under the focus glow. */
export type WellState = 'rest' | 'focus' | 'error' | 'focusError';

export type WellProps = Omit<ViewProps, 'style' | 'children'> & {
  state?: WellState;
  /** Default 16 (inputs, reward wells); the segmented track passes 18. */
  radius?: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

/**
 * L-1, a recessed lens window (§4 Well): the floor sits below the glass, the near (top-left) wall
 * holds line-strong and the far wall catches the key light in lit blue. Depth comes from the inset
 * shadow, never a dark rim, so the edge keeps 3:1. Holds reward numerals, inputs, the segment track.
 */
export function Well({ state = 'rest', radius, style, children, ...viewProps }: WellProps) {
  const { glass } = useTheme();
  const recipe: GlassRecipe = useMemo(() => {
    switch (state) {
      case 'focus':
        return { ...glass.well, rim: glass.wellFocus.rim, shadow: glass.wellFocus.shadow ?? glass.well.shadow };
      case 'focusError':
        return { ...glass.well, fill: glass.wellError.fill, rim: glass.wellError.rim, shadow: glass.wellFocus.shadow ?? glass.well.shadow };
      case 'error':
        return { ...glass.well, fill: glass.wellError.fill, rim: glass.wellError.rim };
      default:
        return glass.well;
    }
  }, [glass, state]);
  return (
    <GlassSurface {...viewProps} recipe={recipe} radius={radius} grain={false} style={style}>
      {children}
    </GlassSurface>
  );
}
