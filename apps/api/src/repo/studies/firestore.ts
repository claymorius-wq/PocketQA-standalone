import type { Firestore } from 'firebase-admin/firestore';
import type { StudiesRepo } from './types';

export function firestoreStudiesRepo(_fs: Firestore): StudiesRepo {
  return {};
}
