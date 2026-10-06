import type { ClientConfig } from '@pocket-qa/contracts';
import { getApps, initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  initializeAuth,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onIdTokenChanged,
  sendEmailVerification,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithPopup,
  signOut,
  type Auth,
} from 'firebase/auth';
import { firebasePersistence } from './firebasePersistence';
import { popupRedirectResolver } from './firebaseResolver';

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
  // Web: tab-scoped sessionStorage. Native: the OS keystore, so sessions survive restarts. No
  // popup resolver here: given at init, Firebase preloads Google's gapi for every visitor (blocked
  // by a Google-off site's CSP); googleSignIn passes it to signInWithPopup, on the click.
  auth = initializeAuth(app, { persistence: firebasePersistence() });
  if (cfg.authEmulatorUrl) connectAuthEmulator(auth, cfg.authEmulatorUrl, { disableWarnings: true });
  return auth;
}

export const firebaseSession = {
  emailSignIn: (a: Auth, email: string, password: string) => signInWithEmailAndPassword(a, email, password),
  /**
   * Creates the Firebase user and sends a verification email; the API requires it verified.
   * Only creation can fail the sign-up: once the account exists, a failed send (Firebase answers
   * 503 at times) is reported as `emailSent: false`, and signing in offers to resend it.
   */
  async emailSignUp(a: Auth, email: string, password: string) {
    const cred = await createUserWithEmailAndPassword(a, email, password);
    const emailSent = await sendEmailVerification(cred.user).then(
      () => true,
      () => false,
    );
    return { emailSent };
  },
  /** Resend for a signed-in, still-unverified email user (the API refuses them until verified). */
  async resendVerification(a: Auth) {
    if (!a.currentUser) throw new Error('Sign in again to resend the verification email.');
    await sendEmailVerification(a.currentUser);
  },
  /** Firebase sends the reset email; with enumeration protection on, it never says whether the account exists. */
  passwordReset: (a: Auth, email: string) => sendPasswordResetEmail(a, email),
  googleSignIn: (a: Auth) => signInWithPopup(a, new GoogleAuthProvider(), popupRedirectResolver),
  customTokenSignIn: (a: Auth, token: string) => signInWithCustomToken(a, token),
  onIdToken: (a: Auth, cb: (token: string | null) => void) => onIdTokenChanged(a, async (u) => cb(u ? await u.getIdToken() : null)),
  signOut: (a: Auth) => signOut(a),
};
