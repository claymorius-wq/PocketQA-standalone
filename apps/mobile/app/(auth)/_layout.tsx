import { Redirect, Stack } from 'expo-router';
import { useSession } from '../../src/auth/SessionProvider';

export default function AuthLayout() {
  const { ready, user } = useSession();
  if (ready && user) return <Redirect href="/" />;
  return <Stack screenOptions={{ headerShown: false }} />;
}
