import type { Deps } from '../context';
import type { DeletionPurpose } from '../repo/evidence/types';
import type { Repos } from '../repo';
import { iso, newId, sha256 } from '../util';

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
export type { DeletionPurpose };

/** What sweep and deletion need. */
export type StorageDeps = Pick<Deps, 'store' | 'now'> & { repo: Pick<Repos, 'evidence' | 'core'> };

const evidenceRepo = (deps: StorageDeps) => deps.repo.evidence;

/**
 * Key shapes the app itself creates (plan r2 §R4): `evidence/{id}` and `quarantine/{id}` in R2;
 * the local media directory also has bare-id keys from the multipart route. Anything else
 * (e.g. the `retained-local-submissions/` archive) is never deleted or queued, even if registered.
 */
const APP_KEY = /^(evidence|quarantine)\/[A-Za-z0-9_-]{8,64}$/;
const LOCAL_KEY = /^[A-Za-z0-9_-]{8,64}$/;
export function deletableKey(deps: Pick<StorageDeps, 'store'>, key: string): boolean {
  return APP_KEY.test(key) || (deps.store.kind === 'local' && LOCAL_KEY.test(key));
}

/** Actor of refusals not driven by a request (the sweep), as the escrow worker uses. */
const SYSTEM_ACTOR = 'system';

/**
 * The deletion gate (A5, plan r2 §R4): an app key shape AND registered by this app. A refusal is
 * audited by key hash (never the raw key) and nothing is deleted or queued.
 */
async function mayDelete(deps: StorageDeps, key: string, purpose: DeletionPurpose, actorId: string): Promise<boolean> {
  const shape = deletableKey(deps, key);
  if (shape && (await evidenceRepo(deps).ownsObject(key))) return true;
  await deps.repo.core.appendAudit({
    id: newId(),
    actor_id: actorId,
    action: 'storage.delete_refused',
    target_type: 'storage_object',
    target_id: sha256(key),
    reason: `${purpose}: ${shape ? 'not registered' : 'outside evidence/|quarantine/'}`,
    created_at: iso(deps.now()),
  });
  return false;
}

/**
 * Delete an object now, or queue it in the retried outbox if the provider fails. A key the app
 * didn't create is never deleted or queued (returns false), whatever the caller passes.
 */
export async function deleteOrQueue(deps: StorageDeps, key: string, purpose: DeletionPurpose, actorId = SYSTEM_ACTOR): Promise<boolean> {
  const repo = evidenceRepo(deps);
  if (!(await mayDelete(deps, key, purpose, actorId))) return false;
  try {
    await deps.store.delete(key);
    return true;
  } catch {
    await repo.enqueueDeletion(key, purpose, deps.now());
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
export async function sweepStorage(deps: StorageDeps) {
  const repo = evidenceRepo(deps);
  const now = deps.now();
  await repo.expireDuePending(now);
  // A completion normally takes seconds; one still 'completing' an hour past expiry crashed.
  for (const s of await repo.stuckCompleting(now - 3600_000)) {
    if (s.evidence_id && !(await repo.evidenceExists(s.evidence_id))) await deleteOrQueue(deps, `evidence/${s.evidence_id}`, 'failed_upload');
    await repo.expireIntentNow(s.id);
  }
  for (const c of await repo.closedUnswept(now, 500)) {
    if (c.status !== 'completed') await deleteOrQueue(deps, c.object_key, 'failed_upload');
    // A successful upload's quarantine copy is kept, unless its evidence is already gone: only
    // account deletion removes evidence, and a re-PUT with the then still-valid URL could have
    // recreated the copy after that deletion ran.
    else if (!(await repo.intentEvidenceExists(c.id))) await deleteOrQueue(deps, c.object_key, 'account_deletion');
    // Marked either way (`quarantine_swept` = handled), so kept copies don't fill every pass.
    await repo.markQuarantineSwept(c.id);
  }
  for (const d of await repo.dueDeletions(now, 500)) {
    // Defence in depth: the outbox only ever holds registered app keys, but never act on one that isn't.
    if (!(await mayDelete(deps, d.object_key, d.purpose, SYSTEM_ACTOR))) {
      await repo.deletionDone(d.object_key);
      continue;
    }
    try {
      await deps.store.delete(d.object_key);
      await repo.deletionDone(d.object_key);
    } catch {
      const wait = Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** d.attempts);
      await repo.deletionRetry(d.object_key, now + wait);
    }
  }
}
