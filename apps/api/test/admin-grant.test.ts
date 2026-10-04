import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLI_ACTOR_ID, GrantError, grantAdmin } from '../src/adminGrant';
import { makeApp, STUDY, type TestApp } from './helpers';

// Ledger I7: production admin provisioning is a host CLI over a verified managed identity.
let t: TestApp;
beforeEach(async () => {
  t = await makeApp({ authMode: 'firebase' });
});
afterEach(async () => t.close());

const verified = (uid: string, extra = {}) => t.identity.idToken({ uid, email: `${uid}@example.test`, email_verified: true, provider: 'password', ...extra });
async function join(uid: string, role: 'tester' | 'builder' = 'tester') {
  const token = verified(uid);
  const r = await t.req('POST', '/auth/identity/session', token, { newAccount: { role, displayName: `User ${uid}` } });
  expect(r.status).toBe(200);
  return { token, id: r.body.user.id as string };
}
const grant = (email: string, reason = 'Platform operations lead') => grantAdmin(t.db, { email, reason, operator: 'ops', now: t.clock.now });

describe('admin:grant', () => {
  it('a fresh firebase-mode deployment gets its first admin; the role is effective at once and audited', async () => {
    const ops = await join('ops');
    expect((await t.req('GET', '/admin/audit', ops.token)).status).toBe(403);
    expect(grant('OPS@example.test')).toEqual({ userId: ops.id });
    expect((await t.req('GET', '/me', ops.token)).body.role).toBe('admin');
    const audit = (await t.req('GET', '/admin/audit', ops.token)).body.items;
    expect(audit[0]).toMatchObject({ actorId: CLI_ACTOR_ID, action: 'user.admin_granted', targetType: 'user', targetId: ops.id });
    expect(audit[0].reason).toMatch(/Platform operations lead.*host operator ops/);
  });

  it('refuses unknown, already-admin, suspended, wallet-only and busy accounts, changing nothing', async () => {
    expect(() => grant('nobody@example.test')).toThrow(/sign up/);
    await join('a');
    grant('a@example.test');
    expect(() => grant('a@example.test')).toThrow(/already an admin/);
    expect(() => grant('a@example.test', 'short')).toThrow(/reason/);

    const b = await join('b', 'builder');
    await t.req('POST', '/studies', b.token, STUDY);
    expect(() => grant('b@example.test')).toThrow(/dedicated account/);

    const c = await join('c');
    t.db.prepare(`INSERT INTO wallet_links (user_id, address, linked_at) VALUES (?, ?, ?)`).run(c.id, '11111111111111111111111111111112', new Date().toISOString());
    expect(() => grant('c@example.test')).toThrow(/wallet/);

    const d = await join('d');
    t.db.prepare(`UPDATE identities SET has_recovery = 0 WHERE user_id = ?`).run(d.id);
    expect(() => grant('d@example.test')).toThrow(/verified email or Google/);

    const e = await join('e');
    t.db.prepare(`UPDATE users SET status = 'suspended' WHERE id = ?`).run(e.id);
    expect(() => grant('e@example.test')).toThrow(/suspended/);

    expect(t.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`).get()).toEqual({ n: 1 });
    expect(t.db.prepare(`SELECT COUNT(*) AS n FROM audit WHERE action = 'user.admin_granted'`).get()).toEqual({ n: 1 });
    expect(() => grant('x')).toThrow(GrantError);
  });
});

describe('admin:grant CLI', () => {
  it('refuses local-auth deployments (use admin:create) and missing reasons', () => {
    const run = (args: string[], env: Record<string, string>) =>
      spawnSync('npx', ['tsx', 'scripts/grant-admin.ts', ...args], { cwd: pathJoin(import.meta.dirname, '..'), encoding: 'utf8', env: { PATH: process.env.PATH!, HOME: process.env.HOME!, ...env } });
    const dir = mkdtempSync(pathJoin(tmpdir(), 'pqa-grant-'));
    const local = run(['ops@example.test', '--reason', 'Platform operations lead'], { POCKETQA_DATA_DIR: dir });
    expect([local.status, local.stderr]).toEqual([1, expect.stringMatching(/admin:create/)]);
    const noReason = run(['ops@example.test'], { POCKETQA_DATA_DIR: dir });
    expect([noReason.status, noReason.stderr]).toEqual([2, expect.stringMatching(/usage/)]);
  }, 60_000);
});
