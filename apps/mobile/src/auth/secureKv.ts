import * as SecureStore from 'expo-secure-store';

/**
 * Async key-value storage over the OS keystore (expo-secure-store), in the shape Firebase's
 * React Native persistence expects. SecureStore keys allow only [A-Za-z0-9._-], and Firebase
 * keys contain ':' (e.g. `firebase:authUser:<apiKey>:pocketqa`), so other characters are
 * escaped reversibly as `_xHH`. Refresh tokens stay in the keystore, never AsyncStorage.
 */
export function secureKey(key: string): string {
  return key.replace(/[^A-Za-z0-9.-]/g, (c) => `_x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

export const secureKv = {
  getItem: (key: string) => SecureStore.getItemAsync(secureKey(key)),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(secureKey(key), value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(secureKey(key)),
};
