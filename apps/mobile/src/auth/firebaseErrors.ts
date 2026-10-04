/**
 * Firebase errors as user-facing text. Sign-in failures are deliberately generic so they
 * never reveal whether an account exists.
 */
export function firebaseErrorText(e: unknown, action: 'sign-in' | 'sign-up' | 'google' | 'reset'): string | null {
  const code = (e as { code?: string })?.code ?? '';
  if (!code.startsWith('auth/')) return null;
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a little and try again.';
  if (code === 'auth/network-request-failed') return 'Can’t reach the sign-in service. Check your connection.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Sign-in was cancelled.';
  if (action === 'reset') {
    if (code === 'auth/invalid-email' || code === 'auth/missing-email') return 'Enter a valid email address.';
    // Anything else (including "no such user" when enumeration protection is off) gets the
    // same answer as success, so the form never reveals whether an account exists.
    return null;
  }
  if (action === 'google') {
    if (code === 'auth/unauthorized-domain' || code === 'auth/operation-not-allowed') return 'Google sign-in isn’t available on this site.';
    if (code === 'auth/account-exists-with-different-credential') return 'This email already uses another sign-in method. Sign in with that method.';
    if (code === 'auth/popup-blocked') return 'Allow pop-ups for this site to sign in with Google.';
    return 'Google sign-in didn’t complete. Try again.';
  }
  if (action === 'sign-up') {
    if (code === 'auth/weak-password') return 'Choose a stronger password.';
    if (code === 'auth/invalid-email') return 'Enter a valid email address.';
    return 'Couldn’t create an account with this email. If you already have one, sign in.';
  }
  return 'Email or password is incorrect.';
}
