import type { ClientConfig } from '@pocket-qa/contracts';
import { getApps, initializeApp } from 'firebase/app';
import { Platform } from 'react-native';
import {
  browserSessionPersistence,
  connectAuthEmulator,
  initializeAuth,
  createUserWithEmailAndPassword,
  getAuth,
  GoogleAuthProvider,
  onIdTokenChanged,
  sendEmailVerification,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';

/**
 * Firebase client for `authMode: 'firebase'` deployments (ADR 0005 §1). Configured only
 * from the server's public /config (web API key, auth domain, project id), never from
 * bundled secrets. The API accepts the resulting ID tokens; custom tokens from wallet
 * login are exchanged here and never sent to the API.
 */
let auth: Auth | null = null;

export function firebaseAuth(cfg: NonNullable<ClientConfig['firebase']>): Auth {
  if (auth) return auth;
  const app = getApps().find((a) => a.name === 'pocketqa') ?? initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId }, 'pocketqa');
  // Web: tab-scoped persistence (sessionStorage), like local mode: closing the tab signs
  // out and the refresh token isn't kept in long-lived IndexedDB (ADR 0005 §1).
  auth = Platform.OS === 'web' ? initializeAuth(app, { persistence: browserSessionPersistence }) : getAuth(app);
  if (cfg.authEmulatorUrl) connectAuthEmulator(auth, cfg.authEmulatorUrl, { disableWarnings: true });
  return auth;
}

export const firebaseSession = {
  emailSignIn: (a: Auth, email: string, password: string) => signInWithEmailAndPassword(a, email, password),
  /** Creates the Firebase user and sends a verification email; the API requires it verified. */
  async emailSignUp(a: Auth, email: string, password: string) {
    const cred = await createUserWithEmailAndPassword(a, email, password);
    await sendEmailVerification(cred.user);
    return cred;
  },
  googleSignIn: (a: Auth) => signInWithPopup(a, new GoogleAuthProvider()),
  customTokenSignIn: (a: Auth, token: string) => signInWithCustomToken(a, token),
  onIdToken: (a: Auth, cb: (token: string | null) => void) => onIdTokenChanged(a, async (u) => cb(u ? await u.getIdToken() : null)),
  signOut: (a: Auth) => signOut(a),
};
