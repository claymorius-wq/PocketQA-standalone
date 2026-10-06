import type { Firestore } from 'firebase-admin/firestore';
import type { EvidenceRepo } from './types';

// STEP B replaces this stub with the native implementation; until then every operation refuses.
export function firestoreEvidenceRepo(_fs: Firestore): EvidenceRepo {
  return new Proxy({} as EvidenceRepo, {
    get: (_t, op) => () => Promise.reject(new Error(`evidence.${String(op)}: Firestore implementation not yet available`)),
  });
}
