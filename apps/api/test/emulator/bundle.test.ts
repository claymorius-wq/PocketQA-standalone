import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeS3 } from '../fakeS3';
import { clearEmulator, PROJECT } from './fs';

// The BUILT Vercel function (.vercel/output/functions/api.func/index.mjs, from
// `node scripts/vercel/build.mjs`) behind a plain Node server, on the emulators: proves the bundle
// itself runs (Firestore gRPC, Firebase Auth, R2 client), routes /api/*, and parses JSON bodies.
const BUNDLE = join(__dirname, '../../../../.vercel/output/functions/api.func/index.mjs');
const d = existsSync(BUNDLE) ? describe : describe.skip;
const CRON = 'b'.repeat(40);
const s3 = new FakeS3();
let server: Server;
let base = '';

d('built Vercel function on the emulators', () => {
  beforeAll(async () => {
    await s3.start();
    await clearEmulator();
    const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
    Object.assign(process.env, {
      POCKETQA_DATA_BACKEND: 'firestore',
      POCKETQA_AUTH_MODE: 'firebase',
      POCKETQA_FIREBASE_PROJECT_ID: PROJECT,
      POCKETQA_FIREBASE_WEB_API_KEY: 'emulator-key', // check-secrets: allow (placeholder public Firebase web config in tests)
      POCKETQA_FIREBASE_AUTH_EMULATOR_HOST: AUTH,
      POCKETQA_STORAGE: 'r2',
      POCKETQA_R2_ACCOUNT_ID: '0'.repeat(32),
      POCKETQA_R2_BUCKET: 'pqa-test',
      POCKETQA_R2_ACCESS_KEY_ID: 'test-key',
      POCKETQA_R2_SECRET_ACCESS_KEY: 'test-secret', // check-secrets: allow (placeholder test value)
      POCKETQA_R2_ENDPOINT: `http://127.0.0.1:${s3.port}`,
      POCKETQA_R2_ALLOW_DELETE: '1',
      POCKETQA_SETTLEMENT: 'off',
      CRON_SECRET: CRON,
    });
    const handler = (await import(pathToFileURL(BUNDLE).href)).default as (req: unknown, res: unknown) => Promise<void>;
    server = createServer((req, res) => void handler(req, res));
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterAll(async () => {
    await new Promise((r) => server?.close(r));
    await s3.stop();
  });

  it('serves the public client config under /api', async () => {
    const res = await fetch(`${base}/api/config`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ authMode: 'firebase', storage: 'r2' });
  });

  it('runs a cron job with the secret, 404 without it', async () => {
    expect((await fetch(`${base}/api/jobs/sweep`)).status).toBe(404);
    const ok = await fetch(`${base}/api/jobs/sweep`, { headers: { authorization: `Bearer ${CRON}` } });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ job: 'sweep', ran: true });
  });

  it('parses a JSON body and verifies the Firebase token (a bad token is 401, not 500)', async () => {
    const res = await fetch(`${base}/api/auth/identity/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer not-a-token' },
      body: JSON.stringify({ newAccount: { role: 'tester', displayName: 'Bundle' } }),
    });
    expect(res.status).toBe(401);
  });

  it('unknown API paths are a JSON 404', async () => {
    const res = await fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'NOT_FOUND' });
  });
});
