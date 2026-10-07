import type { AuthMode, ClientConfig, StorageMode, User, WalletLoginResponse } from '@pocket-qa/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Auth } from 'firebase/auth';
import { api, ApiError, configureClient, getClientConfig } from '../api/client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { walletErrorText } from '../wallet/errors';
import type { StandardWallet } from '../wallet/standard';
import { walletLoginFlow } from '../wallet/walletLogin';
import { firebaseAuth, firebaseSession } from './firebaseClient';
import { firebaseErrorText } from './firebaseErrors';
import { PRODUCTION_BUILD } from '../lib/deployment';
import { endsRestoredSession, resolveManagedSession } from './managedSession';
import { restoreToken } from './restore';
import { tokenStore } from './tokenStore';
import { nativeRecorder } from '../evidence/recorder';
import { disposeAllWebRecorders } from '../evidence/webScreenRecorder';

type NewAccount = { role: 'tester' | 'builder'; displayName: string };
type Session = {
  ready: boolean;
  user: User | null;
  /** Deployment auth mode from the server's public config ('local' if it can't be read). */
  authMode: AuthMode;
  /** Evidence storage from the server's public config, for honest copy about where data lives. */
  storage: StorageMode;
  walletLogin: boolean;
  /** The deployment offers Google sign-in (server /config firebase.googleSignIn; web only). */
  googleSignIn: boolean;
  /**
   * Production builds only: the server's /config couldn't be read, so the deployment's auth
   * mode is unknown. The app says so and offers a retry instead of assuming local accounts.
   */
  unreachable: boolean;
  retryConnection: () => void;
  /** Deployment features from /config; off unless the server says on (never a fake success). */
  features: ClientConfig['features'];
  /** Signed in with a managed identity that has no Pocket QA account yet: ask for a role. */
  needsAccount: boolean;
  /** Managed sign-in with no Pocket QA account yet: the identity's email (for "No Pocket QA account uses <email> yet"), else null. */
  signedInEmail: string | null;
  /** Role and name typed at sign-up (firebase mode), to prefill "Finish your account". */
  pendingProfile: NewAccount | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** Firebase mode: an email sign-in was refused because the address isn't verified yet. */
  unverifiedEmail: boolean;
  /** Firebase mode: resend the verification email to the unverified user, then sign out. */
  resendVerification: () => Promise<void>;
  /** Firebase mode: drop a refused unverified sign-in without resending (leaving sign-in). */
  discardUnverified: () => Promise<void>;
  /** Firebase mode: send a reset link. Resolves the same whether or not the account exists. */
  sendPasswordReset: (email: string) => Promise<void>;
  // Firebase mode: the account is finished after the email is verified.
  /** `verification`: 'sent', 'unsent' (account created, email failed; sign in to resend) or 'none' (local mode). */
  signUp: (input: { email: string; password: string; displayName: string; role: 'tester' | 'builder' }) => Promise<{ verification: 'sent' | 'unsent' | 'none' }>;
  signInWithGoogle: () => Promise<void>;
  /** Web: the chosen Wallet Standard wallet; Android: Mobile Wallet Adapter (no choice here). */
  signInWithWallet: (newAccount?: NewAccount, wallet?: StandardWallet) => Promise<void>;
  completeAccount: (input: NewAccount) => Promise<void>;
  /**
   * Ends the session. `deleteRecordings` also deletes every native recording on this device; pass it
   * only after the tester confirmed exactly that (Settings' sign-out sheet, account deletion).
   */
  signOut: (opts?: { deleteRecordings?: boolean }) => Promise<void>;
  refreshUser: () => Promise<void>;
};
const Ctx = createContext<Session | null>(null);
const PENDING_PROFILE = 'pocketqa.pendingProfile';
const NO_FEATURES: ClientConfig['features'] = { testCredits: false, devnetTransfers: false, settlement: 'off' };

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const token = useRef<string | null>(null);
  const fb = useRef<Auth | null>(null);
  const [user, setUser] = useState<User | null>(null);
  // Any change of signed-in user (not only signOut) clears the query cache, so one account's lists
  // are never shown to another (study ia2ed9db: the eligible list). The same user again keeps it.
  const userId = useRef<string | null>(null);
  const switchUser = useCallback(
    (next: User) => {
      if (userId.current !== null && userId.current !== next.id) qc.clear();
      userId.current = next.id;
      setUser(next);
    },
    [qc],
  );
  const [ready, setReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('local');
  const [walletLogin, setWalletLogin] = useState(false);
  const [googleSignIn, setGoogleSignIn] = useState(false);
  const [signedInEmail, setSignedInEmail] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageMode>('local');
  const [features, setFeatures] = useState<ClientConfig['features']>(NO_FEATURES);
  const [unreachable, setUnreachable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [needsAccount, setNeedsAccount] = useState(false);
  const [pendingProfile, setPendingProfile] = useState<NewAccount | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState(false);

  const endSession = useCallback(async (opts?: { deleteRecordings?: boolean }) => {
    // A web screen recording never outlives the session: stop its devices and drop its bytes (they
    // live only in this page's memory; nothing is stored on the device).
    disposeAllWebRecorders();
    // Native recordings are kept unless the tester confirmed deleting them (Hamza's preserve rule,
    // 2026-10-07): a 401, a failed restore or an ended Firebase session never costs a recording.
    // Another account on this phone still never sees them: a clip is listed only to its own
    // participation's screen (pqa-qa r1 guardrail 1).
    if (opts?.deleteRecordings) await nativeRecorder()?.clearAllAsync?.().catch(() => {});
    token.current = null;
    setUser(null);
    userId.current = null;
    setNeedsAccount(false);
    setSignedInEmail(null);
    qc.clear();
    await tokenStore.clear().catch(() => {});
    if (fb.current) await firebaseSession.signOut(fb.current).catch(() => {});
  }, [qc]);

  /** Firebase mode: map the signed-in identity to its account (or ask for a role). */
  const resolveManaged = useCallback(async () => {
    const r = await resolveManagedSession((body) => api('identitySession', { body }));
    if (r.kind === 'signed-in') {
      setNeedsAccount(false);
      setSignedInEmail(null);
      switchUser(r.user);
    } else {
      setNeedsAccount(true);
      setSignedInEmail(fb.current?.currentUser?.email ?? null);
      const saved = await AsyncStorage.getItem(PENDING_PROFILE).catch(() => null);
      setPendingProfile(saved ? (JSON.parse(saved) as NewAccount) : null);
    }
  }, [switchUser]);

  useEffect(() => {
    configureClient({ getToken: () => token.current, onUnauthenticated: () => void endSession() });
    let unsubscribe: (() => void) | null = null;
    (async () => {
      const cfg = await getClientConfig().catch(() => null);
      if (!cfg && PRODUCTION_BUILD) {
        setUnreachable(true);
        setReady(true);
        return;
      }
      setUnreachable(false);
      setWalletLogin(cfg?.walletLogin ?? false);
      setGoogleSignIn(cfg?.authMode === 'firebase' && !!cfg.firebase?.googleSignIn);
      setStorage(cfg?.storage ?? 'local');
      setFeatures(cfg?.features ?? NO_FEATURES);
      if (cfg?.authMode === 'firebase' && cfg.firebase) {
        setAuthMode('firebase');
        const a = firebaseAuth(cfg.firebase);
        fb.current = a;
        configureClient({
          getToken: () => token.current,
          onUnauthenticated: () => void endSession(),
          // An expired ID token (e.g. after sleep) is refreshed once before signing out.
          refreshToken: async () => {
            token.current = (await a.currentUser?.getIdToken(true)) ?? null;
            return token.current;
          },
        });
        let first = true;
        // The SDK refreshes ID tokens (hourly); the API bearer is always the latest one.
        unsubscribe = firebaseSession.onIdToken(a, (t) => {
          token.current = t;
          if (!first) return;
          first = false;
          // A persisted Firebase session from an earlier visit.
          // Only a definite "not signed in" ends the session; offline keeps it for later.
          void (t ? resolveManaged().catch((e) => (endsRestoredSession(e) ? endSession() : undefined)) : Promise.resolve()).finally(() => setReady(true));
        });
        return;
      }
      const installed = { get: () => AsyncStorage.getItem('pocketqa.installed'), set: (v: string) => AsyncStorage.setItem('pocketqa.installed', v) };
      const saved = await restoreToken(installed, tokenStore).catch(() => null);
      if (saved) {
        token.current = saved;
        try {
          switchUser(await api('me'));
        } catch (e) {
          // Only a definite "signed out" ends the saved session; offline keeps it and says the
          // server can't be reached, with Try again (main-app P2: an offline start used to sign out
          // and delete every recording).
          if (endsRestoredSession(e)) await endSession();
          else setUnreachable(true);
        }
      }
      setReady(true);
    })();
    return () => unsubscribe?.();
  }, [endSession, resolveManaged, attempt, switchUser]);

  const accept = useCallback(async (res: { token: string; user: User }) => {
    token.current = res.token;
    await tokenStore.set(res.token);
    switchUser(res.user);
  }, [switchUser]);

  /** Firebase mode: wait for the ID token after a sign-in, then map it. */
  const afterFirebaseSignIn = useCallback(async () => {
    const t = await fb.current!.currentUser?.getIdToken();
    token.current = t ?? null;
    await resolveManaged();
  }, [resolveManaged]);

  const acceptWallet = useCallback(
    async (res: WalletLoginResponse) => {
      if (res.session.kind === 'local') return accept({ token: res.session.token, user: res.user });
      // Exchange the custom token for a Firebase ID token; the custom token itself is never a bearer.
      await firebaseSession.customTokenSignIn(fb.current!, res.session.customToken);
      await afterFirebaseSignIn();
    },
    [accept, afterFirebaseSignIn],
  );

  const value = useMemo<Session>(
    () => ({
      ready,
      user,
      authMode,
      storage,
      walletLogin,
      googleSignIn,
      signedInEmail,
      unreachable,
      retryConnection: () => {
        setReady(false);
        setAttempt((n) => n + 1);
      },
      features,
      needsAccount,
      pendingProfile,
      unverifiedEmail,
      signIn: async (email, password) => {
        if (authMode === 'firebase') {
          setUnverifiedEmail(false);
          try {
            await firebaseSession.emailSignIn(fb.current!, email, password);
          } catch (e) {
            throw new Error(firebaseErrorText(e, 'sign-in') ?? 'Sign-in failed.', { cause: e });
          }
          try {
            return await afterFirebaseSignIn();
          } catch (e) {
            if (!(e instanceof ApiError && e.code === 'EMAIL_UNVERIFIED')) throw e;
            // Stay signed in to Firebase only so the verification email can be resent.
            setUnverifiedEmail(true);
            throw new Error('Verify your email first: open the link we sent you, then sign in again.', { cause: e });
          }
        }
        return accept(await api('login', { body: { email, password }, token: null }));
      },
      signUp: async (input) => {
        if (authMode === 'firebase') {
          let emailSent: boolean;
          try {
            ({ emailSent } = await firebaseSession.emailSignUp(fb.current!, input.email, input.password));
          } catch (e) {
            throw new Error(firebaseErrorText(e, 'sign-up') ?? 'Sign-up failed.', { cause: e });
          }
          // The account exists from here on: a failing local sign-out must not turn it into
          // "Couldn't create account" (web-launch review P3-5).
          await firebaseSession.signOut(fb.current!).catch(() => {});
          // Remember the choices for "Finish your account" after the email is verified.
          await AsyncStorage.setItem(PENDING_PROFILE, JSON.stringify({ role: input.role, displayName: input.displayName })).catch(() => {});
          return { verification: emailSent ? 'sent' : 'unsent' };
        }
        await accept(await api('register', { body: input, token: null }));
        return { verification: 'none' };
      },
      resendVerification: async () => {
        try {
          await firebaseSession.resendVerification(fb.current!);
        } catch (e) {
          throw new Error(firebaseErrorText(e, 'sign-in') ?? (e instanceof Error ? e.message : 'Couldn’t resend the email.'), { cause: e });
        } finally {
          setUnverifiedEmail(false);
          await endSession();
        }
      },
      discardUnverified: async () => {
        setUnverifiedEmail(false);
        await endSession();
      },
      sendPasswordReset: async (email) => {
        try {
          await firebaseSession.passwordReset(fb.current!, email);
        } catch (e) {
          if (!String((e as { code?: string })?.code ?? '').startsWith('auth/')) throw new Error('Couldn’t send the email. Try again.', { cause: e });
          const text = firebaseErrorText(e, 'reset');
          if (text) throw new Error(text, { cause: e });
          // Otherwise behave exactly like success (no account enumeration).
        }
      },
      signInWithGoogle: async () => {
        try {
          await firebaseSession.googleSignIn(fb.current!);
        } catch (e) {
          throw new Error(firebaseErrorText(e, 'google') ?? 'Sign-in failed.', { cause: e });
        }
        await afterFirebaseSignIn();
      },
      signInWithWallet: async (newAccount, wallet) => {
        let res: WalletLoginResponse;
        try {
          res = await walletLoginFlow({ ...(newAccount ? { newAccount } : {}), ...(wallet ? { wallet } : {}) });
        } catch (e) {
          // API errors keep their code (NOT_FOUND asks to create an account); wallet errors read plainly.
          if (e instanceof ApiError) throw e;
          throw new Error(walletErrorText(e, 'sign-in'), { cause: e });
        }
        await acceptWallet(res);
      },
      completeAccount: async (input) => {
        const r = await api('identitySession', { body: { newAccount: input } });
        setNeedsAccount(false);
        setSignedInEmail(null);
        setPendingProfile(null);
        await AsyncStorage.removeItem(PENDING_PROFILE).catch(() => {});
        switchUser(r.user);
      },
      signOut: async (opts) => {
        await api('logout').catch(() => {});
        await endSession(opts);
      },
      refreshUser: async () => switchUser(await api('me')),
    }),
    [ready, user, authMode, storage, walletLogin, googleSignIn, signedInEmail, unreachable, features, needsAccount, pendingProfile, unverifiedEmail, accept, acceptWallet, afterFirebaseSignIn, endSession, switchUser],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
