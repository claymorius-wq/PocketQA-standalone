import { Redirect } from 'expo-router';
import { useSession } from '../src/auth/SessionProvider';
import { LeaderboardScreen } from '../src/screens/ReputationScreen';

/** Any signed-in user may read the (opt-in, pseudonymous) leaderboard. */
export default function Leaderboard() {
  const { user } = useSession();
  if (!user) return <Redirect href="/sign-in" />;
  return <LeaderboardScreen />;
}
