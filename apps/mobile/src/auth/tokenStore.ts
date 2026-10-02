import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

const KEY = 'pocketqa.session';

/**
 * Native: the OS keystore (expo-secure-store). Web preview: sessionStorage, which clears
 * when the tab closes. That is acceptable for a local-only preview, but it is readable by
 * scripts on the page, so the web build must never be deployed.
 */
export const tokenStore = {
  async get(): Promise<string | null> {
    if (Platform.OS === 'web') return globalThis.sessionStorage?.getItem(KEY) ?? null;
    return SecureStore.getItemAsync(KEY);
  },
  async set(token: string): Promise<void> {
    if (Platform.OS === 'web') return void globalThis.sessionStorage?.setItem(KEY, token);
    await SecureStore.setItemAsync(KEY, token);
  },
  async clear(): Promise<void> {
    if (Platform.OS === 'web') return void globalThis.sessionStorage?.removeItem(KEY);
    await SecureStore.deleteItemAsync(KEY);
  },
};
