import * as firebaseAuth from 'firebase/auth';
import type { Persistence } from 'firebase/auth';
import { secureKv } from './secureKv';

type RnPersistence = (storage: typeof secureKv) => Persistence;

/**
 * Native: the session survives app restarts (ledger I8). `getAuth` on React Native keeps the
 * session in memory only. Metro resolves `firebase/auth` to the React Native build of
 * @firebase/auth, which exports `getReactNativePersistence`, but the package's TypeScript types
 * are the web ones, hence the narrow cast and the runtime check (a wrong bundle fails loudly).
 */
export function firebasePersistence(): Persistence {
  const make = (firebaseAuth as unknown as { getReactNativePersistence?: RnPersistence }).getReactNativePersistence;
  if (typeof make !== 'function') throw new Error('Firebase React Native persistence is missing from this build.');
  return make(secureKv);
}
