import type { User } from '@pocket-qa/contracts';
import { ApiError } from '../api/client';

export type ManagedResolution = { kind: 'signed-in'; user: User } | { kind: 'needs-account' };

/**
 * After a Firebase sign-in: ask the API which account this identity maps to. A 404 means
 * no account yet (the UI asks for a role); a missing email verification is surfaced as
 * an error the user can act on. Accounts are only ever created by an explicit request.
 */
export async function resolveManagedSession(identitySession: (body: object) => Promise<{ user: User }>): Promise<ManagedResolution> {
  try {
    return { kind: 'signed-in', user: (await identitySession({})).user };
  } catch (e) {
    if (e instanceof ApiError && e.code === 'NOT_FOUND') return { kind: 'needs-account' };
    if (e instanceof ApiError && e.code === 'EMAIL_UNVERIFIED') {
      throw new ApiError('EMAIL_UNVERIFIED', 'Verify your email address using the link we sent, then sign in again.', e.status);
    }
    throw e;
  }
}
