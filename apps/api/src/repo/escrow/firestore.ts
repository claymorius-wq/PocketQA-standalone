import type { Firestore } from 'firebase-admin/firestore';
import type { EscrowRepo } from './types';

export function firestoreEscrowRepo(_fs: Firestore): EscrowRepo {
  return {};
}
