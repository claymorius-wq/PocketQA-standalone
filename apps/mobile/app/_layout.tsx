import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Redirect, Stack, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '../src/api/client';
import { SessionProvider, useSession } from '../src/auth/SessionProvider';
import { LoadingState } from '../src/ui';
import { View } from 'react-native';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';

function ThemedStack() {
  const { colors, scheme } = useTheme();
  const { ready, user } = useSession();
  const segments = useSegments();
  // Nothing protected renders (or fetches) until the saved session is restored.
  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center' }}>
        <LoadingState label="Starting Pocket QA…" />
      </View>
    );
  }
  if (!user && segments[0] !== '(auth)') return <Redirect href="/sign-in" />;
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.text,
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: '600' },
          contentStyle: { backgroundColor: colors.background },
          // iOS otherwise labels the back button (and its VoiceOver label) with the previous
          // route's name, e.g. "(tester)".
          headerBackButtonDisplayMode: 'minimal',
          headerBackTitle: 'Back',
        }}
      >
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
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <SessionProvider>
            <ThemedStack />
          </SessionProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
