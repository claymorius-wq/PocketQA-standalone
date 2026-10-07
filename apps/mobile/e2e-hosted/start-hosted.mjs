// The hosted web build rehearsed locally (no cloud): FakeS3 on loopback, then the built
// .vercel/output served by scripts/vercel/serve-local.mjs exactly as its config.json routes it,
// with the api.func reading the emulators (Firestore, Auth) that `firebase emulators:exec` started.
// Development env rules on the API: staging refuses emulator paths by design. The WEB bundle is the
// real staging build (scripts/vercel/build.mjs --env staging).
import { join } from 'node:path';
import { FakeS3 } from '../../api/test/fakeS3.ts';
import { serveLocal } from '../../../scripts/vercel/serve-local.mjs';

const PORT = Number(process.env.PQA_HOSTED_PORT ?? 8495);
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST;
if (!AUTH || !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run under firebase emulators:exec (needs FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST).');

const s3 = new FakeS3();
await s3.start();
Object.assign(process.env, {
  POCKETQA_DATA_BACKEND: 'firestore',
  POCKETQA_AUTH_MODE: 'firebase',
  POCKETQA_FIREBASE_PROJECT_ID: 'demo-pocketqa',
  POCKETQA_FIREBASE_WEB_API_KEY: 'emulator-key', // check-secrets: allow (placeholder public Firebase web config in tests)
  POCKETQA_FIREBASE_AUTH_EMULATOR_HOST: AUTH,
  POCKETQA_STORAGE: 'r2',
  POCKETQA_R2_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
  POCKETQA_R2_BUCKET: 'pqa-test',
  POCKETQA_R2_ACCESS_KEY_ID: 'test-key',
  POCKETQA_R2_SECRET_ACCESS_KEY: 'test-secret', // check-secrets: allow (placeholder test value)
  POCKETQA_R2_ENDPOINT: `http://127.0.0.1:${s3.port}`,
  POCKETQA_R2_ALLOW_DELETE: '1',
  POCKETQA_SETTLEMENT: 'simulated',
  CRON_SECRET: 'c'.repeat(40),
});
// PQA_HOSTED_OUTPUT: a private copy of the build (.vercel/output is shared by every pane in the worktree).
const OUTPUT = process.env.PQA_HOSTED_OUTPUT ?? join(import.meta.dirname, '../../../.vercel/output');
await serveLocal({ dir: OUTPUT, port: PORT, testConnect: `http://${AUTH}` });
console.log(`hosted rehearsal on http://127.0.0.1:${PORT} (auth emulator ${AUTH}, fake S3 ${s3.port})`);
