import type { TestApp } from './helpers';

// Backend-agnostic reads and seeds for the storage/evidence suites (plan §10 dual-backend
// regression): the same assertions on SQLite (t.db) and on Firestore (t.fs), seeding through the
// repositories rather than raw SQL.

const COLLECTION = { evidence: 'evidence', storage_deletions: 'storageDeletions', playback_tokens: 'playbackTokens' } as const;

/** Row/document count of one of the evidence domain's stores. */
export async function count(t: TestApp, table: keyof typeof COLLECTION): Promise<number> {
  if (t.fs) return (await t.fs.collection(COLLECTION[table]).get()).size;
  return (t.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/** Upload intents in a status. */
export async function intentsIn(t: TestApp, status: string): Promise<number> {
  if (t.fs) return (await t.fs.collection('uploadIntents').where('status', '==', status).get()).size;
  return (t.db.prepare('SELECT COUNT(*) AS n FROM upload_intents WHERE status = ?').get(status) as { n: number }).n;
}

/** A registered object (app-created) whose deletion is queued and due now. */
export async function queueDue(t: TestApp, key: string, purpose: 'failed_upload' | 'account_deletion' = 'account_deletion') {
  await t.deps.repo.evidence.registerObject(key, 0);
  // enqueueDeletion schedules the first retry a minute after `now`: due at the app's clock.
  await t.deps.repo.evidence.enqueueDeletion(key, purpose, t.clock.now - 60_000);
}

/** Refused deletions in the audit log, oldest first. */
export async function refusals(t: TestApp) {
  const rows = await t.deps.repo.core.listAudit();
  return rows
    .filter((a) => a.action === 'storage.delete_refused')
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
    .map(({ actor_id, target_type, target_id, reason }) => ({ actor_id, target_type, target_id, reason }));
}

/** The deletion outbox as (object_key, purpose) rows, in no particular order. */
export async function outboxRows(t: TestApp): Promise<{ object_key: string; purpose: string }[]> {
  if (t.fs) return (await t.fs.collection('storageDeletions').get()).docs.map((d) => ({ object_key: d.data().object_key as string, purpose: d.data().purpose as string }));
  return t.db.prepare('SELECT object_key, purpose FROM storage_deletions').all() as { object_key: string; purpose: string }[];
}
