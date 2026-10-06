import type { Firestore } from 'firebase-admin/firestore';
import type { StudiesRepo } from './types';

/** Placeholder until the native Firestore implementation lands: every operation fails loudly. */
export function firestoreStudiesRepo(_fs: Firestore): StudiesRepo {
  return new Proxy({} as StudiesRepo, {
    get: (_t, op) => () => Promise.reject(new Error(`studies.${String(op)}: the Firestore studies repository is not implemented yet.`)),
  });
}
