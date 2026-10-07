import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * The server's Firestore (docs/plans/firebase-vercel-refactor.md §1, §9).
 *  - Emulator (all automated tests): FIRESTORE_EMULATOR_HOST + a `demo-` project id, no credential.
 *  - Hosted: the service account JSON from the SERVER-ONLY env var FIREBASE_SERVICE_ACCOUNT_JSON
 *    (never an EXPO_PUBLIC_ variable, never in the client bundle).
 * Refuses the emulator for a non-demo project and a credential-less real project.
 */
/**
 * The server's Google credential for a real project: the service account JSON from the SERVER-ONLY
 * env var FIREBASE_SERVICE_ACCOUNT_JSON (hosted), which must belong to `projectId`; otherwise null
 * (local runs fall back to application default credentials).
 */
export function serviceAccountCredential(env: NodeJS.ProcessEnv, projectId: string) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const sa = JSON.parse(raw) as { project_id?: string };
  if (sa.project_id !== projectId) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON belongs to a different project.');
  return cert(sa as Parameters<typeof cert>[0]);
}

export function openFirestore(env: NodeJS.ProcessEnv, projectId: string): Firestore {
  const emulator = env.FIRESTORE_EMULATOR_HOST;
  if (emulator) {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(emulator)) throw new Error('FIRESTORE_EMULATOR_HOST must be a loopback host:port.');
    if (!projectId.startsWith('demo-')) throw new Error('The Firestore emulator may only be used with a demo- project id.');
  }
  const name = `pocketqa-fs-${projectId}`;
  let app: App | undefined = getApps().find((a) => a.name === name);
  if (!app) {
    if (emulator) {
      app = initializeApp({ projectId }, name);
    } else {
      const credential = serviceAccountCredential(env, projectId);
      if (!credential) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON (server-only) is required for hosted Firestore.');
      app = initializeApp({ projectId, credential }, name);
    }
  }
  const db = getFirestore(app);
  return db;
}
