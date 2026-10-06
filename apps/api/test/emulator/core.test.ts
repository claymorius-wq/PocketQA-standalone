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

describe('idempotency (plan R3/R10)', () => {
  it('20 concurrent first requests: one runs, the rest are in progress; then replay; a different body is a mismatch', async () => {
    const out = await Promise.all(Array.from({ length: 20 }, () => repo.beginIdempotency('u1:decide:k1', 'fp-a', 1000)));
    expect(out.filter((o) => o.kind === 'new')).toHaveLength(1);
    expect(out.filter((o) => o.kind === 'in_progress')).toHaveLength(19);
    await repo.completeIdempotency('u1:decide:k1', 200, { ok: true });
    expect(await repo.beginIdempotency('u1:decide:k1', 'fp-a', 2000)).toEqual({ kind: 'replay', status: 200, body: { ok: true } });
    expect(await repo.beginIdempotency('u1:decide:k1', 'fp-b', 2000)).toEqual({ kind: 'mismatch' });
    expect((await repo.beginIdempotency('u2:decide:k1', 'fp-a', 2000)).kind).toBe('new'); // scoped per user
  });

  it('an abandoned request can be retried, and records expire after 24 h', async () => {
    expect((await repo.beginIdempotency('s', 'fp', 0)).kind).toBe('new');
    await repo.abandonIdempotency('s');
    expect((await repo.beginIdempotency('s', 'fp', 1)).kind).toBe('new');
    await repo.completeIdempotency('s', 201, { id: 'x' });
    expect((await repo.beginIdempotency('s', 'fp', 24 * 3600 * 1000)).kind).toBe('replay');
    expect((await repo.beginIdempotency('s', 'fp', 24 * 3600 * 1000 + 2)).kind).toBe('new');
  });
});

describe('shared rate limit (plan R6)', () => {
  it('two app instances share one window: 30 hits, max 10 -> exactly 10 allowed', async () => {
    const { initializeApp } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const second = firestoreCoreRepo(getFirestore(initializeApp({ projectId: 'demo-pocketqa' }, `second-instance-${Date.now()}`)));
    const hits = await Promise.all(Array.from({ length: 30 }, (_, i) => (i % 2 ? repo : second).rateLimitHit('login:ip-1', 60_000, 10, 5_000)));
    expect(hits.filter(Boolean)).toHaveLength(10);
    expect(await repo.rateLimitHit('login:ip-1', 60_000, 10, 65_000)).toBe(true); // next window
  });
});

describe('job leases with fencing (plan §5)', () => {
  it('20 concurrent acquirers: one fence; after expiry a new holder fences out the stale one', async () => {
    const fences = await Promise.all(Array.from({ length: 20 }, (_, i) => repo.acquireLease('sweep', `h${i}`, 1000, 0)));
    const won = fences.filter((f) => f !== null);
    expect(won).toEqual([1]);
    expect(await repo.leaseValid('sweep', 1, 500)).toBe(true);
    expect(await repo.acquireLease('sweep', 'late', 1000, 1500)).toBe(2);
    expect(await repo.leaseValid('sweep', 1, 1600)).toBe(false); // the stale holder is refused
    await repo.releaseLease('sweep', 1); // a stale release changes nothing
    expect(await repo.leaseValid('sweep', 2, 1600)).toBe(true);
    await repo.releaseLease('sweep', 2);
    expect(await repo.acquireLease('sweep', 'next', 1000, 1700)).toBe(3);
  });
});

describe('admin moderation is atomic with its audit (plan T6)', () => {
  it('status and audit row commit together', async () => {
    await repo.createUser(user('m', 'm@example.test'));
    await repo.setStatusAudited('m', 'suspended', { id: 'au1', actor_id: 'admin', action: 'user.suspend', target_type: 'user', target_id: 'm', reason: 'spam', created_at: '2026-10-06T00:00:00.000Z' });
    expect((await repo.userById('m'))?.status).toBe('suspended');
    expect((await repo.listAudit()).map((r) => r.id)).toEqual(['au1']);
    // A missing user fails the whole transaction: no orphan audit row.
    await expect(repo.setStatusAudited('nobody', 'suspended', { id: 'au2', actor_id: 'admin', action: 'user.suspend', target_type: 'user', target_id: 'nobody', reason: 'x', created_at: '2026-10-06T00:00:01.000Z' })).rejects.toThrow();
    expect((await repo.listAudit()).map((r) => r.id)).toEqual(['au1']);
  });
});

