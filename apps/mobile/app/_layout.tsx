import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { Redirect, SplashScreen, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '../src/api/client';
import { SessionProvider, useSession } from '../src/auth/SessionProvider';
import { FocusRingStyles, LoadingState, Notice, lensStackScreenOptions } from '../src/ui';
import { Platform, StyleSheet, View } from 'react-native';
import { deploymentProblem } from '../src/lib/deployment';
import { PREVIEW_BUILD } from '../src/preview/demoAccounts';
import { Ground } from '../src/glass';
import { LENS_FONTS } from '../src/theme/fonts';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';

// The native splash stays up until the Lens fonts settle (loaded or failed), so the first frame
// never reflows from system fonts. A no-op where there is no splash module (web).
SplashScreen.preventAutoHideAsync().catch(() => {});

function ThemedStack() {
  const { colors, scheme } = useTheme();
  const { ready, user } = useSession();
  const segments = useSegments();
  // Stable options: a new `header` function per render would re-render every mounted header.
  const screenOptions = useMemo(
    () => ({
      // The one Lens header (src/ui/StackHeader.tsx, CONSISTENCY C2): transparent over the screen's
      // ground, glass back tile, divider. No native transition: each screen plays its own arrival
      // (push in from the right, back, tab, replace; src/motion/entrance.ts).
      ...lensStackScreenOptions(colors),
      // iOS otherwise labels the back button (and its VoiceOver label) with the previous
      // route's name, e.g. "(tester)".
      headerBackButtonDisplayMode: 'minimal' as const,
      headerBackTitle: 'Back',
    }),
    [colors],
  );
  // Nothing protected renders (or fetches) until the saved session is restored.
  if (!ready) {
    return (
      // The light arrives on Sign in (the launch, §M3), never on this start screen.
      <Ground enter={false}>
        <View style={styles.starting}>
          <LoadingState label="Starting Pocket QA…" brand />
        </View>
      </Ground>
    );
  }
  if (!user && segments[0] !== '(auth)') return <Redirect href="/sign-in" />;
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(tester)" options={{ headerShown: false }} />
        <Stack.Screen name="(builder)" options={{ headerShown: false }} />
        <Stack.Screen name="(admin)" options={{ headerShown: false }} />
        <Stack.Screen name="study/[id]" options={{ title: 'Study' }} />
        <Stack.Screen name="participation/[id]" options={{ title: 'Your session' }} />
        <Stack.Screen name="builder/new-study" options={{ title: 'New study' }} />
        <Stack.Screen name="builder/study/[id]" options={{ title: 'Study' }} />
        <Stack.Screen name="builder/review/[id]" options={{ title: 'Review' }} />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  starting: { flex: 1, justifyContent: 'center' },
  blocked: { flex: 1, justifyContent: 'center', padding: 24 },
});

// Checked once per bundle: a misbuilt production app shows why, and never talks to a local API.
const DEPLOYMENT_PROBLEM = deploymentProblem({ env: process.env.EXPO_PUBLIC_POCKETQA_ENV, apiUrl: process.env.EXPO_PUBLIC_API_URL, preview: PREVIEW_BUILD, platform: Platform.OS });

export default function RootLayout() {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Don't hammer a server that's down or deny access repeatedly.
            retry: (n, e) => !(e instanceof ApiError && ['NOT_FOUND', 'UNAUTHENTICATED', 'FORBIDDEN_ROLE'].includes(e.code)) && n < 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  const [fontsLoaded, fontError] = useFonts(LENS_FONTS);
  // A failed load still renders: ThemeProvider falls back to system fonts with weights.
  const fontsSettled = fontsLoaded || fontError != null;
  useEffect(() => {
    if (fontsSettled) SplashScreen.hideAsync().catch(() => {});
  }, [fontsSettled]);
  if (!fontsSettled) return null;
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
        <ThemeProvider fonts={fontsLoaded ? 'lens' : 'system'}>
          {/* Web: the one focus ring for every focusable (CONSISTENCY C1). */}
          <FocusRingStyles />
          {DEPLOYMENT_PROBLEM ? (
            <Ground enter={false}>
              <View style={styles.blocked} testID="deployment-problem">
                <Notice tone="danger" title="This build can’t start">{DEPLOYMENT_PROBLEM}</Notice>
              </View>
            </Ground>
          ) : (
            <SessionProvider>
              <ThemedStack />
            </SessionProvider>
          )}
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
