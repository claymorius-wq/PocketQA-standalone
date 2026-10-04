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
import { endsRestoredSession, resolveManagedSession } from './managedSession';
import { restoreToken } from './restore';
import { tokenStore } from './tokenStore';

type NewAccount = { role: 'tester' | 'builder'; displayName: string };
type Session = {
  ready: boolean;
  user: User | null;
  /** Deployment auth mode from the server's public config ('local' if it can't be read). */
  authMode: AuthMode;
  /** Evidence storage from the server's public config, for honest copy about where data lives. */
  storage: StorageMode;
  walletLogin: boolean;
  /** Deployment features from /config; off unless the server says on (never a fake success). */
  features: ClientConfig['features'];
  /** Signed in with a managed identity that has no Pocket QA account yet: ask for a role. */
  needsAccount: boolean;
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
  /** Firebase mode returns `verificationSent`: the account is created after the email is verified. */
  signUp: (input: { email: string; password: string; displayName: string; role: 'tester' | 'builder' }) => Promise<{ verificationSent: boolean }>;
  signInWithGoogle: () => Promise<void>;
  /** Web: the chosen Wallet Standard wallet; Android: Mobile Wallet Adapter (no choice here). */
  signInWithWallet: (newAccount?: NewAccount, wallet?: StandardWallet) => Promise<void>;
  completeAccount: (input: NewAccount) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};
const Ctx = createContext<Session | null>(null);
const PENDING_PROFILE = 'pocketqa.pendingProfile';
const NO_FEATURES: ClientConfig['features'] = { testCredits: false, devnetTransfers: false };

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const token = useRef<string | null>(null);
  const fb = useRef<Auth | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('local');
  const [walletLogin, setWalletLogin] = useState(false);
  const [storage, setStorage] = useState<StorageMode>('local');
  const [features, setFeatures] = useState<ClientConfig['features']>(NO_FEATURES);
  const [needsAccount, setNeedsAccount] = useState(false);
  const [pendingProfile, setPendingProfile] = useState<NewAccount | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState(false);

  const clear = useCallback(async () => {
    token.current = null;
    setUser(null);
    setNeedsAccount(false);
    qc.clear();
    await tokenStore.clear().catch(() => {});
    if (fb.current) await firebaseSession.signOut(fb.current).catch(() => {});
  }, [qc]);

  /** Firebase mode: map the signed-in identity to its account (or ask for a role). */
  const resolveManaged = useCallback(async () => {
    const r = await resolveManagedSession((body) => api('identitySession', { body }));
    if (r.kind === 'signed-in') {
      setNeedsAccount(false);
      setUser(r.user);
    } else {
      setNeedsAccount(true);
      const saved = await AsyncStorage.getItem(PENDING_PROFILE).catch(() => null);
      setPendingProfile(saved ? (JSON.parse(saved) as NewAccount) : null);
    }
  }, []);

  useEffect(() => {
    configureClient({ getToken: () => token.current, onUnauthenticated: () => void clear() });
    let unsubscribe: (() => void) | null = null;
    (async () => {
      const cfg = await getClientConfig().catch(() => null);
      setWalletLogin(cfg?.walletLogin ?? false);
      setStorage(cfg?.storage ?? 'local');
      setFeatures(cfg?.features ?? NO_FEATURES);
      if (cfg?.authMode === 'firebase' && cfg.firebase) {
        setAuthMode('firebase');
        const a = firebaseAuth(cfg.firebase);
        fb.current = a;
        configureClient({
          getToken: () => token.current,
          onUnauthenticated: () => void clear(),
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
          void (t ? resolveManaged().catch((e) => (endsRestoredSession(e) ? clear() : undefined)) : Promise.resolve()).finally(() => setReady(true));
        });
        return;
      }
      const installed = { get: () => AsyncStorage.getItem('pocketqa.installed'), set: (v: string) => AsyncStorage.setItem('pocketqa.installed', v) };
      const saved = await restoreToken(installed, tokenStore).catch(() => null);
      if (saved) {
        token.current = saved;
        try {
          setUser(await api('me'));
        } catch {
          await clear();
        }
      }
      setReady(true);
    })();
    return () => unsubscribe?.();
  }, [clear, resolveManaged]);

  const accept = useCallback(async (res: { token: string; user: User }) => {
    token.current = res.token;
    await tokenStore.set(res.token);
    setUser(res.user);
  }, []);

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
          try {
            await firebaseSession.emailSignUp(fb.current!, input.email, input.password);
          } catch (e) {
            throw new Error(firebaseErrorText(e, 'sign-up') ?? 'Sign-up failed.', { cause: e });
          }
          await firebaseSession.signOut(fb.current!);
          // Remember the choices for "Finish your account" after the email is verified.
          await AsyncStorage.setItem(PENDING_PROFILE, JSON.stringify({ role: input.role, displayName: input.displayName })).catch(() => {});
          return { verificationSent: true };
        }
        await accept(await api('register', { body: input, token: null }));
        return { verificationSent: false };
      },
      resendVerification: async () => {
        try {
          await firebaseSession.resendVerification(fb.current!);
        } catch (e) {
          throw new Error(firebaseErrorText(e, 'sign-in') ?? (e instanceof Error ? e.message : 'Couldn’t resend the email.'), { cause: e });
        } finally {
          setUnverifiedEmail(false);
          await clear();
        }
      },
      discardUnverified: async () => {
        setUnverifiedEmail(false);
        await clear();
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
        setPendingProfile(null);
        await AsyncStorage.removeItem(PENDING_PROFILE).catch(() => {});
        setUser(r.user);
      },
      signOut: async () => {
        await api('logout').catch(() => {});
        await clear();
      },
      refreshUser: async () => setUser(await api('me')),
    }),
    [ready, user, authMode, storage, walletLogin, features, needsAccount, pendingProfile, unverifiedEmail, accept, acceptWallet, afterFirebaseSignIn, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
