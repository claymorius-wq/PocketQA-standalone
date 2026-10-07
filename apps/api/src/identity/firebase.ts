import { applicationDefault, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { serviceAccountCredential } from '../firestore/admin';
import type { Config } from '../config';
import { IdentityError, type IdentityProvider } from './types';

// Token problems a client can cause: these mean "not signed in" (401). Anything else
// (network, credential, quota) is a server problem and propagates as a 500.
const TOKEN_INVALID = new Set([
  'auth/argument-error',
  'auth/id-token-expired',
  'auth/id-token-revoked',
  'auth/invalid-id-token',
  'auth/user-disabled',
  'auth/user-not-found',
]);

/**
 * Firebase Admin adapter (ADR 0005). Credentials come only from the environment
 * (GOOGLE_APPLICATION_CREDENTIALS / workload identity), never from config files or logs.
 * With an explicit demo- emulator config, the Admin SDK talks to the local Auth emulator
 * instead (no credential needed; loadConfig refuses the emulator for real projects).
 */
export function firebaseIdentity(firebase: NonNullable<Config['firebase']>): IdentityProvider {
  if (firebase.authEmulatorHost) process.env.FIREBASE_AUTH_EMULATOR_HOST = firebase.authEmulatorHost;
  const name = `pocketqa-${firebase.projectId}`;
  const app: App =
    getApps().find((a) => a.name === name) ??
    initializeApp(
      firebase.authEmulatorHost
        ? { projectId: firebase.projectId }
        : // Hosted: the server-only service account JSON; local: application default credentials.
          { projectId: firebase.projectId, credential: serviceAccountCredential(process.env, firebase.projectId) ?? applicationDefault() },
      name,
    );
  const auth = getAuth(app);

  return {
    name: 'firebase',
    async verifyIdToken(token) {
      try {
        const d = await auth.verifyIdToken(token, true);
        if (d.firebase.sign_in_provider === undefined) throw new IdentityError('token has no sign-in provider');
        return {
          uid: d.uid,
          email: d.email ?? null,
          emailVerified: d.email_verified === true,
          signInProvider: d.firebase.sign_in_provider,
          authTimeMs: d.auth_time * 1000,
        };
      } catch (e) {
        const code = (e as { code?: string }).code ?? '';
        if (e instanceof IdentityError || TOKEN_INVALID.has(code)) throw new IdentityError(code || 'invalid token');
        throw e;
      }
    },
    createCustomToken: (uid) => auth.createCustomToken(uid),
    revokeSessions: (uid) => auth.revokeRefreshTokens(uid),
    async deleteUser(uid) {
      try {
        await auth.deleteUser(uid);
      } catch (e) {
        if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
      }
    },
  };
}
