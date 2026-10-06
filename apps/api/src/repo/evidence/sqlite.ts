import {
  MAX_EVIDENCE_BYTES_PER_PARTICIPATION,
  MAX_EVIDENCE_ITEMS_PER_PARTICIPATION,
} from '@pocket-qa/contracts';
import { canUploadEvidence } from '@pocket-qa/domain';
import type { DB } from '../../db';
import { fail, iso } from '../../util';
import { evidenceView, type EvidenceRow } from '../../views/evidence';
import type { DeletionPurpose, EvidenceRepo, IntentRow, NewEvidence, Usage } from './types';

/**
 * Today's SQL, moved out of handlers/evidence.ts and storage/sweep.ts unchanged.
 *
 * Every method does its work synchronously and returns an already-settled promise; failures are
 * thrown synchronously. So a caller can use an operation inside its own `db.transaction` (account
 * deletion, submission) and a throw still rolls that transaction back.
 */
export function sqliteEvidenceRepo(db: DB): EvidenceRepo {
  const done = <T>(v: T) => Promise.resolve(v);

  /** Evidence plus open (unexpired) intents: an intent reserves its declared bytes until it closes. */
  const usage = (participationId: string, now: number, exceptIntent = ''): Usage => {
    const ev = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes),0) AS bytes FROM evidence WHERE participation_id = ?').get(participationId) as Usage;
    const open = db
      .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(declared_size),0) AS bytes FROM upload_intents WHERE participation_id = ? AND status IN ('pending','completing') AND expires_at > ? AND id != ?`)
      .get(participationId, now, exceptIntent) as Usage;
    return { n: ev.n + open.n, bytes: ev.bytes + open.bytes };
  };

  const assertQuota = (u: Usage, addBytes: number) => {
    if (u.n + 1 > MAX_EVIDENCE_ITEMS_PER_PARTICIPATION) throw fail('CONFLICT_STATE', `At most ${MAX_EVIDENCE_ITEMS_PER_PARTICIPATION} evidence items per participation.`);
    if (u.bytes + addBytes > MAX_EVIDENCE_BYTES_PER_PARTICIPATION) throw fail('PAYLOAD_TOO_LARGE', 'Evidence storage limit for this participation reached.');
  };

  const segmentUploaded = (participationId: string, clientSegmentId: string) =>
    db.prepare('SELECT 1 FROM evidence WHERE participation_id = ? AND client_segment_id = ?').get(participationId, clientSegmentId) !== undefined;

  const participationStatus = (participationId: string) =>
    (db.prepare('SELECT status FROM participations WHERE id = ?').get(participationId) as { status: Parameters<typeof canUploadEvidence>[0] }).status;

  const insertEvidence = (e: NewEvidence, now: number) =>
    db
      .prepare(
        `INSERT INTO evidence (id, participation_id, kind, mime_type, size_bytes, duration_ms, task_id, captured_on, client_segment_id, storage_key, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(e.id, e.participation_id, e.kind, e.mime_type, e.size_bytes, e.duration_ms, e.task_id, e.captured_on, e.client_segment_id, e.storage_key, iso(now));

  const getEvidence = (id: string) => db.prepare('SELECT * FROM evidence WHERE id = ?').get(id) as EvidenceRow | undefined;

  const registerObject = (key: string, now: number) => {
    db.prepare('INSERT INTO storage_objects (object_key, created_at) VALUES (?, ?) ON CONFLICT (object_key) DO NOTHING').run(key, now);
  };

  return {
    getEvidence: (id) => done(getEvidence(id)),
    listEvidence: (participationId) => done(db.prepare('SELECT * FROM evidence WHERE participation_id = ? ORDER BY created_at').all(participationId) as EvidenceRow[]),
    evidenceUsage: (participationId) =>
      done(db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes),0) AS bytes FROM evidence WHERE participation_id = ?').get(participationId) as Usage),
    segmentUploaded: (participationId, clientSegmentId) => done(segmentUploaded(participationId, clientSegmentId)),
    evidenceInParticipation: (evidenceId, participationId) =>
      done(db.prepare('SELECT 1 FROM evidence WHERE id = ? AND participation_id = ?').get(evidenceId, participationId) !== undefined),
    openIntentCount: (participationId, now) =>
      done(
        (db.prepare(`SELECT COUNT(*) AS n FROM upload_intents WHERE participation_id = ? AND status IN ('pending','completing') AND expires_at > ?`).get(participationId, now) as { n: number }).n,
      ),

    addUploadedEvidence(e, now) {
      db.transaction(() => {
        // Re-check state inside the write transaction: submission may have raced the upload.
        if (!canUploadEvidence(participationStatus(e.participation_id))) throw fail('CONFLICT_STATE', 'The participation was submitted; evidence is frozen.');
        // Caps and duplicates again inside the write transaction: parallel uploads may have raced.
        const cur = db
          .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes),0) AS bytes FROM evidence WHERE participation_id = ?')
          .get(e.participation_id) as Usage;
        if (cur.n >= MAX_EVIDENCE_ITEMS_PER_PARTICIPATION) throw fail('CONFLICT_STATE', `At most ${MAX_EVIDENCE_ITEMS_PER_PARTICIPATION} evidence items per participation.`);
        if (cur.bytes + e.size_bytes > MAX_EVIDENCE_BYTES_PER_PARTICIPATION) throw fail('PAYLOAD_TOO_LARGE', 'Evidence storage limit for this participation reached.');
        if (segmentUploaded(e.participation_id, e.client_segment_id)) throw fail('CONFLICT_STATE', 'This segment was already uploaded.');
        insertEvidence(e, now);
      })();
      return done(getEvidence(e.id)!);
    },

    findOpenIntent: (participationId, clientSegmentId, now) =>
      done(
        db
          .prepare(`SELECT * FROM upload_intents WHERE participation_id = ? AND client_segment_id = ? AND status IN ('pending','completing') AND expires_at > ?`)
          .get(participationId, clientSegmentId, now) as IntentRow | undefined,
      ),

    openUploadIntent(intent, now) {
      db.transaction(() => {
        if (segmentUploaded(intent.participation_id, intent.client_segment_id)) throw fail('CONFLICT_STATE', 'This segment was already uploaded.');
        // Expired pending intents release their reservation (and their open-segment slot).
        db.prepare(`UPDATE upload_intents SET status = 'expired' WHERE participation_id = ? AND status = 'pending' AND expires_at <= ?`).run(intent.participation_id, now);
        assertQuota(usage(intent.participation_id, now), intent.declared_size);
        db.prepare(
          `INSERT INTO upload_intents (id, participation_id, tester_id, kind, mime_type, declared_size, duration_ms, task_id, captured_on, client_segment_id, object_key, status, expires_at, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)`,
        ).run(
          intent.id,
          intent.participation_id,
          intent.tester_id,
          intent.kind,
          intent.mime_type,
          intent.declared_size,
          intent.duration_ms,
          intent.task_id,
          intent.captured_on,
          intent.client_segment_id,
          intent.object_key,
          intent.expires_at,
          now,
        );
        // Registered before any URL that can create it is issued.
        registerObject(intent.object_key, now);
      })();
      return done(undefined);
    },

    getIntent: (id) => done(db.prepare('SELECT * FROM upload_intents WHERE id = ?').get(id) as IntentRow | undefined),
    expireIntent(id) {
      db.prepare(`UPDATE upload_intents SET status = 'expired' WHERE id = ? AND status = 'pending'`).run(id);
      return done(undefined);
    },
    // Atomic claim: concurrent completions get false.
    claimIntent: (id, evidenceId) => done(db.prepare(`UPDATE upload_intents SET status = 'completing', evidence_id = ? WHERE id = ? AND status = 'pending'`).run(evidenceId, id).changes === 1),
    releaseIntent(id, status) {
      db.prepare(`UPDATE upload_intents SET status = ? WHERE id = ? AND status = 'completing'`).run(status, id);
      return done(undefined);
    },

    finalizeIntent(intent, e, now) {
      db.transaction(() => {
        if (!canUploadEvidence(participationStatus(intent.participation_id))) throw fail('CONFLICT_STATE', 'The participation was submitted; evidence is frozen.');
        if (segmentUploaded(intent.participation_id, intent.client_segment_id)) throw fail('CONFLICT_STATE', 'This segment was already uploaded.');
        assertQuota(usage(intent.participation_id, now, intent.id), e.size_bytes);
        insertEvidence(e, now);
        // Only the claim holder completes; if the intent was closed meanwhile, roll back
        // (the caller's failure path deletes the promoted copy).
        if (db.prepare(`UPDATE upload_intents SET status = 'completed' WHERE id = ? AND status = 'completing'`).run(intent.id).changes !== 1) {
          throw fail('CONFLICT_STATE', 'This upload was closed while it was being completed.');
        }
      })();
      return done(getEvidence(e.id)!);
    },

    issuePlaybackToken(tokenHash, evidenceId, userId, expiresAt) {
      db.prepare('INSERT INTO playback_tokens (token_hash, evidence_id, user_id, expires_at) VALUES (?,?,?,?)').run(tokenHash, evidenceId, userId, expiresAt);
      return done(undefined);
    },
    getPlaybackToken: (tokenHash) =>
      done(db.prepare('SELECT * FROM playback_tokens WHERE token_hash = ?').get(tokenHash) as { evidence_id: string; user_id: string; expires_at: number } | undefined),
    revokePlaybackTokens(userId) {
      db.prepare('DELETE FROM playback_tokens WHERE user_id = ?').run(userId);
      return done(undefined);
    },

    registerObject(key, now) {
      registerObject(key, now);
      return done(undefined);
    },
    ownsObject: (key) => done(db.prepare('SELECT 1 FROM storage_objects WHERE object_key = ?').get(key) !== undefined),
    enqueueDeletion(key, purpose, now) {
      db.prepare('INSERT INTO storage_deletions (object_key, attempts, next_attempt_at, created_at, purpose) VALUES (?, 1, ?, ?, ?) ON CONFLICT (object_key) DO NOTHING').run(
        key,
        now + 60_000,
        now,
        purpose,
      );
      return done(undefined);
    },
    dueDeletions: (now, limit) =>
      done(
        db.prepare('SELECT object_key, attempts, purpose FROM storage_deletions WHERE next_attempt_at <= ? LIMIT ?').all(now, limit) as {
          object_key: string;
          attempts: number;
          purpose: DeletionPurpose;
        }[],
      ),
    deletionDone(key) {
      db.prepare('DELETE FROM storage_deletions WHERE object_key = ?').run(key);
      return done(undefined);
    },
    deletionRetry(key, nextAttemptAt) {
      db.prepare('UPDATE storage_deletions SET attempts = attempts + 1, next_attempt_at = ? WHERE object_key = ?').run(nextAttemptAt, key);
      return done(undefined);
    },

    expireDuePending(now) {
      db.prepare(`UPDATE upload_intents SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?`).run(now);
      return done(undefined);
    },
    stuckCompleting: (cutoff) =>
      done(db.prepare(`SELECT id, evidence_id FROM upload_intents WHERE status = 'completing' AND expires_at <= ?`).all(cutoff) as { id: string; evidence_id: string | null }[]),
    evidenceExists: (id) => done(db.prepare('SELECT 1 FROM evidence WHERE id = ?').get(id) !== undefined),
    expireIntentNow(id) {
      db.prepare(`UPDATE upload_intents SET status = 'expired' WHERE id = ?`).run(id);
      return done(undefined);
    },
    closedUnswept: (now, limit) =>
      done(
        db
          .prepare(`SELECT id, object_key, status FROM upload_intents WHERE status IN ('completed','rejected','expired') AND expires_at <= ? AND quarantine_swept = 0 LIMIT ?`)
          .all(now, limit) as { id: string; object_key: string; status: string }[],
      ),
    intentEvidenceExists: (intentId) => done(db.prepare(`SELECT 1 FROM evidence WHERE id = (SELECT evidence_id FROM upload_intents WHERE id = ?)`).get(intentId) !== undefined),
    markQuarantineSwept(id) {
      db.prepare('UPDATE upload_intents SET quarantine_swept = 1 WHERE id = ?').run(id);
      return done(undefined);
    },

    exportUser(userId) {
      // Same statements as handlers/account.ts exportMe: the user's participations, then their evidence.
      const partIds = (db.prepare('SELECT id FROM participations WHERE tester_id = ?').all(userId) as { id: string }[]).map((p) => p.id);
      const inList = partIds.length ? partIds.map(() => '?').join(',') : `''`;
      const rows = db.prepare(`SELECT * FROM evidence WHERE participation_id IN (${inList})`).all(...partIds) as EvidenceRow[];
      return done({ evidence: rows.map(evidenceView) });
    },

    purgeUser(userId) {
      // No transaction of its own: the caller (account deletion) wraps every domain's purge in one.
      const media: string[] = [];
      const evidenceIds: string[] = [];
      const quarantine: string[] = [];
      // Evidence the user recorded, and evidence inside studies the user owns.
      const ev = db
        .prepare(
          `SELECT e.id, e.storage_key FROM evidence e JOIN participations p ON p.id = e.participation_id
           JOIN studies s ON s.id = p.study_id WHERE p.tester_id = ? OR s.builder_id = ?`,
        )
        .all(userId, userId) as { id: string; storage_key: string }[];
      for (const e of ev) {
        media.push(e.storage_key);
        evidenceIds.push(e.id);
        // The retained quarantine copy of the same recording (direct uploads), if any.
        for (const r of db.prepare('SELECT object_key FROM upload_intents WHERE evidence_id = ?').all(e.id) as { object_key: string }[]) media.push(r.object_key);
        db.prepare('DELETE FROM evidence WHERE id = ?').run(e.id);
      }
      db.prepare('DELETE FROM playback_tokens WHERE user_id = ?').run(userId);
      // Open direct uploads: close them and remove their quarantine objects.
      for (const r of db.prepare(`SELECT object_key FROM upload_intents WHERE tester_id = ? AND status IN ('pending','completing')`).all(userId) as { object_key: string }[]) {
        quarantine.push(r.object_key);
      }
      db.prepare(`UPDATE upload_intents SET status = 'expired' WHERE tester_id = ? AND status IN ('pending','completing')`).run(userId);
      return done({ mediaKeys: [...media, ...quarantine], evidenceIds });
    },
  };
}
