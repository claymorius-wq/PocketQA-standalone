import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';
import { FULL_MOTION, MotionProvider, REDUCED_MOTION, useReduceMotionSetting, type Motion } from './motion';
import { dark, glassDark, glassLight, light, typeScale, type FontState, type GlassRecipes, type Palette, type TypeScale } from './tokens';

export type ThemePreference = 'system' | 'light' | 'dark';
const KEY = 'pocketqa.theme';

type ThemeCtx = {
  colors: Palette;
  scheme: 'light' | 'dark';
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  /** Type scale for the loaded fonts (system fonts with weights if the Lens fonts failed to load). */
  type: TypeScale;
  /** Motion tokens resolved for the OS reduce-motion setting. */
  motion: Motion;
  /** Glass recipes for the scheme; light degrades to flat surfaces (`glass.enabled === false`). */
  glass: GlassRecipes;
};
const Ctx = createContext<ThemeCtx | null>(null);

const TYPE: Record<FontState, TypeScale> = { lens: typeScale('lens'), system: typeScale('system') };

export function ThemeProvider({ children, fonts = 'lens' }: { children: ReactNode; fonts?: FontState }) {
  const system = useColorScheme();
  const reducedMotion = useReduceMotionSetting();
  const [preference, setPref] = useState<ThemePreference>('system');
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setPref(v);
      })
      .catch(() => {});
  }, []);
  const value = useMemo<ThemeCtx>(() => {
    const scheme = preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;
    return {
      colors: scheme === 'dark' ? dark : light,
      scheme,
      preference,
      setPreference: (p) => {
        setPref(p);
        AsyncStorage.setItem(KEY, p).catch(() => {});
      },
      type: TYPE[fonts],
      motion: reducedMotion ? REDUCED_MOTION : FULL_MOTION,
      glass: scheme === 'dark' ? glassDark : glassLight,
    };
  }, [preference, system, fonts, reducedMotion]);
  return (
    <Ctx.Provider value={value}>
      <MotionProvider value={value.motion}>{children}</MotionProvider>
    </Ctx.Provider>
  );
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme outside ThemeProvider');
  return v;
}
