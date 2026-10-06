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
  app = await buildHostedApp(deps, { cronLeaseWaitMs: 2_000 });
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

  it('jobs: a run finding the lease held past the wait does nothing; after release the next run works', async () => {
    const fence = await deps.repo.core.acquireLease('sweep', 'someone-else', 60_000, Date.now());
    expect(fence).not.toBeNull();
    expect((await call('GET', '/jobs/sweep', CRON)).body).toMatchObject({ ran: false });
    await deps.repo.core.releaseLease('sweep', fence!);
    expect((await call('GET', '/jobs/sweep', CRON)).body).toMatchObject({ ran: true });
  });

  it('jobs: a cron run waits out a short holder (an inline slice) instead of skipping the day (r4 P3)', async () => {
    const fence = await deps.repo.core.acquireLease('settle', 'inline-slice', 60_000, Date.now());
    setTimeout(() => void deps.repo.core.releaseLease('settle', fence!), 700);
    expect((await call('GET', '/jobs/settle', CRON)).body).toMatchObject({ job: 'settle', ran: true });
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

  it('plan §7(a): a migrated account is claimed once by its verified email; other accounts are never merged', async () => {
    const { emulatorFirestore } = await import('./fs');
    const fs = emulatorFirestore();
    const created = '2026-10-01T00:00:00.000Z';
    const migrated = { id: 'migrated-tester-1', email: `mig-${Date.now()}@example.test`, password_hash: null, display_name: 'Migrated', role: 'tester' as const, status: 'active' as const, device_json: null, created_at: created };
    const plain = { ...migrated, id: 'plain-tester-1', email: `plain-${Date.now()}@example.test` };
    expect(await deps.repo.core.createUser(migrated)).toBe('created');
    expect(await deps.repo.core.createUser(plain)).toBe('created');
    await fs.collection('users').doc(migrated.id).update({ migrated_link: 'verified_email' });

    const { getAuth } = await import('firebase-admin/auth');
    const { getApps } = await import('firebase-admin/app');
    const auth = getAuth(getApps().find((a) => a.name === `pocketqa-${PROJECT}`)!);
    const tokenFor = async (email: string, verify: boolean) => {
      const up = await rest('accounts:signUp', { email, password: 'correct horse battery staple', returnSecureToken: true });
      if (!verify) return up.idToken!;
      await auth.updateUser(up.localId!, { emailVerified: true });
      return (await rest('accounts:signInWithPassword', { email, password: 'correct horse battery staple', returnSecureToken: true })).idToken!;
    };

    // The plain account: the old rule stands (409, no merge), even with a verified email.
    const plainToken = await tokenFor(plain.email, true);
    expect((await call('POST', '/auth/identity/session', plainToken, {})).status).toBe(404);
    expect((await call('POST', '/auth/identity/session', plainToken, { newAccount: { role: 'tester', displayName: 'X' } })).body.code).toBe('CONFLICT_STATE');

    // The migrated account: claimed with no newAccount; the marker is cleared; audited once.
    const token = await tokenFor(migrated.email, true);
    const linked = await call('POST', '/auth/identity/session', token, {});
    expect(linked.status).toBe(200);
    expect(linked.body.user.id).toBe(migrated.id);
    expect((await call('GET', '/me', token)).body.id).toBe(migrated.id);
    expect((await fs.collection('users').doc(migrated.id).get()).data()!.migrated_link).toBeUndefined();
    const audit = await fs.collection('audit').where('target_id', '==', migrated.id).get();
    expect(audit.docs.filter((d) => d.data().action === 'user.identity_linked')).toHaveLength(1);
  });

  it('plan §7(a): a mixed-case sign-in email claims the lowercase stored account (r5 P3)', async () => {
    const { emulatorFirestore } = await import('./fs');
    const fs = emulatorFirestore();
    const lower = `mig3-${Date.now()}@example.test`;
    const migrated = { id: 'migrated-tester-3', email: lower, password_hash: null, display_name: 'Migrated', role: 'tester' as const, status: 'active' as const, device_json: null, created_at: '2026-10-01T00:00:00.000Z' };
    await deps.repo.core.createUser(migrated);
    await fs.collection('users').doc(migrated.id).update({ migrated_link: 'verified_email' });
    const mixed = lower.replace('mig3', 'MiG3').replace('example', 'Example');
    const up = await rest('accounts:signUp', { email: mixed, password: 'correct horse battery staple', returnSecureToken: true });
    const { getAuth } = await import('firebase-admin/auth');
    const { getApps } = await import('firebase-admin/app');
    await getAuth(getApps().find((a) => a.name === `pocketqa-${PROJECT}`)!).updateUser(up.localId!, { emailVerified: true });
    const token = (await rest('accounts:signInWithPassword', { email: mixed, password: 'correct horse battery staple', returnSecureToken: true })).idToken!;
    const res = await call('POST', '/auth/identity/session', token, {});
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(migrated.id);
  });

  it('plan §7(a): an unverified email never claims a migrated account', async () => {
    const { emulatorFirestore } = await import('./fs');
    const fs = emulatorFirestore();
    const migrated = { id: 'migrated-tester-2', email: `mig2-${Date.now()}@example.test`, password_hash: null, display_name: 'Migrated', role: 'tester' as const, status: 'active' as const, device_json: null, created_at: '2026-10-01T00:00:00.000Z' };
    await deps.repo.core.createUser(migrated);
    await fs.collection('users').doc(migrated.id).update({ migrated_link: 'verified_email' });
    const up = await rest('accounts:signUp', { email: migrated.email, password: 'correct horse battery staple', returnSecureToken: true });
    const res = await call('POST', '/auth/identity/session', up.idToken!, {});
    expect(res.body.code).toBe('EMAIL_UNVERIFIED');
    expect((await fs.collection('users').doc(migrated.id).get()).data()!.migrated_link).toBe('verified_email');
  });
});


