import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ClientConfig } from '@pocket-qa/contracts';
import { sha256 } from '../src/util';
import { makeApp, type TestApp } from './helpers';

// ADR 0005 §1: managed identity. The provider proves who is calling; the API owns users,
// roles and statuses. Uses the deterministic FakeIdentity; the real Firebase Admin adapter
// runs against the Auth emulator in firebase-emulator.test.ts.
let t: TestApp;
beforeEach(async () => {
  t = await makeApp({ authMode: 'firebase' });
});
afterEach(async () => t.close());

const verified = (uid: string, email = `${uid}@example.test`, extra = {}) => t.identity.idToken({ uid, email, email_verified: true, provider: 'password', ...extra });

async function join(uid: string, role: 'tester' | 'builder' = 'tester') {
  const token = verified(uid);
  const r = await t.req('POST', '/auth/identity/session', token, { newAccount: { role, displayName: `User ${uid}` } });
  expect(r.status).toBe(200);
  return { token, user: r.body.user };
}

describe('public client config', () => {
  it('names the auth mode and public Firebase web config, never server credentials', async () => {
    const r = await t.req('GET', '/config');
    expect(r.status).toBe(200);
    const c = ClientConfig.parse(r.body);
    expect(c).toMatchObject({ authMode: 'firebase', storage: 'local', firebase: { projectId: 'demo-pocketqa', apiKey: 'demo-web-api-key' } }); // check-secrets: allow (placeholder public Firebase web config in tests)
    expect(JSON.stringify(r.body)).not.toMatch(/private|credential|secret|service/i);
  });
});

describe('identity session (first sign-in creates the account explicitly)', () => {
  it('an unmapped identity has no account until it asks for one with a self-serve role', async () => {
    const token = verified('uid-a');
    const none = await t.req('POST', '/auth/identity/session', token, {});
    expect(none.status).toBe(404);
    expect((await t.req('GET', '/me', token)).status).toBe(401);
    const created = await t.req('POST', '/auth/identity/session', token, { newAccount: { role: 'builder', displayName: 'Bea' } });
    expect(created.status).toBe(200);
    expect(created.body.user).toMatchObject({ role: 'builder', displayName: 'Bea', email: 'uid-a@example.test' });
    // Idempotent: the same identity never gets a second account.
    const again = await t.req('POST', '/auth/identity/session', token, { newAccount: { role: 'tester', displayName: 'Other' } });
    expect(again.body.user.id).toBe(created.body.user.id);
    expect(again.body.user.role).toBe('builder');
    expect((await t.req('GET', '/me', token)).body.id).toBe(created.body.user.id);
  });

  it('admin cannot be self-served, and token claims never grant a role', async () => {
    const token = verified('uid-b', 'b@example.test', { role: 'admin', admin: true });
    expect((await t.req('POST', '/auth/identity/session', token, { newAccount: { role: 'admin', displayName: 'X' } })).status).toBe(400);
    await t.req('POST', '/auth/identity/session', token, { newAccount: { role: 'tester', displayName: 'B' } });
    expect((await t.req('GET', '/me', token)).body.role).toBe('tester');
    expect((await t.req('GET', '/admin/audit', token)).status).toBe(403);
  });

  it('requires a verified email for every provider, and only accepts allow-listed providers (review r1 P3)', async () => {
    const github = t.identity.idToken({ uid: 'uid-gh', email: 'gh@example.test', email_verified: false, provider: 'github.com' });
    expect((await t.req('POST', '/auth/identity/session', github, { newAccount: { role: 'tester', displayName: 'G' } })).body.code).toBe('EMAIL_UNVERIFIED');
    const phone = t.identity.idToken({ uid: 'uid-ph', email: 'ph@example.test', email_verified: true, provider: 'phone' });
    const unsupported = await t.req('POST', '/auth/identity/session', phone, { newAccount: { role: 'tester', displayName: 'P' } });
    expect([unsupported.status, unsupported.body.code]).toEqual([403, 'PROVIDER_UNSUPPORTED']);
    const google = t.identity.idToken({ uid: 'uid-go', email: 'go@example.test', email_verified: true, provider: 'google.com' });
    expect((await t.req('POST', '/auth/identity/session', google, { newAccount: { role: 'tester', displayName: 'Go' } })).status).toBe(200);
  });

  it('an unverified identity hears "verify your email" before being offered an account', async () => {
    const token = t.identity.idToken({ uid: 'uid-u', email: 'u@example.test', email_verified: false, provider: 'password' });
    const r = await t.req('POST', '/auth/identity/session', token, {});
    expect([r.status, r.body.code]).toEqual([403, 'EMAIL_UNVERIFIED']);
  });

  it('requires a verified email for email/password identities', async () => {
    const token = t.identity.idToken({ uid: 'uid-c', email: 'c@example.test', email_verified: false, provider: 'password' });
    const r = await t.req('POST', '/auth/identity/session', token, { newAccount: { role: 'tester', displayName: 'C' } });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('EMAIL_UNVERIFIED');
  });

  it('never merges accounts by matching email', async () => {
    t.db.prepare(`INSERT INTO users (id, email, password_hash, display_name, role, status, created_at) VALUES ('legacy','taken@example.test','x','Legacy','builder','active','2026-10-01T00:00:00.000Z')`).run();
    const token = verified('uid-d', 'taken@example.test');
    const r = await t.req('POST', '/auth/identity/session', token, { newAccount: { role: 'tester', displayName: 'D' } });
    expect(r.status).toBe(409);
    expect((await t.req('GET', '/me', token)).status).toBe(401);
  });
});

