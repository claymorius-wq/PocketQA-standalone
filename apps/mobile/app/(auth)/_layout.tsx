import { Redirect, Stack } from 'expo-router';
import { useEffect } from 'react';
import { useSession } from '../../src/auth/SessionProvider';
import { stampArrival } from '../../src/motion/entrance';
import { ArrivalContext } from '../../src/ui';
import { LENS_STACK_ANIMATION } from '../../src/ui/StackHeader';

export default function AuthLayout() {
  const { ready, user } = useSession();
  const signedIn = ready && !!user;
  // Signed in (or up): the role's first tab opens with `replace` and finishes U1's Commit tail
  // (§M3), read once by RoleTabs. Stamped from an effect, never during render; the redirect below
  // takes a few renders to reach the tabs, well inside the stamp's TTL.
  useEffect(() => {
    if (signedIn) stampArrival('replace', { handoff: 'u1' });
  }, [signedIn, user]);
  if (signedIn) return <Redirect href="/" />;
  return (
    <Stack
      screenOptions={{ headerShown: false, ...LENS_STACK_ANIMATION }}
      // Sign in is the launch, the only screen with the light dip and the staggered steps (§11.3);
      // Sign up arrives with a push like any stack screen. Returns to either play back.
      screenLayout={({ route, children }) => <ArrivalContext.Provider value={route.name === 'sign-in' ? 'launch' : null}>{children}</ArrivalContext.Provider>}
    />
  );
}