// pqa-be2: the hosted evidence path end to end (plan §6): direct upload to private R2 through a
// presigned PUT, server-verified completion, presigned GET playback for the rightful parties only,
// and account deletion removing the objects with the inline sweep slice clearing the outbox.
describe('hosted evidence path (pqa-be2)', () => {
  it('consent → upload intent → PUT → complete → presigned playback; others 404; deleteMe clears storage', async () => {
    const { DEVICE, MP4, STUDY } = await import('../helpers');
    const { emulatorFirestore } = await import('./fs');
    const fs = emulatorFirestore();
    const builder = await signUp('builder');
    const tester = await signUp('tester');
    const other = await signUp('tester');

    // A study seeded through the API by its builder; the tester consents and starts.
    expect((await call('POST', '/me/credits/test-topup', builder, { amount: 1000 })).status).toBe(200);
    const study = await call('POST', '/studies', builder, STUDY);
    expect(study.status).toBe(200);
    expect((await call('POST', `/studies/${study.body.id}/publish`, builder)).status).toBe(200);
    expect((await call('PUT', '/me/device', tester, DEVICE)).status).toBe(200);
    const p = await call('POST', `/studies/${study.body.id}/consent`, tester, { consentVersion: 1, accepted: true });
    expect(p.status).toBe(200);
    expect((await call('POST', `/participations/${p.body.id}/start`, tester)).status).toBe(200);

    // Direct upload: the bytes go to storage, never through the API.
    const intent = await call('POST', `/participations/${p.body.id}/evidence/upload-intents`, tester, {
      kind: 'screen_recording',
      mimeType: 'video/mp4',
      sizeBytes: MP4.length,
      capturedOn: 'android',
      clientSegmentId: 'seg-hosted-1',
    });
    expect(intent.status).toBe(200);
    expect(intent.body.uploadUrl).toMatch(/\/pqa-test\/quarantine\/[A-Za-z0-9_-]+\?/);
    expect((await call('POST', `/participations/${p.body.id}/evidence/upload-intents`, other, { kind: 'screen_recording', mimeType: 'video/mp4', sizeBytes: MP4.length, capturedOn: 'android', clientSegmentId: 'x' })).status).toBe(404);
    expect((await fetch(intent.body.uploadUrl, { method: 'PUT', headers: intent.body.headers, body: MP4 })).status).toBe(200);
    expect((await call('POST', `/evidence/upload-intents/${intent.body.id}/complete`, other)).status).toBe(404);
    const done = await call('POST', `/evidence/upload-intents/${intent.body.id}/complete`, tester);
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ mimeType: 'video/mp4', sizeBytes: MP4.length });
    expect((await fs.collection('evidence').doc(done.body.id).get()).exists).toBe(true);

    // Playback: a presigned GET for the tester and the builder, the same bytes; others get 404.
    for (const who of [tester, builder]) {
      const grant = await call('POST', `/evidence/${done.body.id}/playback-token`, who);
      expect(grant.status).toBe(200);
      expect(grant.body.token).toBeUndefined();
      expect(new URL(grant.body.url).pathname).toBe(`/pqa-test/evidence/${done.body.id}`);
      expect(Buffer.compare(Buffer.from(await (await fetch(grant.body.url)).arrayBuffer()), MP4)).toBe(0);
    }
    const denied = await call('POST', `/evidence/${done.body.id}/playback-token`, other);
    expect(denied.status).toBe(404);
    expect(JSON.stringify(denied.body)).not.toContain('X-Amz');
    expect((await call('GET', `/participations/${p.body.id}/evidence`, other)).status).toBe(404);

    // Account deletion: the recording and its kept quarantine copy are deleted; the purge queued
    // both keys in the outbox (crash safety) and the inline sweep slice cleared those entries.
    const before = s3.keys().filter((k) => k.endsWith(done.body.id) || k.endsWith(intent.body.id));
    expect(before.sort()).toEqual([`pqa-test/evidence/${done.body.id}`, `pqa-test/quarantine/${intent.body.id}`].sort());
    expect((await call('DELETE', '/me', tester, { confirm: 'DELETE MY ACCOUNT' })).status).toBe(200);
    expect(s3.keys().filter((k) => k.endsWith(done.body.id) || k.endsWith(intent.body.id))).toEqual([]);
    expect((await fs.collection('evidence').doc(done.body.id).get()).exists).toBe(false);
    expect((await fs.collection('storageDeletions').get()).size).toBe(0);
    expect((await call('POST', `/evidence/${done.body.id}/playback-token`, builder)).status).toBe(404);
  });
});