describe('bearer verification in firebase mode', () => {
  it('rejects forged, expired, wrong-audience, custom and local-session tokens', async () => {
    const { token } = await join('uid-e');
    expect((await t.req('GET', '/me', token)).status).toBe(200);
    const [kind, body] = token.split('.');
    expect((await t.req('GET', '/me', `${kind}.${body}.forged`)).status).toBe(401);
    expect((await t.req('GET', '/me', t.identity.idToken({ uid: 'uid-e', email_verified: true, aud: 'other-project' }))).status).toBe(401);
    expect((await t.req('GET', '/me', await t.identity.createCustomToken('uid-e'))).status).toBe(401);
    t.clock.now += 3601 * 1000;
    expect((await t.req('GET', '/me', token)).status).toBe(401);
    // Local password sessions are not an alternative way in on a managed-identity deployment.
    const local = 'a'.repeat(43);
    t.db.prepare(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) SELECT ?, id, 'x', ? FROM users LIMIT 1`).run(sha256(local), t.clock.now + 1e9);
    expect((await t.req('GET', '/me', local)).status).toBe(401);
    expect((await t.req('POST', '/auth/register', undefined, { email: 'p@example.test', password: 'correct horse battery staple', displayName: 'P', role: 'tester' })).status).toBe(409);
    expect((await t.req('POST', '/auth/login', undefined, { email: 'p@example.test', password: 'correct horse battery staple' })).status).toBe(409);
  });

  it('logout revokes provider sessions so the old ID token stops working', async () => {
    const { token, user } = await join('uid-f');
    expect((await t.req('POST', '/auth/logout', token)).status).toBe(200);
    expect(t.identity.revoked).toContain('uid-f');
    expect((await t.req('GET', '/me', token)).status).toBe(401);
    t.clock.now += 1000;
    const fresh = verified('uid-f');
    expect((await t.req('GET', '/me', fresh)).body.id).toBe(user.id);
  });

  it('a token refreshed after logout from a pre-logout sign-in is still refused (review r1 P3)', async () => {
    const { token } = await join('uid-r');
    t.clock.now += 5000;
    await t.req('POST', '/auth/logout', token);
    t.clock.now += 60_000;
    const refreshed = t.identity.refresh(token); // new iat, original auth_time
    expect((await t.req('GET', '/me', refreshed)).status).toBe(401);
  });

  it('server-side revocation alone refuses a refreshed pre-logout token (review r2 P3)', async () => {
    const { token } = await join('uid-s');
    t.identity.revokeSessions = async () => {}; // provider revocation does nothing
    t.clock.now += 5000;
    await t.req('POST', '/auth/logout', token);
    t.clock.now += 60_000;
    expect((await t.req('GET', '/me', t.identity.refresh(token))).status).toBe(401);
  });

  it('logout still clears playback tokens and succeeds when the provider fails (review r1 P3)', async () => {
    const { token, user } = await join('uid-p');
    t.db.pragma('foreign_keys = OFF');
    t.db.prepare(`INSERT INTO playback_tokens (token_hash, evidence_id, user_id, expires_at) VALUES ('pt-1', 'ev-x', ?, ?)`).run(user.id, t.clock.now + 60_000);
    t.db.pragma('foreign_keys = ON');
    const orig = t.identity.revokeSessions.bind(t.identity);
    t.identity.revokeSessions = async () => {
      throw new Error('provider down');
    };
    expect((await t.req('POST', '/auth/logout', token)).status).toBe(200);
    t.identity.revokeSessions = orig;
    expect(t.db.prepare(`SELECT COUNT(*) AS n FROM playback_tokens WHERE user_id = ?`).get(user.id)).toEqual({ n: 0 });
    expect((await t.req('GET', '/me', token)).status).toBe(401); // server-side revocation still applied
  });

  it('suspension is enforced from the server record', async () => {
    const { token, user } = await join('uid-g');
    t.db.prepare(`UPDATE users SET status = 'suspended' WHERE id = ?`).run(user.id);
    expect((await t.req('GET', '/studies/eligible', token)).status).toBe(403);
    expect((await t.req('GET', '/me', token)).status).toBe(200);
  });

  it('two users cannot read each other’s data', async () => {
    const a = await join('uid-h', 'builder');
    const b = await join('uid-i', 'builder');
    const study = await t.req('POST', '/studies', a.token, {
      title: 'Private study',
      objective: 'Check the onboarding flow end to end.',
      tasks: [{ instruction: 'Open the app' }],
      deviceCriteria: { platforms: ['web'], minAndroidApi: null, languages: [] },
      rewardCredits: 10,
      slots: 1,
      consentText: 'I agree to record my screen only while doing these tasks.',
    });
    expect(study.status).toBe(200);
    expect((await t.req('GET', `/studies/${study.body.id}`, b.token)).status).toBe(404);
  });

  it('account deletion removes the identity mapping and the provider user', async () => {
    const { token } = await join('uid-j');
    expect((await t.req('DELETE', '/me', token, { confirm: 'DELETE MY ACCOUNT' })).status).toBe(200);
    expect(t.identity.deleted).toContain('uid-j');
    t.clock.now += 1000;
    expect((await t.req('GET', '/me', verified('uid-j'))).status).toBe(401);
  });
});

describe('local mode', () => {
  it('has no managed identity: provider tokens are refused and the session route is off', async () => {
    const local = await makeApp();
    const token = local.identity.idToken({ uid: 'x', email: 'x@example.test', email_verified: true });
    expect((await local.req('GET', '/me', token)).status).toBe(401);
    expect((await local.req('POST', '/auth/identity/session', token, { newAccount: { role: 'tester', displayName: 'X' } })).status).toBe(401);
    const cfg = ClientConfig.parse((await local.req('GET', '/config')).body);
    expect(cfg).toMatchObject({ authMode: 'local', firebase: null });
    await local.close();
  });
});
