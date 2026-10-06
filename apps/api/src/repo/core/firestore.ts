import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { runTxCtx, type TxCtx } from '../../firestore/tx';
import { sha256 } from '../../util';
import type { UserRow } from '../../views/core';
import type { AuditRow, CoreRepo } from './types';

/**
 * Core repository on Firestore (plan §2.1, r2 §R2 rows 1, 9, 10).
 *  users/{id}                          the UserRow shape, unchanged
 *  userEmails/{sha256(email)}          UNIQUE(users.email): exact email, as SQLite compares it
 *  identities/{firebase:uid}           PK(provider, subject)
 *  userProviders/{userId}:firebase     UNIQUE(identities.user_id, provider)
 *  sessions/{tokenHash}                local-mode sessions (hosted auth is Firebase ID tokens)
 *  audit/{id}                          append-only; ordered by created_at, then commit time
 */
const emailKey = (email: string) => sha256(email);
export const IDEMPOTENCY_TTL_MS = 24 * 3600 * 1000;
/**
 * How long a pending reservation blocks retries (pqa-qa early r1 P2-E): longer than any request can
 * run (function maxDuration plus margin), after which a request that died without completing or
 * abandoning is taken over instead of answering 409 for 24 h.
 */
export const IDEMPOTENCY_PENDING_MS = 5 * 60 * 1000;

/**
 * Inside an item's transaction: the job lease must still carry this fence (pqa-qa early r1 P2-G).
 * Reading it IN the transaction means a takeover between the check and the commit aborts the stale
 * holder's write (the commit conflicts, the rerun sees the new fence and throws).
 */
export async function fenceInTx(t: TxCtx, fs: Firestore, job: string, fence: number, nowMs: number): Promise<void> {
  const d = (await t.get(fs.collection('jobLeases').doc(job))).data();
  if (!d || d.fence !== fence || (d.expiresAt as number) <= nowMs) throw new Error(`job lease fence ${fence} for ${job} is no longer valid`);
}

/** In-transaction user read for other domains' composite operations. */
export async function userInTx(t: TxCtx, fs: Firestore, id: string): Promise<UserRow | null> {
  const snap = await t.get(fs.collection('users').doc(id));
  return snap.exists ? (snap.data() as UserRow) : null;
}

/** In-transaction audit append for other domains' composite operations. */
export function auditInTx(t: TxCtx, fs: Firestore, row: AuditRow): void {
  t.create(fs.collection('audit').doc(row.id), { ...row, writtenAt: FieldValue.serverTimestamp() });
}

