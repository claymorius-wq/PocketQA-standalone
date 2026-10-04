import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { openDb } from '../src/db';
import { firebaseIdentity } from '../src/identity/firebase';
import { localStore } from '../src/storage/local';
import { FakeRpc } from './helpers';

// Real Firebase Admin adapter against the local Auth emulator (no account, no network):
//   pnpm test:emulator   (firebase emulators:exec --only auth --project demo-pocketqa ...)
// Skipped in the normal suite, where no emulator runs. The emulator does not check token
// signatures, so forged-token cases are covered by the FakeIdentity tests instead.
const HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const PROJECT = 'demo-pocketqa';
const d = HOST ? describe : describe.skip;

async function rest(path: string, body: unknown) {
  const res = await fetch(`http://${HOST}/identitytoolkit.googleapis.com/v1/${path}?key=emulator-key`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, string>;
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return json;
}

d('Firebase Admin adapter against the Auth emulator', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pqa-emu-'));
  let app: Awaited<ReturnType<typeof buildApp>>;
  const config = loadConfig({
    POCKETQA_DATA_DIR: dir,
    POCKETQA_AUTH_MODE: 'firebase',
    POCKETQA_FIREBASE_PROJECT_ID: PROJECT,
    POCKETQA_FIREBASE_WEB_API_KEY: 'emulator-key', // check-secrets: allow (placeholder public Firebase web config in tests)
    POCKETQA_FIREBASE_AUTH_EMULATOR_HOST: HOST,
    FIREBASE_AUTH_EMULATOR_HOST: HOST,
  });
  const identity = firebaseIdentity(config.firebase!);
  const call = async (method: string, url: string, token?: string, payload?: unknown) => {
    const r = await app.inject({ method: method as 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload ? { payload: payload as object } : {}) });
    return { status: r.statusCode, body: r.json() };
  };

  beforeAll(async () => {
    mkdirSync(join(dir, 'media'));
    app = await buildApp({ db: openDb(join(dir, 'e.sqlite')), config, now: Date.now, rpc: new FakeRpc(), mediaDir: join(dir, 'media'), identity, store: localStore(join(dir, 'media')) });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('email sign-up needs verification, then maps to one account; logout revokes the ID token', async () => {
    const email = `emu-${Date.now()}@example.test`;
    const up = await rest('accounts:signUp', { email, password: 'correct horse battery staple', returnSecureToken: true });
    const first = await call('POST', '/auth/identity/session', up.idToken, { newAccount: { role: 'tester', displayName: 'Emu' } });
    expect(first.status).toBe(403);
    expect(first.body.code).toBe('EMAIL_UNVERIFIED');

    const { getAuth } = await import('firebase-admin/auth');
    const { getApps } = await import('firebase-admin/app');
    await getAuth(getApps().find((a) => a.name === `pocketqa-${PROJECT}`)!).updateUser(up.localId!, { emailVerified: true });
    const signedIn = await rest('accounts:signInWithPassword', { email, password: 'correct horse battery staple', returnSecureToken: true });
    const created = await call('POST', '/auth/identity/session', signedIn.idToken, { newAccount: { role: 'tester', displayName: 'Emu' } });
    expect(created.status).toBe(200);
    expect((await call('GET', '/me', signedIn.idToken)).body.id).toBe(created.body.user.id);

    expect((await call('POST', '/auth/logout', signedIn.idToken)).status).toBe(200);
    expect((await call('GET', '/me', signedIn.idToken)).status).toBe(401);
  });

  it('custom tokens are exchanged for ID tokens by the client and never accepted as bearers', async () => {
    const custom = await identity.createCustomToken(`wallet-user-${Date.now()}`);
    expect((await call('GET', '/me', custom)).status).toBe(401);
    const exchanged = await rest('accounts:signInWithCustomToken', { token: custom, returnSecureToken: true });
    const verified = await identity.verifyIdToken(exchanged.idToken!);
    expect(verified.signInProvider).toBe('custom');
    await identity.deleteUser(verified.uid);
    await identity.deleteUser(verified.uid); // already gone: not an error
  });
});
