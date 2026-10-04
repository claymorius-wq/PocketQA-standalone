import { browserSessionPersistence, type Persistence } from 'firebase/auth';

/**
 * Web: tab-scoped persistence (sessionStorage), like local mode. Closing the tab signs out
 * and the refresh token isn't kept in long-lived IndexedDB (ADR 0005 §1).
 */
export function firebasePersistence(): Persistence {
  return browserSessionPersistence;
}
