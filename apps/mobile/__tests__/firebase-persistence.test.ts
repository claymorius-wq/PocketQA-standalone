// Ledger I8: native Firebase sessions persist in the OS keystore, never in memory only or
// in unencrypted AsyncStorage.
const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
const mockMade: unknown[] = [];
let mockExported: unknown = (storage: unknown) => {
  mockMade.push(storage);
  return { type: 'LOCAL' };
};
jest.mock('firebase/auth', () => ({
  get getReactNativePersistence() {
    return mockExported;
  },
}));

import { secureKey, secureKv } from '../src/auth/secureKv';
import { firebasePersistence } from '../src/auth/firebasePersistence.native';

it('escapes Firebase keys into the keystore alphabet, reversibly and without collisions', async () => {
  const k = 'firebase:authUser:AIza-key:pocketqa';
  expect(secureKey(k)).toMatch(/^[A-Za-z0-9._-]+$/);
  expect(secureKey('a:b')).not.toBe(secureKey('a_b'));
  await secureKv.setItem(k, '{"stsTokenManager":{}}');
  expect(await secureKv.getItem(k)).toBe('{"stsTokenManager":{}}');
  expect([...mockStore.keys()]).toEqual([secureKey(k)]);
  await secureKv.removeItem(k);
  expect(await secureKv.getItem(k)).toBeNull();
});

it('native persistence is React Native persistence over the keystore adapter', () => {
  expect(firebasePersistence()).toEqual({ type: 'LOCAL' });
  expect(mockMade).toEqual([secureKv]);
});

it('fails loudly if the bundle lacks the React Native Firebase build', () => {
  mockExported = undefined;
  expect(() => firebasePersistence()).toThrow(/persistence is missing/);
});
