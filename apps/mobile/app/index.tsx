import { Redirect } from 'expo-router';
import { useSession } from '../src/auth/SessionProvider';
import { LoadingState, Screen } from '../src/ui';

export default function Index() {
  const { ready, user } = useSession();
  if (!ready) {
    return (
      <Screen scroll={false}>
        <LoadingState label="Starting Pocket QA…" />
      </Screen>
    );
  }
  if (!user) return <Redirect href="/sign-in" />;
  if (user.role === 'builder') return <Redirect href="/studies" />;
  if (user.role === 'admin') return <Redirect href="/disputes" />;
  return <Redirect href="/discover" />;
}
