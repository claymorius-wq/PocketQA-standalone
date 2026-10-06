import type { Firestore } from 'firebase-admin/firestore';
import type { EvidenceRepo } from './types';

export function firestoreEvidenceRepo(_fs: Firestore): EvidenceRepo {
  return {};
}
