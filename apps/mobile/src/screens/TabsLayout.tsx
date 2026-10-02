import { Redirect, Tabs } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import type { Role } from '@pocket-qa/contracts';
import { useSession } from '../auth/SessionProvider';
import { useTheme } from '../theme/ThemeProvider';

export function RoleTabs({ role, tabs }: { role: Role; tabs: { name: string; title: string; icon: LucideIcon }[] }) {
  const { ready, user } = useSession();
  const { colors } = useTheme();
  if (!ready) return null;
  if (!user || user.role !== role) return <Redirect href="/" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, minHeight: 60 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      {tabs.map((t) => (
        <Tabs.Screen
          key={t.name}
          name={t.name}
          options={{ title: t.title, tabBarIcon: ({ color, size }) => <t.icon color={color} size={size} />, tabBarButtonTestID: `tab-${t.name}` }}
        />
      ))}
    </Tabs>
  );
}
