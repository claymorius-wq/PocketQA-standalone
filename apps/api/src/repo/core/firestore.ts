import type { Firestore } from 'firebase-admin/firestore';
import type { CoreRepo } from './types';

export function firestoreCoreRepo(_fs: Firestore): CoreRepo {
  return {};
}
