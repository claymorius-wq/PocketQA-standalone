import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { openDb } from '../src/db';
import { firebaseIdentity } from '../src/identity/firebase';
import { localStore } from '../src/storage/local';
import { FakeRpc } from '../test/helpers';

/**
 * LIVE Firebase Auth checks against the dedicated project (ADR 0005 §1 provider gate).
 * Skipped unless POCKETQA_LIVE_FIREBASE=1 with POCKETQA_FIREBASE_* and an Admin credential
 * (GOOGLE_APPLICATION_CREDENTIALS = a key for the dedicated `pocketqa-api` service account, never a
 * personal login token) in the environment; nothing is committed or printed.
 * Creates test users only; deletes nothing (UIDs are reported for later cleanup).
 */
const LIVE = process.env.POCKETQA_LIVE_FIREBASE === '1';
const d = LIVE ? describe : describe.skip;
const createdUids: string[] = [];

d('live Firebase Auth: dedicated project', () => {
  const env = process.env as Record<string, string | undefined>;
  const dir = mkdtempSync(join(tmpdir(), 'pqa-live-fb-'));
  let app: Awaited<ReturnType<typeof buildApp>>;
  let webKey = '';
  const rest = async (path: string, body: unknown) => {
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/${path}?key=${webKey}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await r.json()) as Record<string, string> & { error?: { message: string } };
    if (!r.ok) throw new Error(`${path}: ${j.error?.message ?? r.status}`);
    return j;
  };
  const call = async (method: string, url: string, token?: string, payload?: unknown) => {
    const r = await app.inject({ method: method as 'GET', url, headers: token ? { authorization: `Bearer ${token}` } : {}, ...(payload ? { payload: payload as object } : {}) });
    return { status: r.statusCode, body: r.json() };
  };

  beforeAll(async () => {
    const config = loadConfig({ ...env, POCKETQA_DATA_DIR: dir, POCKETQA_AUTH_MODE: 'firebase' });
    if (config.firebase!.projectId !== 'pocketqa-optijara') throw new Error('refusing: not the dedicated project');
    webKey = config.firebase!.webApiKey;
    mkdirSync(join(dir, 'media'));
    app = await buildApp({ db: openDb(join(dir, 'l.sqlite')), config, now: Date.now, rpc: new FakeRpc(), mediaDir: join(dir, 'media'), identity: firebaseIdentity(config.firebase!), store: localStore(join(dir, 'media')) });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    rmSync(dir, { recursive: true, force: true });
    console.log(`LIVE_FIREBASE_CREATED_UIDS ${JSON.stringify(createdUids)}`);
  });

  it('real email sign-up → unverified refused → verified → account → logout revokes', async () => {
    const email = `pqa-live-${Date.now()}@example.test`;
    const phrase = `Live-${Date.now()}-correct-horse-battery`;
    const up = await rest('accounts:signUp', { email, password: phrase, returnSecureToken: true });
    createdUids.push(up.localId!);
    const unverified = await call('POST', '/auth/identity/session', up.idToken, {});
    expect([unverified.status, unverified.body.code]).toEqual([403, 'EMAIL_UNVERIFIED']);

    const { getAuth } = await import('firebase-admin/auth');
    const { getApps } = await import('firebase-admin/app');
    await getAuth(getApps().find((a) => a.name === 'pocketqa-pocketqa-optijara')!).updateUser(up.localId!, { emailVerified: true });
    const signedIn = await rest('accounts:signInWithPassword', { email, password: phrase, returnSecureToken: true });
    const created = await call('POST', '/auth/identity/session', signedIn.idToken, { newAccount: { role: 'tester', displayName: 'Live Check' } });
    expect(created.status).toBe(200);
    expect((await call('GET', '/me', signedIn.idToken)).body.id).toBe(created.body.user.id);

    await new Promise((r) => setTimeout(r, 1100)); // past the sign-in second (revocation granularity)
    expect((await call('POST', '/auth/logout', signedIn.idToken)).status).toBe(200);
    expect((await call('GET', '/me', signedIn.idToken)).status).toBe(401);
  });
});
