import { firebaseErrorText } from '../src/auth/firebaseErrors';

// Increment-4 review r1 P3: sign-in errors never reveal whether an account exists.
it('maps Firebase sign-in errors to one generic message', () => {
  for (const code of ['auth/user-not-found', 'auth/wrong-password', 'auth/invalid-credential', 'auth/invalid-email', 'auth/user-disabled']) {
    expect(firebaseErrorText({ code }, 'sign-in')).toBe('Email or password is incorrect.');
  }
  expect(firebaseErrorText({ code: 'auth/email-already-in-use' }, 'sign-up')).toMatch(/If you already have one, sign in/);
  expect(firebaseErrorText({ code: 'auth/too-many-requests' }, 'sign-in')).toMatch(/Too many attempts/);
  expect(firebaseErrorText(new Error('x'), 'sign-in')).toBeNull();
});

it('Google sign-in errors get their own honest messages (review r2 P3)', () => {
  expect(firebaseErrorText({ code: 'auth/unauthorized-domain' }, 'google')).toMatch(/isn.t available on this site/);
  expect(firebaseErrorText({ code: 'auth/account-exists-with-different-credential' }, 'google')).toMatch(/another sign-in method/);
  expect(firebaseErrorText({ code: 'auth/popup-closed-by-user' }, 'google')).toBe('Sign-in was cancelled.');
  expect(firebaseErrorText({ code: 'auth/internal-error' }, 'google')).not.toMatch(/password/);
});

it('password reset never reveals whether an account exists (ledger I4)', () => {
  expect(firebaseErrorText({ code: 'auth/invalid-email' }, 'reset')).toBe('Enter a valid email address.');
  // "No such user" (if enumeration protection is off) is treated like success by the caller.
  expect(firebaseErrorText({ code: 'auth/user-not-found' }, 'reset')).toBeNull();
  expect(firebaseErrorText({ code: 'auth/too-many-requests' }, 'reset')).toMatch(/Too many attempts/);
});
