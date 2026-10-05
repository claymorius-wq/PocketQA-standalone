import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, useColorScheme } from 'react-native';
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
  useWebChrome(value.scheme, value.colors.background);
  return (
    <Ctx.Provider value={value}>
      <MotionProvider value={value.motion}>{children}</MotionProvider>
    </Ctx.Provider>
  );
}

/**
 * Web: the page behind the app and the browser's own bars (Safari's status bar and toolbar,
 * Chrome's address bar) follow the app's theme, not just the OS one, so they never show white
 * around the dark ground, or dark around the light theme. `public/index.html` sets the same
 * colours by `prefers-color-scheme` until this runs. Native: nothing.
 */
function useWebChrome(scheme: 'light' | 'dark', background: string) {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const root = document.documentElement;
    root.style.backgroundColor = background;
    root.style.colorScheme = scheme;
    if (document.body) document.body.style.backgroundColor = background;
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
    if (metas.length === 0) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = background;
      document.head.appendChild(meta);
    }
    // The template's two metas are media-scoped; both take the app's colour, so whichever the OS
    // scheme selects still shows the theme the app chose.
    metas.forEach((m) => {
      m.content = background;
    });
  }, [scheme, background]);
}

export function useTheme(): ThemeCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useTheme outside ThemeProvider');
  return v;
}
