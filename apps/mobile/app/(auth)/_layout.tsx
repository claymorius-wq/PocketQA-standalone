import { Redirect, Stack } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { useSession } from '../../src/auth/SessionProvider';
import { stampArrival, type InitialArrival } from '../../src/motion/entrance';
import { authArrival, cameFromIntro } from '../../src/onboarding/intro';
import { disarmU1, u1Armed, u1PassAt } from '../../src/screens/authParts';
import { useTheme } from '../../src/theme/ThemeProvider';
import { ArrivalContext } from '../../src/ui';
import { PASS_LEAVE_AFTER } from '../../src/ui/patterns';
import { LENS_STACK_ANIMATION } from '../../src/ui/StackHeader';

export default function AuthLayout() {
  const { ready, user } = useSession();
  const { glass, motion } = useTheme();
  const signedIn = ready && !!user;
  // The account the redirect was released for once U1's pass peaked, so a later sign-in holds again.
  const [released, setReleased] = useState<typeof user>(null);
  // A Sign in press that succeeded plays U1's Commit pass on Sign in: the redirect waits for the
  // pass peak (+680 after it starts) and Sign in follows the link there (CONSISTENCY §M3). Timing
  // only: the session is already accepted. Reduced motion and the flat theme play no pass, so they
  // (and Sign up, and a restored session) leave at once.
  const holdU1 = signedIn && released !== user && u1Armed() && glass.enabled && motion.play.uplightCommit;

  // The role's first tab opens with `replace`, read once by RoleTabs: after a held Sign in it also
  // finishes U1's Commit tail (§M3 hand-off `u1`); Sign up gets the plain replace (no Uplight).
  // Stamped from an effect or a timer, never during render; the redirect takes a few renders to
  // reach the tabs, well inside the stamp's TTL.
  useEffect(() => {
    if (!signedIn || released === user) return;
    if (!holdU1) {
      stampArrival('replace');
      disarmU1();
      return;
    }
    const leaveAt = (u1PassAt() ?? Date.now()) + PASS_LEAVE_AFTER;
    const t = setTimeout(() => {
      stampArrival('replace', { handoff: 'u1' });
      disarmU1();
      setReleased(user);
    }, Math.max(0, leaveAt - Date.now()));
    return () => clearTimeout(t);
  }, [signedIn, holdU1, user, released]);

  if (signedIn && !holdU1) return <Redirect href="/" />;
  return (
    <Stack
      screenOptions={{ headerShown: false, ...LENS_STACK_ANIMATION }}
      // getState() during render returns the state being rendered (React Navigation keeps it
      // current for this), so `first` is read from the stack the screen mounts into.
      screenLayout={({ route, navigation, children }) => (
        <AuthArrival name={route.name} first={navigation.getState().routes[0]?.key === route.key}>
          {children}
        </AuthArrival>
      )}
    />
  );
}

/**
 * How each auth screen opens, decided once when it mounts. The launch (the light dip and the
 * staggered steps, §11.3) belongs to the first screen of a visit: the intro on a first visit,
 * Sign in otherwise, and only while it is the first screen of the auth stack. Sign in reached
 * from the intro (which it replaces) or pushed from Sign up arrives with a push, like any screen
 * after the first; Sign up always does. Returns to any of them play back.
 */
function AuthArrival({ name, first, children }: { name: string; first: boolean; children: ReactNode }) {
  const [spec] = useState<InitialArrival | null>(() => authArrival(name, first, cameFromIntro()));
  return <ArrivalContext.Provider value={spec}>{children}</ArrivalContext.Provider>;
}
