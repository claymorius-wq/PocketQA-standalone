import type { Deps } from '../context';

const MAX_BACKOFF_MS = 3600_000;

/** Delete an object now, or queue it in the retried outbox if the provider fails. */
export async function deleteOrQueue(deps: Pick<Deps, 'db' | 'store' | 'now'>, key: string): Promise<boolean> {
  try {
    await deps.store.delete(key);
    return true;
  } catch {
    const now = deps.now();
    deps.db
      .prepare('INSERT INTO storage_deletions (object_key, attempts, next_attempt_at, created_at) VALUES (?, 1, ?, ?) ON CONFLICT (object_key) DO NOTHING')
      .run(key, now + 60_000, now);
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
    if (s.evidence_id && !db.prepare('SELECT 1 FROM evidence WHERE id = ?').get(s.evidence_id)) await deleteOrQueue(deps, `evidence/${s.evidence_id}`);
    db.prepare(`UPDATE upload_intents SET status = 'expired' WHERE id = ?`).run(s.id);
  }
  const closed = db
    .prepare(`SELECT id, object_key FROM upload_intents WHERE status IN ('completed','rejected','expired') AND expires_at <= ? AND quarantine_swept = 0 LIMIT 500`)
    .all(now) as { id: string; object_key: string }[];
  for (const c of closed) {
    await deleteOrQueue(deps, c.object_key);
    db.prepare('UPDATE upload_intents SET quarantine_swept = 1 WHERE id = ?').run(c.id);
  }
  const due = db.prepare('SELECT object_key, attempts FROM storage_deletions WHERE next_attempt_at <= ? LIMIT 500').all(now) as { object_key: string; attempts: number }[];
  for (const d of due) {
    try {
      await deps.store.delete(d.object_key);
      db.prepare('DELETE FROM storage_deletions WHERE object_key = ?').run(d.object_key);
    } catch {
      const wait = Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** d.attempts);
      db.prepare('UPDATE storage_deletions SET attempts = attempts + 1, next_attempt_at = ? WHERE object_key = ?').run(now + wait, d.object_key);
    }
  }
}
