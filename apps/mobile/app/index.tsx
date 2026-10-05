import { Redirect } from 'expo-router';
import { useSession } from '../src/auth/SessionProvider';
import { useIntroSeen } from '../src/onboarding/intro';
import { LoadingState, Screen } from '../src/ui';

export default function Index() {
  const { ready, user } = useSession();
  // Signed out: a first visit opens the intro (Welcome) once; after that, Sign in.
  const introSeen = useIntroSeen();
  if (!ready || (!user && introSeen === null)) {
    // The start screen (A-States root, CONSISTENCY C7): the one LoadingState with the brand lens,
    // which resolves once (S1) over the spinner row. Never lit.
    return (
      <Screen scroll={false}>
        <LoadingState label="Starting Pocket QA…" brand />
      </Screen>
    );
  }
  if (!user) return <Redirect href={introSeen ? '/sign-in' : '/welcome'} />;
  if (user.role === 'builder') return <Redirect href="/studies" />;
  if (user.role === 'admin') return <Redirect href="/disputes" />;
  return <Redirect href="/discover" />;
}
