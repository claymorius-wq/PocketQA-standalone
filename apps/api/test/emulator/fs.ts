import type { Firestore } from 'firebase-admin/firestore';
import { openFirestore } from '../../src/firestore/admin';

export const PROJECT = 'demo-pocketqa';

/** The emulator's Firestore; refuses to run outside `firebase emulators:exec`. */
export function emulatorFirestore(): Firestore {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run with `pnpm test:emulator` (needs FIRESTORE_EMULATOR_HOST).');
  return openFirestore(process.env, PROJECT);
}

/** Deletes every document in the emulator (never reaches a real project: the host is loopback-only). */
export async function clearEmulator(): Promise<void> {
  const host = process.env.FIRESTORE_EMULATOR_HOST!;
  const res = await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  if (!res.ok) throw new Error(`emulator clear failed: ${res.status}`);
}