export function firestoreCoreRepo(fs: Firestore): CoreRepo {
  const users = fs.collection('users');
  const emails = fs.collection('userEmails');
  const identities = fs.collection('identities');
  const providers = fs.collection('userProviders');
  const sessions = fs.collection('sessions');
  const audit = fs.collection('audit');
  const identityRef = (uid: string) => identities.doc(`firebase:${uid}`);
  const get = async (id: string) => {
    const s = await users.doc(id).get();
    return s.exists ? (s.data() as UserRow) : null;
  };

  return {
    async ping() {
      await users.limit(1).get();
    },
    userById: get,
    async activeUserByEmail(email) {
      const g = await emails.doc(emailKey(email)).get();
      if (!g.exists) return null;
      const u = await get(g.data()!.userId as string);
      return u && u.email === email && u.status !== 'deleted' ? u : null;
    },
    async emailTaken(email) {
      return (await emails.doc(emailKey(email)).get()).exists;
    },
    async createUser(row) {
      return runTxCtx(fs, async (t) => {
        const g = await t.claimGuard(emails.doc(emailKey(row.email)), { userId: row.id });
        if (!g.created) return 'email_taken' as const;
        t.create(users.doc(row.id), { ...row });
        return 'created' as const;
      });
    },
    async createUserWithIdentity(row, uid, createdAt) {
      return runTxCtx(fs, async (t) => {
        const idSnap = await t.get(identityRef(uid));
        if (idSnap.exists) return 'identity_taken' as const;
        const g = await t.claimGuard(emails.doc(emailKey(row.email)), { userId: row.id });
        if (!g.created) return 'email_taken' as const;
        await t.claimGuard(providers.doc(`${row.id}:firebase`), { uid });
        t.create(users.doc(row.id), { ...row });
        t.create(identityRef(uid), { provider: 'firebase', subject: uid, user_id: row.id, has_recovery: 1, valid_after_ms: 0, created_at: createdAt });
        return 'created' as const;
      });
    },
    async linkMigratedIdentity(email, uid, audit) {
      return runTxCtx(fs, async (t) => {
        if ((await t.get(identityRef(uid))).exists) return null;
        const g = await t.get(emails.doc(emailKey(email)));
        if (!g.exists) return null;
        const userId = g.data()!.userId as string;
        const [uSnap, pSnap] = await t.getAll(users.doc(userId), providers.doc(`${userId}:firebase`));
        const u = uSnap?.exists ? (uSnap.data() as UserRow & { migrated_link?: string }) : null;
        if (!u || u.email !== email || u.status === 'deleted' || u.migrated_link !== 'verified_email' || pSnap?.exists) return null;
        t.create(providers.doc(`${userId}:firebase`), { uid });
        t.create(identityRef(uid), { provider: 'firebase', subject: uid, user_id: userId, has_recovery: 1, valid_after_ms: 0, created_at: audit.createdAt });
        t.update(users.doc(userId), { migrated_link: FieldValue.delete() });
        auditInTx(t, fs, {
          id: audit.id,
          actor_id: userId,
          action: 'user.identity_linked',
          target_type: 'user',
          target_id: userId,
          reason: '[migrated account claimed by its verified email]',
          created_at: audit.createdAt,
        });
        const { migrated_link: _marker, ...user } = u;
        return user as UserRow;
      });
    },
    async setDevice(userId, deviceJson) {
      await users.doc(userId).update({ device_json: deviceJson });
    },
    async setStatus(userId, status) {
      await users.doc(userId).update({ status });
    },
    async setStatusAudited(userId, status, row) {
      await runTxCtx(fs, async (t) => {
        // Retried with the same (deterministic) audit id: already applied, nothing to do.
        if ((await t.get(audit.doc(row.id))).exists) return;
        t.update(users.doc(userId), { status });
        auditInTx(t, fs, row);
      });
    },
    async setRole(userId, role) {
      await users.doc(userId).update({ role });
    },
    async identityMapped(uid) {
      return (await identityRef(uid).get()).exists;
    },
    async userByIdentity(uid) {
      const i = await identityRef(uid).get();
      if (!i.exists) return null;
      const u = await get(i.data()!.user_id as string);
      if (!u || u.status === 'deleted') return null;
      return { user: u, validAfterMs: (i.data()!.valid_after_ms as number) ?? 0 };
    },
    async markRecovery(uid) {
      const ref = identityRef(uid);
      const i = await ref.get();
      if (i.exists && i.data()!.has_recovery === 0) await ref.update({ has_recovery: 1 });
    },
    async hasRecoverableIdentity(userId) {
      const q = await identities.where('user_id', '==', userId).where('provider', '==', 'firebase').where('has_recovery', '==', 1).limit(1).get();
      return !q.empty;
    },
    async identitySubjects(userId) {
      const q = await identities.where('user_id', '==', userId).where('provider', '==', 'firebase').get();
      return q.docs.map((d) => d.data().subject as string);
    },
    async revokeIdentities(userId, nowMs) {
      const q = await identities.where('user_id', '==', userId).where('provider', '==', 'firebase').get();
      const b = fs.batch();
      for (const d of q.docs) b.update(d.ref, { valid_after_ms: nowMs });
      await b.commit();
    },
    async createSession(tokenHash, userId, createdAt, expiresAtMs) {
      await sessions.doc(tokenHash).create({ user_id: userId, created_at: createdAt, expires_at: expiresAtMs });
    },
    async userBySession(tokenHash, nowMs) {
      const s = await sessions.doc(tokenHash).get();
      if (!s.exists || (s.data()!.expires_at as number) <= nowMs) return null;
      const u = await get(s.data()!.user_id as string);
      return u && u.status !== 'deleted' ? u : null;
    },
    async deleteSession(tokenHash) {
      await sessions.doc(tokenHash).delete();
    },
    async appendAudit(row) {
      await audit.doc(row.id).create({ ...row, writtenAt: FieldValue.serverTimestamp() });
    },
    async listAudit() {
      // Bounded (pqa-qa early r1 P3): the newest 500 entries.
      const q = await audit.orderBy('created_at', 'desc').orderBy('writtenAt', 'desc').limit(500).get();
      return q.docs.map((d) => {
        const { writtenAt: _w, ...row } = d.data();
        return row as AuditRow;
      });
    },
    async redactAudit(targets) {
      for (const t of targets) {
        const q = await audit.where('target_type', '==', t.type).where('target_id', '==', t.id).get();
        for (let i = 0; i < q.docs.length; i += 400) {
          const b = fs.batch();
          for (const d of q.docs.slice(i, i + 400)) b.update(d.ref, { reason: '[redacted on account deletion]' });
          await b.commit();
        }
      }
    },
    async purgeUserCore(userId) {
      await runTxCtx(fs, async (t) => {
        const u = await t.get(users.doc(userId));
        if (!u.exists) return;
        const row = u.data() as UserRow;
        const placeholder = `deleted-${userId}@deleted.invalid`;
        const sess = await t.query(sessions.where('user_id', '==', userId));
        const ids = await t.query(identities.where('user_id', '==', userId));
        const oldGuard = await t.get(emails.doc(emailKey(row.email)));
        const newGuard = await t.get(emails.doc(emailKey(placeholder)));
        for (const d of sess.docs) t.delete(d.ref);
        for (const d of ids.docs) {
          t.delete(d.ref);
          t.delete(providers.doc(`${userId}:${d.data().provider as string}`));
        }
        // Frees the old email (as SQLite does by overwriting it) and reserves the placeholder.
        if (row.email !== placeholder && oldGuard.exists && oldGuard.data()!.userId === userId) t.delete(oldGuard.ref);
        if (!newGuard.exists) t.create(newGuard.ref, { userId, createdAt: FieldValue.serverTimestamp() });
        t.update(users.doc(userId), { email: placeholder, password_hash: null, display_name: 'Deleted user', device_json: null, status: 'deleted' });
      });
    },
    async beginIdempotency(scope, fingerprint, nowMs) {
      const ref = fs.collection('idempotency').doc(sha256(scope));
      return runTxCtx(fs, async (t) => {
        const snap = await t.get(ref);
        const d = snap.data();
        if (snap.exists && (d!.expiresAt as number) > nowMs) {
          if (d!.fingerprint !== fingerprint) return { kind: 'mismatch' as const };
          if (d!.state === 'done') return { kind: 'replay' as const, status: d!.status as number, body: JSON.parse(d!.body as string) as unknown };
          if ((d!.pendingUntil as number) > nowMs) return { kind: 'in_progress' as const };
          // The first request died without completing: take it over (its effects are guarded).
        }
        t.set(ref, {
          scope,
          fingerprint,
          state: 'pending',
          pendingUntil: nowMs + IDEMPOTENCY_PENDING_MS,
          expiresAt: nowMs + IDEMPOTENCY_TTL_MS,
          // A Timestamp copy so a Firestore TTL policy can remove expired records (numbers can't).
          expireAt: Timestamp.fromMillis(nowMs + IDEMPOTENCY_TTL_MS),
        });
        return { kind: 'new' as const };
      });
    },
    async completeIdempotency(scope, status, body) {
      await fs.collection('idempotency').doc(sha256(scope)).update({ state: 'done', status, body: JSON.stringify(body ?? null) });
    },
    async abandonIdempotency(scope) {
      const ref = fs.collection('idempotency').doc(sha256(scope));
      await runTxCtx(fs, async (t) => {
        const snap = await t.get(ref);
        if (snap.exists && snap.data()!.state === 'pending') t.delete(ref);
      });
    },
    async rateLimitHit(bucket, windowMs, max, nowMs) {
      const window = Math.floor(nowMs / windowMs);
      const ref = fs.collection('rateLimits').doc(`${sha256(bucket)}:${window}`);
      return runTxCtx(fs, async (t) => {
        const snap = await t.get(ref);
        const count = snap.exists ? (snap.data()!.count as number) : 0;
        if (count >= max) return false;
        t.set(ref, { count: count + 1, expiresAt: (window + 1) * windowMs, expireAt: Timestamp.fromMillis((window + 1) * windowMs) });
        return true;
      });
    },
    async acquireLease(job, holder, ttlMs, nowMs) {
      const ref = fs.collection('jobLeases').doc(job);
      return runTxCtx(fs, async (t) => {
        const snap = await t.get(ref);
        const d = snap.data();
        if (snap.exists && (d!.expiresAt as number) > nowMs) return null;
        const fence = (snap.exists ? (d!.fence as number) : 0) + 1;
        t.set(ref, { holder, fence, expiresAt: nowMs + ttlMs });
        return fence;
      });
    },
    async leaseValid(job, fence, nowMs) {
      const d = (await fs.collection('jobLeases').doc(job).get()).data();
      return !!d && d.fence === fence && (d.expiresAt as number) > nowMs;
    },
    async releaseLease(job, fence) {
      const ref = fs.collection('jobLeases').doc(job);
      await runTxCtx(fs, async (t) => {
        const snap = await t.get(ref);
        if (snap.exists && snap.data()!.fence === fence) t.update(ref, { expiresAt: 0 });
      });
    },
  };
}