describe('pqa-qa early review r1', () => {
  it('P2-E: a pending reservation whose request died is taken over after its short lease, not stuck for 24 h', async () => {
    expect((await repo.beginIdempotency('u:topUp:k', 'fp', 0)).kind).toBe('new');
    // The first request crashed (no complete, no abandon): within the pending lease it is in progress...
    expect((await repo.beginIdempotency('u:topUp:k', 'fp', 60_000)).kind).toBe('in_progress');
    // ...after it, a retry may run (its effects are guarded or deterministic: P2-F).
    expect((await repo.beginIdempotency('u:topUp:k', 'fp', 10 * 60_000)).kind).toBe('new');
  });

  it('P2-G: a stale holder that checks its fence inside its item transaction after a takeover writes nothing', async () => {
    const { runTxCtx } = await import('../../src/firestore/tx');
    const { fenceInTx } = await import('../../src/repo/core/firestore');
    expect(await repo.acquireLease('settle', 'a', 1000, 0)).toBe(1);
    expect(await repo.acquireLease('settle', 'b', 1000, 1500)).toBe(2); // the lease expired, b took over
    const stale = runTxCtx(fs, async (t) => {
      await fenceInTx(t, fs, 'settle', 1, 1600);
      t.set(fs.collection('settlements').doc('x'), { by: 'stale' });
    });
    await expect(stale).rejects.toThrow(/fence/);
    expect((await fs.collection('settlements').doc('x').get()).exists).toBe(false);
  });

  it('P2-G: concurrent stale item transactions and a takeover serialise: no item commits after the takeover', async () => {
    const { runTxCtx } = await import('../../src/firestore/tx');
    const { fenceInTx } = await import('../../src/repo/core/firestore');
    expect(await repo.acquireLease('sweep2', 'a', 1000, 0)).toBe(1);
    const items = Array.from({ length: 10 }, (_, i) =>
      runTxCtx(fs, async (t) => {
        await fenceInTx(t, fs, 'sweep2', 1, 900);
        t.set(fs.collection('items').doc(`i${i}`), { fence: 1 });
      }).then(
        () => 'committed',
        () => 'refused',
      ),
    );
    // The takeover (the clock has moved past the lease) counts, inside its own transaction, the items
    // committed before it. Serialisability, not timestamps (the emulator's serverTimestamp is only
    // ms-granular and not commit-ordered): an item committing after the takeover would have read
    // fence 2 and been refused, so the count it saw must equal the final count.
    const takeover = runTxCtx(fs, async (t) => {
      const ref = fs.collection('jobLeases').doc('sweep2');
      const d = (await t.get(ref)).data()!;
      const before = (await t.query(fs.collection('items'))).size;
      t.set(ref, { holder: 'b', fence: (d.fence as number) + 1, expiresAt: 999_999 });
      return before;
    });
    const outcomes = await Promise.all(items);
    const seenByTakeover = await takeover;
    const committed = await fs.collection('items').get();
    expect(committed.size).toBe(outcomes.filter((o) => o === 'committed').length);
    expect(committed.size).toBe(seenByTakeover);
  });
});

describe('P2-F: a retried moderation with the same audit id applies once', () => {
  it('second call with the same audit id is a no-op', async () => {
    await repo.createUser(user('q', 'q@example.test'));
    const row = { id: 'i-fixed-audit', actor_id: 'admin', action: 'user.suspend', target_type: 'user' as const, target_id: 'q', reason: 'spam', created_at: '2026-10-06T00:00:00.000Z' };
    await repo.setStatusAudited('q', 'suspended', row);
    await repo.setStatusAudited('q', 'suspended', row);
    expect((await repo.listAudit()).filter((r) => r.id === 'i-fixed-audit')).toHaveLength(1);
  });
});

describe('plan §7(a): linkMigratedIdentity', () => {
  it('20 concurrent claims by different uids: exactly one links, and the rest get null', async () => {
    await repo.createUser(user('m', 'm@example.test'));
    await fs.collection('users').doc('m').update({ migrated_link: 'verified_email' });
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => repo.linkMigratedIdentity('m@example.test', `uid-${i}`, { id: `link-audit-${i}`, createdAt: '2026-10-06T00:00:00.000Z' }).catch(() => 'conflict' as const)));
    const linked = results.filter((r) => r && r !== 'conflict');
    expect(linked).toHaveLength(1);
    expect(results.every((r) => r === null || r === 'conflict' || (r as { id: string }).id === 'm')).toBe(true);
    const ids = await fs.collection('identities').where('user_id', '==', 'm').get();
    expect(ids.size).toBe(1);
  });

  it('never links an admin, even one marked by mistake (pqa-qa r5 P3)', async () => {
    await repo.createUser(user('ad', 'ad@example.test', { role: 'admin' }));
    await fs.collection('users').doc('ad').update({ migrated_link: 'verified_email' });
    expect(await repo.linkMigratedIdentity('ad@example.test', 'uid-ad', { id: 'a-ad', createdAt: '2026-10-06T00:00:00.000Z' })).toBeNull();
  });

  it('matches the stored email exactly: a legacy mixed-case stored email is refused, never guessed (r5 P3)', async () => {
    await repo.createUser(user('mc', 'Mixed.Case@example.test'));
    await fs.collection('users').doc('mc').update({ migrated_link: 'verified_email' });
    // The handler passes the Email-schema (lowercased) address; the legacy row doesn't match it.
    expect(await repo.linkMigratedIdentity('mixed.case@example.test', 'uid-mc', { id: 'a-mc', createdAt: '2026-10-06T00:00:00.000Z' })).toBeNull();
  });

  it('never links an unmarked, deleted or already-linked account', async () => {
    await repo.createUser(user('n', 'n@example.test'));
    expect(await repo.linkMigratedIdentity('n@example.test', 'uid-n', { id: 'a-n', createdAt: '2026-10-06T00:00:00.000Z' })).toBeNull();
    await repo.createUser(user('d', 'd@example.test', { status: 'deleted' }));
    await fs.collection('users').doc('d').update({ migrated_link: 'verified_email' });
    expect(await repo.linkMigratedIdentity('d@example.test', 'uid-d', { id: 'a-d', createdAt: '2026-10-06T00:00:00.000Z' })).toBeNull();
    await repo.createUser(user('l', 'l@example.test'));
    await fs.collection('users').doc('l').update({ migrated_link: 'verified_email' });
    expect(await repo.linkMigratedIdentity('l@example.test', 'uid-l1', { id: 'a-l1', createdAt: '2026-10-06T00:00:00.000Z' })).not.toBeNull();
    expect(await repo.linkMigratedIdentity('l@example.test', 'uid-l2', { id: 'a-l2', createdAt: '2026-10-06T00:00:00.000Z' })).toBeNull();
  });
});

