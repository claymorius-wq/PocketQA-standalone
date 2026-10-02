import { Redirect } from 'expo-router';
import type { ReactNode } from 'react';
import type { Role } from '@pocket-qa/contracts';
import { useSession } from '../auth/SessionProvider';

/** UI guard for stack routes outside the role tab groups; the API still enforces roles. */
export function RequireRole({ role, children }: { role: Role; children: ReactNode }) {
  const { user } = useSession();
  if (!user) return <Redirect href="/sign-in" />;
  if (user.role !== role) return <Redirect href="/" />;
  return <>{children}</>;
}
