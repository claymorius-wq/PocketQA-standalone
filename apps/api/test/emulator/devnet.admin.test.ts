import { beforeEach, describe, expect, it } from 'vitest';
import { DEVNET_ROOT } from '../../src/firestore/namespace';
import { grantDevnetAdmin } from '../../src/devnet/grantDevnetAdmin';
import { makeRepos } from '../../src/repo';
import type { UserRow } from '../../src/views/core';
import { clearEmulator, emulatorFirestore } from './fs';

// A synthetic admin for the devnet namespace (the dispute overturn needs one), granted on the HOST,
// only in pocketqaNamespaces/devnet, only for an allow-listed @example.test account that is
// verified and dedicated to administration. Never a production admin grant.
const raw = emulatorFirestore();
const devnet = makeRepos({ kind: 'firestore', fs: raw, namespace: 'devnet' });
const ADMIN = 'devnet-admin@example.test';
const allowed = [ADMIN, 'devnet-builder@example.test'];
const ISO = '2026-10-07T00:00:00.000Z';
const user = (id: string, email: string): UserRow => ({ id, email, password_hash: null, display_name: id, role: 'tester', status: 'active', device_json: null, created_at: ISO });
const grant = (email = ADMIN, repos = devnet) => grantDevnetAdmin(repos, { email, reason: 'Devnet dispute overturn operator', operator: 'qa-host', nowMs: Date.parse(ISO), allowedEmails: allowed });

beforeEach(async () => {
  await clearEmulator();
  await devnet.core.createUserWithIdentity(user('a1', ADMIN), 'uid-a1', ISO);
  await devnet.core.markRecovery('uid-a1');
});

describe('grantDevnetAdmin', () => {
  it('promotes the verified, dedicated synthetic account, audited, inside the devnet namespace only', async () => {
    expect(await grant()).toEqual({ userId: 'a1' });
    expect((await devnet.core.userById('a1'))!.role).toBe('admin');
    expect((await devnet.core.listAudit()).map((a) => [a.action, a.target_id, a.actor_id])).toEqual([['user.admin_granted', 'a1', 'host-cli']]);
    expect((await raw.listCollections()).map((c) => c.id)).toEqual(['pocketqaNamespaces']);
    expect((await raw.collection('pocketqaNamespaces').listDocuments()).map((d) => d.path)).toEqual([DEVNET_ROOT]);
  });

  it('refuses the production (root) collections outright', async () => {
    await expect(grant(ADMIN, makeRepos({ kind: 'firestore', fs: raw }))).rejects.toThrow(/devnet namespace/);
  });

  it.each([
    ['a real address', 'someone@gmail.com', /@example\.test/],
    ['a synthetic address off the allow-list', 'stranger@example.test', /POCKETQA_DEVNET_ALLOWED_EMAILS/],
  ])('refuses %s', async (_, email, why) => {
    await expect(grant(email)).rejects.toThrow(why);
  });

  it('refuses an unverified account and one with a linked wallet', async () => {
    await devnet.core.createUserWithIdentity(user('b1', 'devnet-builder@example.test'), 'uid-b1', ISO);
    // An identity without a recoverable (verified) sign-in.
    await raw.doc(`${DEVNET_ROOT}/identities/firebase:uid-b1`).update({ has_recovery: 0 });
    await expect(grant('devnet-builder@example.test')).rejects.toThrow(/verified/);
    await devnet.core.markRecovery('uid-b1');
    await raw.doc(`${DEVNET_ROOT}/walletLinks/b1`).set({ user_id: 'b1', address: 'w', linked_at: ISO });
    await expect(grant('devnet-builder@example.test')).rejects.toThrow(/wallet/);
    expect((await devnet.core.userById('b1'))!.role).toBe('tester');
  });
});
