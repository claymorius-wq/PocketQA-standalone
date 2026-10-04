import { BlurTargetView } from 'expo-blur';
import { Redirect, Tabs } from 'expo-router';
import { createRef, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { StyleSheet, type View } from 'react-native';
import { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import type { LucideIcon } from 'lucide-react-native';
import type { Role } from '@pocket-qa/contracts';
import { useSession } from '../auth/SessionProvider';
import { TAB_GLYPHS, type GlyphName } from '../icons';
import { takeArrival } from '../motion/entrance';
import { STAGGER, useMotion } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { ArrivalContext, glyphNameFor, LensTabBar } from '../ui';
import type { TabBarItem } from '../ui/TabBar';

// The role tabs (CONSISTENCY C3, §M3). The navigator runs no scene animation (`animation: 'none'`):
// a scene cross-fade would fade each scene's own Ground and dip the light. Instead the arriving
// tab's Screen moves only its content (opacity + 6 up, 240ms ease-lens) and the one violet tile
// slides in the persistent bar (LensTabBar); the light and the bar never re-enter.
// After Sign in / Sign up (`replace`), the first tab's content rises over 320ms, its floor finishes
// U1's Commit tail (the hand-off), and the bar fades in once.

export function RoleTabs({ role, tabs }: { role: Role; tabs: { name: string; title: string; icon: LucideIcon }[] }) {
  const { ready, user } = useSession();
  const { colors } = useTheme();
  // Read once on mount: the auth flow stamps `replace` (with the U1 hand-off) just before it redirects here.
  const [arrived] = useState(() => {
    const stamp = takeArrival();
    return stamp?.arrival === 'replace' ? { arrival: 'replace' as const, handoff: stamp.handoff } : null;
  });
  const replaced = arrived !== null;
  const barFade = useTabBarFadeIn(replaced);
  // The scene the navigator opens with (the first one it lays out) is the one that plays `replace`.
  const firstScene = useRef<string | null>(null);
  // Glyphs come from the role's tab map (Coins is Credits for testers, Budget for builders);
  // the Lucide icon each layout passes is the fallback for a tab the map does not know.
  const items = useMemo(() => {
    const byRole: Partial<Record<string, GlyphName>> = TAB_GLYPHS[role as keyof typeof TAB_GLYPHS] ?? {};
    return Object.fromEntries(tabs.map((t): [string, TabBarItem] => [t.name, { glyph: byRole[t.name] ?? glyphNameFor(t.icon), icon: t.icon }]));
  }, [role, tabs]);
  // One blur target per tab scene: Android's blur samples only the BlurTargetView it is given, and
  // the bar must blur the focused scene.
  const targets = useRef(new Map<string, RefObject<View | null>>());
  const targetFor = useCallback((key: string) => {
    let ref = targets.current.get(key);
    if (!ref) {
      ref = createRef<View>();
      targets.current.set(key, ref);
    }
    return ref;
  }, []);
  if (!ready) return null;
  // One target for a signed-out user everywhere (/sign-in), so concurrent guards never disagree.
  if (!user) return <Redirect href="/sign-in" />;
  if (user.role !== role) return <Redirect href="/" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        sceneStyle: { backgroundColor: colors.background },
        animation: 'none',
      }}
      screenLayout={({ route, children }) => {
        firstScene.current ??= route.key;
        return (
          <ArrivalContext.Provider value={route.key === firstScene.current ? arrived : null}>
            <BlurTargetView ref={targetFor(route.key)} style={styles.scene}>
              {children}
            </BlurTargetView>
          </ArrivalContext.Provider>
        );
      }}
      tabBar={(props) => (
        <LensTabBar {...props} items={items} blurTarget={targetFor(props.state.routes[props.state.index]?.key ?? '')} dockStyle={replaced ? barFade : undefined} />
      )}
    >
      {tabs.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.title, tabBarButtonTestID: `tab-${t.name}` }} />
      ))}
    </Tabs>
  );
}

/**
 * `replace` only: the tab bar fades in once, 240ms at +80 (§M3); reduced motion, a 120ms fade.
 * The style goes on the bar's own dock view (LensTabBar `dockStyle`), not on a wrapper, so the
 * bar's hit-testing never depends on a zero-size parent. The blur itself never animates; only the
 * dock's opacity does, once. Verify on the Seeker that the overlay's layers look right mid-fade.
 */
function useTabBarFadeIn(active: boolean) {
  const motion = useMotion();
  const opacity = useSharedValue(active ? 0 : 1);
  useEffect(() => {
    if (!active) return;
    opacity.value = motion.reduced ? withTiming(1, motion.timing.tick) : withDelay(STAGGER.contentStart, withTiming(1, motion.timing.swap));
    // Mount only: the bar arrives once and is persistent chrome afterwards.
  }, []);
  return useAnimatedStyle(() => ({ opacity: opacity.value }));
}

const styles = StyleSheet.create({
  scene: { flex: 1 },
});
