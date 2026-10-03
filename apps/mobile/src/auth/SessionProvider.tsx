import type { User } from '@pocket-qa/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, configureClient } from '../api/client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { restoreToken } from './restore';
import { tokenStore } from './tokenStore';

type Session = {
  ready: boolean;
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: { email: string; password: string; displayName: string; role: 'tester' | 'builder' }) => Promise<void>;
  signOut: () => Promise<void>;
  refreshUser: () => Promise<void>;
};
const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const token = useRef<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const clear = useCallback(async () => {
    token.current = null;
    setUser(null);
    qc.clear();
    await tokenStore.clear().catch(() => {});
  }, [qc]);

  useEffect(() => {
    configureClient({ getToken: () => token.current, onUnauthenticated: () => void clear() });
    (async () => {
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
  }, [clear]);

  const accept = useCallback(async (res: { token: string; user: User }) => {
    token.current = res.token;
    await tokenStore.set(res.token);
    setUser(res.user);
  }, []);

  const value = useMemo<Session>(
    () => ({
      ready,
      user,
      signIn: async (email, password) => accept(await api('login', { body: { email, password }, token: null })),
      signUp: async (input) => accept(await api('register', { body: input, token: null })),
      signOut: async () => {
        await api('logout').catch(() => {});
        await clear();
      },
      refreshUser: async () => setUser(await api('me')),
    }),
    [ready, user, accept, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
