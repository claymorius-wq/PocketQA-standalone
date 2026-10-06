import { beforeEach, describe, expect, it } from 'vitest';
import { firestoreCoreRepo } from '../../src/repo/core/firestore';
import type { UserRow } from '../../src/views/core';
import { clearEmulator, emulatorFirestore } from './fs';

// Core repository on Firestore (plan r2 §R2 rows 1, 9, 10; §7 identity; account deletion).
const fs = emulatorFirestore();
const repo = firestoreCoreRepo(fs);
beforeEach(clearEmulator);

const user = (id: string, email: string, extra: Partial<UserRow> = {}): UserRow => ({
  id,
  email,
  password_hash: null,
  display_name: `User ${id}`,
  role: 'tester',
  status: 'active',
  device_json: null,
  created_at: '2026-10-06T00:00:00.000Z',
  ...extra,
});

describe('users.email UNIQUE', () => {
  it('20 concurrent registrations with one email: exactly one account', async () => {
    const out = await Promise.all(Array.from({ length: 20 }, (_, i) => repo.createUser(user(`u${i}`, 'same@example.test'))));
    expect(out.filter((r) => r === 'created')).toHaveLength(1);
    expect((await fs.collection('users').get()).size).toBe(1);
    expect(await repo.emailTaken('same@example.test')).toBe(true);
    expect((await repo.activeUserByEmail('same@example.test'))?.email).toBe('same@example.test');
  });

  it('emails compare exactly, as SQLite does', async () => {
    expect(await repo.createUser(user('a', 'Mixed@example.test'))).toBe('created');
    expect(await repo.createUser(user('b', 'mixed@example.test'))).toBe('created');
  });
});

describe('identities (provider, subject) and one identity per user', () => {
  it('20 concurrent first sign-ins of one uid: one account and one identity', async () => {
    const out = await Promise.all(Array.from({ length: 20 }, (_, i) => repo.createUserWithIdentity(user(`n${i}`, `n${i}@example.test`), 'uid-1', '2026-10-06T00:00:00.000Z')));
    expect(out.filter((r) => r === 'created')).toHaveLength(1);
    expect((await fs.collection('users').get()).size).toBe(1);
    expect(await repo.identityMapped('uid-1')).toBe(true);
    const found = await repo.userByIdentity('uid-1');
    expect(found?.validAfterMs).toBe(0);
  });

  it('an email already held refuses the managed account (never merged)', async () => {
    await repo.createUser(user('a', 'held@example.test'));
    expect(await repo.createUserWithIdentity(user('b', 'held@example.test'), 'uid-2', 'x')).toBe('email_taken');
    expect(await repo.identityMapped('uid-2')).toBe(false);
  });

  it('server-side revocation and recovery flags', async () => {
    await repo.createUserWithIdentity(user('r', 'r@example.test'), 'uid-r', 'x');
    await repo.revokeIdentities('r', 1234);
    expect((await repo.userByIdentity('uid-r'))?.validAfterMs).toBe(1234);
    expect(await repo.identitySubjects('r')).toEqual(['uid-r']);
    expect(await repo.hasRecoverableIdentity('r')).toBe(true);
  });
});

describe('sessions (local mode)', () => {
  it('a session is valid until it expires, and never for a deleted account', async () => {
    await repo.createUser(user('s', 's@example.test'));
    await repo.createSession('h1', 's', 'x', 2000);
    expect((await repo.userBySession('h1', 1999))?.id).toBe('s');
    expect(await repo.userBySession('h1', 2000)).toBeNull();
    await repo.purgeUserCore('s');
    await repo.createSession('h2', 's', 'x', 9999);
    expect(await repo.userBySession('h2', 1)).toBeNull();
  });
});

describe('audit', () => {
  it('is listed newest first and redacted by target', async () => {
    await repo.appendAudit({ id: 'a1', actor_id: 'x', action: 'user.suspend', target_type: 'user', target_id: 'u1', reason: 'spam', created_at: '2026-10-06T00:00:01.000Z' });
    await repo.appendAudit({ id: 'a2', actor_id: 'x', action: 'study.moderate', target_type: 'study', target_id: 's1', reason: 'ok', created_at: '2026-10-06T00:00:02.000Z' });
    expect((await repo.listAudit()).map((r) => r.id)).toEqual(['a2', 'a1']);
    await repo.redactAudit([{ type: 'user', id: 'u1' }]);
    const rows = await repo.listAudit();
    expect(rows.find((r) => r.id === 'a1')!.reason).toBe('[redacted on account deletion]');
    expect(rows.find((r) => r.id === 'a2')!.reason).toBe('ok');
  });
});

describe('account deletion (core part)', () => {
  it('anonymises the user, removes sessions and identities, frees the email, and is idempotent', async () => {
    await repo.createUserWithIdentity(user('d', 'gone@example.test', { device_json: '{"platform":"android"}' }), 'uid-d', 'x');
    await repo.createSession('hd', 'd', 'x', 9999);
    await repo.purgeUserCore('d');
    await repo.purgeUserCore('d');
    const row = await repo.userById('d');
    expect(row).toMatchObject({ email: 'deleted-d@deleted.invalid', password_hash: null, display_name: 'Deleted user', device_json: null, status: 'deleted' });
    expect(await repo.identityMapped('uid-d')).toBe(false);
    expect(await repo.userBySession('hd', 1)).toBeNull();
    expect(await repo.emailTaken('gone@example.test')).toBe(false);
    expect(await repo.createUser(user('d2', 'gone@example.test'))).toBe('created');
  });
});
