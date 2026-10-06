import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildHostedApp, hostedDeps, type HostedDeps } from '../../src/hosted/app';
import { FakeS3 } from '../fakeS3';
import { clearEmulator, PROJECT } from './fs';

// The hosted app (src/hosted/app.ts) end to end on the emulators: Firestore repositories, Firebase
// sign-in (Auth emulator), R2 (a loopback stand-in), cron jobs under leases, and idempotency.
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
const CRON = 'c'.repeat(40);
const s3 = new FakeS3();
let deps: HostedDeps;
let app: FastifyInstance;

async function rest(path: string, body: unknown) {
  const res = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/${path}?key=emulator-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as Record<string, string>;
}
const call = async (method: string, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) => {
  const r = await app.inject({ method: method as 'GET', url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, ...(payload ? { payload: payload as object } : {}) });
  return { status: r.statusCode, body: r.body ? r.json() : null };
};

/** A verified Firebase user with a Pocket QA account of `role`; returns a fresh ID token. */
async function signUp(role: 'builder' | 'tester') {
  const email = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  const up = await rest('accounts:signUp', { email, password: 'correct horse battery staple', returnSecureToken: true });
  const { getAuth } = await import('firebase-admin/auth');
  const { getApps } = await import('firebase-admin/app');
  await getAuth(getApps().find((a) => a.name === `pocketqa-${PROJECT}`)!).updateUser(up.localId!, { emailVerified: true });
  const token = (await rest('accounts:signInWithPassword', { email, password: 'correct horse battery staple', returnSecureToken: true })).idToken!;
  const created = await call('POST', '/auth/identity/session', token, { newAccount: { role, displayName: role } });
  expect(created.status).toBe(200);
  return token;
}

beforeAll(async () => {
  await s3.start();
  deps = hostedDeps({
    POCKETQA_DATA_BACKEND: 'firestore',
    POCKETQA_AUTH_MODE: 'firebase',
    POCKETQA_FIREBASE_PROJECT_ID: PROJECT,
    POCKETQA_FIREBASE_WEB_API_KEY: 'emulator-key', // check-secrets: allow (placeholder public Firebase web config in tests)
    POCKETQA_FIREBASE_AUTH_EMULATOR_HOST: AUTH,
    FIREBASE_AUTH_EMULATOR_HOST: AUTH,
    FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
    POCKETQA_STORAGE: 'r2',
    POCKETQA_R2_ACCOUNT_ID: '0'.repeat(32),
    POCKETQA_R2_BUCKET: 'pqa-test',
    POCKETQA_R2_ACCESS_KEY_ID: 'test-key',
    POCKETQA_R2_SECRET_ACCESS_KEY: 'test-secret', // check-secrets: allow (placeholder test value)
    POCKETQA_R2_ENDPOINT: `http://127.0.0.1:${s3.port}`,
    POCKETQA_R2_ALLOW_DELETE: '1',
    POCKETQA_SETTLEMENT: 'simulated',
    CRON_SECRET: CRON,
  });
  app = await buildHostedApp(deps);
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await s3.stop();
});
beforeEach(() => clearEmulator());

describe('hosted app on the emulators', () => {
  it('has no SQLite and no local media', () => {
    expect(deps.db).toBeNull();
    expect(deps.mediaDir).toBeNull();
    expect(deps.repo.kind).toBe('firestore');
  });

  it('jobs: 404 without the cron secret, with a wrong one, or for an unknown job; runs with it', async () => {
    expect((await call('GET', '/jobs/settle')).status).toBe(404);
    expect((await call('GET', '/jobs/settle', 'x'.repeat(40))).status).toBe(404);
    expect((await call('GET', '/jobs/nope', CRON)).status).toBe(404);
    const settle = await call('GET', '/jobs/settle', CRON);
    expect(settle).toMatchObject({ status: 200, body: { job: 'settle', ran: true, complete: true } });
    expect((await call('GET', '/jobs/sweep', CRON)).body).toMatchObject({ job: 'sweep', ran: true });
  });

  it('jobs: a run finding the lease held does nothing; after release the next run works', async () => {
    const fence = await deps.repo.core.acquireLease('sweep', 'someone-else', 60_000, Date.now());
    expect(fence).not.toBeNull();
    expect((await call('GET', '/jobs/sweep', CRON)).body).toMatchObject({ ran: false });
    await deps.repo.core.releaseLease('sweep', fence!);
    expect((await call('GET', '/jobs/sweep', CRON)).body).toMatchObject({ ran: true });
  });

  it('a top-up whose completion write failed is retried with its key: one credit (R12 D, P2-H)', async () => {
    const token = await signUp('builder');
    const core = deps.repo.core;
    const real = core.completeIdempotency.bind(core);
    let armed = true;
    core.completeIdempotency = async (...args) => {
      if (armed) {
        armed = false;
        throw new Error('simulated crash after commit');
      }
      return real(...args);
    };
    try {
      const key = { 'idempotency-key': 'hosted-topup-0001' };
      expect((await call('POST', '/me/credits/test-topup', token, { amount: 100 }, key)).status).toBe(500);
      expect((await call('POST', '/me/credits/test-topup', token, { amount: 100 }, key)).status).toBe(200);
      expect((await call('POST', '/me/credits/test-topup', token, { amount: 100 }, key)).status).toBe(200); // replay
    } finally {
      core.completeIdempotency = real;
    }
    const credits = await call('GET', '/me/credits', token);
    expect(credits.body.entries.filter((e: { kind: string }) => e.kind === 'topup' || e.kind === 'test_topup')).toHaveLength(1);
  });

  it('an export with a key stores no idempotency record (credential/size exemption)', async () => {
    const token = await signUp('tester');
    expect((await call('POST', '/me/export', token, undefined, { 'idempotency-key': 'hosted-export-0001' })).status).toBe(200);
    const { emulatorFirestore } = await import('./fs');
    expect((await emulatorFirestore().collection('idempotency').get()).size).toBe(0);
  });
});
