import { FieldValue, type Firestore } from 'firebase-admin/firestore';
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
    async setDevice(userId, deviceJson) {
      await users.doc(userId).update({ device_json: deviceJson });
    },
    async setStatus(userId, status) {
      await users.doc(userId).update({ status });
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
      const q = await audit.orderBy('created_at', 'desc').orderBy('writtenAt', 'desc').get();
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
  };
}
