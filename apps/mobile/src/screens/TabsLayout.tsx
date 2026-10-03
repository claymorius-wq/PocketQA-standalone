import { BlurTargetView } from 'expo-blur';
import { Redirect, Tabs } from 'expo-router';
import { createRef, useCallback, useMemo, useRef, type RefObject } from 'react';
import { StyleSheet, type View } from 'react-native';
import type { LucideIcon } from 'lucide-react-native';
import type { Role } from '@pocket-qa/contracts';
import { useSession } from '../auth/SessionProvider';
import { TAB_GLYPHS, type GlyphName } from '../icons';
import { tabScreenOptions } from '../motion';
import { useTheme } from '../theme/ThemeProvider';
import { glyphNameFor, LensTabBar } from '../ui';
import type { TabBarItem } from '../ui/TabBar';

export function RoleTabs({ role, tabs }: { role: Role; tabs: { name: string; title: string; icon: LucideIcon }[] }) {
  const { ready, user } = useSession();
  const { colors, motion } = useTheme();
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
  if (!user || user.role !== role) return <Redirect href="/" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        sceneStyle: { backgroundColor: colors.background },
        ...tabScreenOptions(motion),
      }}
      screenLayout={({ route, children }) => (
        <BlurTargetView ref={targetFor(route.key)} style={styles.scene}>
          {children}
        </BlurTargetView>
      )}
      tabBar={(props) => <LensTabBar {...props} items={items} blurTarget={targetFor(props.state.routes[props.state.index]?.key ?? '')} />}
    >
      {tabs.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.title, tabBarButtonTestID: `tab-${t.name}` }} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  scene: { flex: 1 },
});
