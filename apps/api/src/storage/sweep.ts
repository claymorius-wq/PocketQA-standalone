import type { Deps } from '../context';

const MAX_BACKOFF_MS = 3600_000;

/**
 * Why Pocket QA deletes a stored object. These are the only reasons it ever does. Hamza's
 * scoped deletion policy (A5, 2026-10-04): its own objects in its own bucket, for failed-upload
 * cleanup and user-requested deletion; no time-based expiry of evidence, no lifecycle rules.
 * - failed_upload: an upload that was rejected, expired before completion (even if its bytes
 *   arrived; the app retries with a new intent), or crashed mid-promotion;
 * - account_deletion: a user's recordings, including the quarantine copy of each successful
 *   upload, when that user deletes their account.
 * The quarantine copy of a SUCCESSFUL upload is never deleted automatically: it is kept until
 * its owner's account deletion (parent review of A5: literal scope, 2026-10-04).
 */
export type DeletionPurpose = 'failed_upload' | 'account_deletion';

/** True only for keys this app registered when it created them (migration 4). */
export function ownsObject(db: Deps['db'], key: string): boolean {
  return db.prepare('SELECT 1 FROM storage_objects WHERE object_key = ?').get(key) !== undefined;
}

/** Records a key this app is about to create, before the write, so it is always deletable. */
export function registerObject(db: Deps['db'], key: string, now: number) {
  db.prepare('INSERT INTO storage_objects (object_key, created_at) VALUES (?, ?) ON CONFLICT (object_key) DO NOTHING').run(key, now);
}

/**
 * Delete an object now, or queue it in the retried outbox if the provider fails. A key the app
 * didn't create is never deleted or queued (returns false), whatever the caller passes.
 */
export async function deleteOrQueue(deps: Pick<Deps, 'db' | 'store' | 'now'>, key: string, purpose: DeletionPurpose): Promise<boolean> {
  if (!ownsObject(deps.db, key)) return false;
  try {
    await deps.store.delete(key);
    return true;
  } catch {
    const now = deps.now();
    deps.db
      .prepare('INSERT INTO storage_deletions (object_key, attempts, next_attempt_at, created_at, purpose) VALUES (?, 1, ?, ?, ?) ON CONFLICT (object_key) DO NOTHING')
      .run(key, now + 60_000, now, purpose);
    return false;
  }
}

/**
 * Durable storage housekeeping (run at startup and periodically):
 * 1. pending intents past expiry become `expired`;
 * 2. closed intents past expiry get their quarantine object removed once (a re-PUT with a
 *    still-valid URL could have recreated it), and a `completing` intent abandoned by a
 *    crash has its half-promoted final object removed if no evidence row exists;
 * 3. the deletion outbox is retried with exponential backoff.
 */
export async function sweepStorage(deps: Pick<Deps, 'db' | 'store' | 'now'>) {
  const db = deps.db;
  const now = deps.now();
  db.prepare(`UPDATE upload_intents SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?`).run(now);
  // A completion normally takes seconds; one still 'completing' an hour past expiry crashed.
  const stuck = db.prepare(`SELECT id, evidence_id FROM upload_intents WHERE status = 'completing' AND expires_at <= ?`).all(now - 3600_000) as { id: string; evidence_id: string | null }[];
  for (const s of stuck) {
    if (s.evidence_id && !db.prepare('SELECT 1 FROM evidence WHERE id = ?').get(s.evidence_id)) await deleteOrQueue(deps, `evidence/${s.evidence_id}`, 'failed_upload');
    db.prepare(`UPDATE upload_intents SET status = 'expired' WHERE id = ?`).run(s.id);
  }
  const closed = db
    .prepare(`SELECT id, object_key, status FROM upload_intents WHERE status IN ('completed','rejected','expired') AND expires_at <= ? AND quarantine_swept = 0 LIMIT 500`)
    .all(now) as { id: string; object_key: string; status: string }[];
  for (const c of closed) {
    if (c.status !== 'completed') await deleteOrQueue(deps, c.object_key, 'failed_upload');
    // A successful upload's quarantine copy is kept, unless its evidence is already gone: only
    // account deletion removes evidence, and a re-PUT with the then still-valid URL could have
    // recreated the copy after that deletion ran.
    else if (!db.prepare(`SELECT 1 FROM evidence WHERE id = (SELECT evidence_id FROM upload_intents WHERE id = ?)`).get(c.id)) await deleteOrQueue(deps, c.object_key, 'account_deletion');
    // Marked either way (`quarantine_swept` = handled), so kept copies don't fill every pass.
    db.prepare('UPDATE upload_intents SET quarantine_swept = 1 WHERE id = ?').run(c.id);
  }
  const due = db.prepare('SELECT object_key, attempts FROM storage_deletions WHERE next_attempt_at <= ? LIMIT 500').all(now) as { object_key: string; attempts: number }[];
  for (const d of due) {
    // Defence in depth: the outbox only ever holds registered keys, but never act on one that isn't.
    if (!ownsObject(db, d.object_key)) {
      db.prepare('DELETE FROM storage_deletions WHERE object_key = ?').run(d.object_key);
      continue;
    }
    try {
      await deps.store.delete(d.object_key);
      db.prepare('DELETE FROM storage_deletions WHERE object_key = ?').run(d.object_key);
    } catch {
      const wait = Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** d.attempts);
      db.prepare('UPDATE storage_deletions SET attempts = attempts + 1, next_attempt_at = ? WHERE object_key = ?').run(now + wait, d.object_key);
    }
  }
}
