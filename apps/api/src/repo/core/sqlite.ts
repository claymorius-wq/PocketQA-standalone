import type { DB } from '../../db';
import type { UserRow } from '../../views/core';
import type { AuditRow, CoreRepo } from './types';

/**
 * Core repository on SQLite: today's SQL, moved out of app.ts and the handlers unchanged.
 * appendAudit, redactAudit and purgeUserCore run INSIDE callers' db.transaction (account deletion),
 * so they execute and throw synchronously (not `async`): a throw must roll the transaction back.
 */
export function sqliteCoreRepo(db: DB): CoreRepo {
  const mem = {
    idem: new Map<string, { fingerprint: string; state: 'pending' | 'done'; pendingUntil: number; expiresAt: number; status?: number; body?: unknown }>(),
    rate: new Map<string, number>(),
    lease: new Map<string, { holder: string; fence: number; expiresAt: number }>(),
  };
  const insertUser = db.prepare(
    'INSERT INTO users (id, email, password_hash, display_name, role, status, device_json, created_at) VALUES (@id,@email,@password_hash,@display_name,@role,@status,@device_json,@created_at)',
  );
  const isUniqueEmail = (e: unknown) => e instanceof Error && /UNIQUE constraint failed: users\.email/.test(e.message);
  return {
    async ping() {
      db.prepare('SELECT 1').get();
    },
    async userById(id) {
      return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined) ?? null;
    },
    async activeUserByEmail(email) {
      return (db.prepare(`SELECT * FROM users WHERE email = ? AND status != 'deleted'`).get(email) as UserRow | undefined) ?? null;
    },
    async emailTaken(email) {
      return !!db.prepare('SELECT 1 FROM users WHERE email = ?').get(email);
    },
    async createUser(row) {
      try {
        insertUser.run(row);
        return 'created';
      } catch (e) {
        if (isUniqueEmail(e)) return 'email_taken';
        throw e;
      }
    },
    async createUserWithIdentity(row, uid, createdAt) {
      if (db.prepare(`SELECT 1 FROM identities WHERE provider = 'firebase' AND subject = ?`).get(uid)) return 'identity_taken';
      try {
        db.transaction(() => {
          insertUser.run(row);
          db.prepare(`INSERT INTO identities (provider, subject, user_id, has_recovery, created_at) VALUES ('firebase', ?, ?, 1, ?)`).run(uid, row.id, createdAt);
        })();
        return 'created';
      } catch (e) {
        if (isUniqueEmail(e)) return 'email_taken';
        if (e instanceof Error && /UNIQUE constraint failed: identities/.test(e.message)) return 'identity_taken';
        throw e;
      }
    },
    async setDevice(userId, deviceJson) {
      db.prepare('UPDATE users SET device_json = ? WHERE id = ?').run(deviceJson, userId);
    },
    async setStatus(userId, status) {
      db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, userId);
    },
    async setStatusAudited(userId, status, row) {
      db.transaction(() => {
        db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, userId);
        db.prepare('INSERT INTO audit (id, actor_id, action, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?,?)').run(
          row.id,
          row.actor_id,
          row.action,
          row.target_type,
          row.target_id,
          row.reason,
          row.created_at,
        );
      })();
    },
    async setRole(userId, role) {
      db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
    },
    async identityMapped(uid) {
      return !!db.prepare(`SELECT 1 FROM identities WHERE provider = 'firebase' AND subject = ?`).get(uid);
    },
    async userByIdentity(uid) {
      const found = db
        .prepare(
          `SELECT u.*, i.valid_after_ms AS identity_valid_after_ms FROM identities i JOIN users u ON u.id = i.user_id
           WHERE i.provider = 'firebase' AND i.subject = ? AND u.status != 'deleted'`,
        )
        .get(uid) as (UserRow & { identity_valid_after_ms: number }) | undefined;
      if (!found) return null;
      const { identity_valid_after_ms: validAfterMs, ...user } = found;
      return { user, validAfterMs };
    },
    async markRecovery(uid) {
      db.prepare(`UPDATE identities SET has_recovery = 1 WHERE provider = 'firebase' AND subject = ? AND has_recovery = 0`).run(uid);
    },
    async hasRecoverableIdentity(userId) {
      return !!db.prepare(`SELECT 1 FROM identities WHERE provider = 'firebase' AND user_id = ? AND has_recovery = 1`).get(userId);
    },
    async identitySubjects(userId) {
      return (db.prepare(`SELECT subject FROM identities WHERE provider = 'firebase' AND user_id = ?`).all(userId) as { subject: string }[]).map((r) => r.subject);
    },
    async revokeIdentities(userId, nowMs) {
      db.prepare(`UPDATE identities SET valid_after_ms = ? WHERE provider = 'firebase' AND user_id = ?`).run(nowMs, userId);
    },
    async createSession(tokenHash, userId, createdAt, expiresAtMs) {
      db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)').run(tokenHash, userId, createdAt, expiresAtMs);
    },
    async userBySession(tokenHash, nowMs) {
      return (
        (db
          .prepare(
            `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ? AND s.expires_at > ? AND u.status != 'deleted'`,
          )
          .get(tokenHash, nowMs) as UserRow | undefined) ?? null
      );
    },
    async deleteSession(tokenHash) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    },
    appendAudit(row) {
      db.prepare('INSERT INTO audit (id, actor_id, action, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?,?)').run(
        row.id,
        row.actor_id,
        row.action,
        row.target_type,
        row.target_id,
        row.reason,
        row.created_at,
      );
      return Promise.resolve();
    },
    async listAudit() {
      return db.prepare('SELECT * FROM audit ORDER BY created_at DESC, rowid DESC LIMIT 500').all() as AuditRow[];
    },
    redactAudit(targets) {
      const stmt = db.prepare(`UPDATE audit SET reason = '[redacted on account deletion]' WHERE target_type = ? AND target_id = ?`);
      for (const t of targets) stmt.run(t.type, t.id);
      return Promise.resolve();
    },
    purgeUserCore(userId) {
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM identities WHERE user_id = ?').run(userId);
      db.prepare(
        `UPDATE users SET email = ?, password_hash = NULL, display_name = 'Deleted user', device_json = NULL, status = 'deleted' WHERE id = ?`,
      ).run(`deleted-${userId}@deleted.invalid`, userId);
      return Promise.resolve();
    },
    // The local server is one process: idempotency records, rate-limit windows and job leases live
    // in memory there (hosted Pocket QA keeps them in Firestore, shared by every instance).
    async beginIdempotency(scope, fingerprint, nowMs) {
      const d = mem.idem.get(scope);
      if (d && d.expiresAt > nowMs) {
        if (d.fingerprint !== fingerprint) return { kind: 'mismatch' as const };
        if (d.state === 'done') return { kind: 'replay' as const, status: d.status!, body: d.body };
        if (d.pendingUntil > nowMs) return { kind: 'in_progress' as const };
      }
      mem.idem.set(scope, { fingerprint, state: 'pending', pendingUntil: nowMs + 5 * 60 * 1000, expiresAt: nowMs + 24 * 3600 * 1000 });
      return { kind: 'new' as const };
    },
    async completeIdempotency(scope, status, body) {
      const d = mem.idem.get(scope);
      if (d) Object.assign(d, { state: 'done', status, body });
    },
    async abandonIdempotency(scope) {
      if (mem.idem.get(scope)?.state === 'pending') mem.idem.delete(scope);
    },
    async rateLimitHit(bucket, windowMs, max, nowMs) {
      const key = `${bucket}:${Math.floor(nowMs / windowMs)}`;
      const n = mem.rate.get(key) ?? 0;
      if (n >= max) return false;
      mem.rate.set(key, n + 1);
      if (mem.rate.size > 10_000) for (const k of mem.rate.keys()) if (!k.endsWith(`:${Math.floor(nowMs / windowMs)}`)) mem.rate.delete(k);
      return true;
    },
    async acquireLease(job, holder, ttlMs, nowMs) {
      const d = mem.lease.get(job);
      if (d && d.expiresAt > nowMs) return null;
      const fence = (d?.fence ?? 0) + 1;
      mem.lease.set(job, { holder, fence, expiresAt: nowMs + ttlMs });
      return fence;
    },
    async leaseValid(job, fence, nowMs) {
      const d = mem.lease.get(job);
      return !!d && d.fence === fence && d.expiresAt > nowMs;
    },
    async releaseLease(job, fence) {
      const d = mem.lease.get(job);
      if (d && d.fence === fence) d.expiresAt = 0;
    },
  };
}
