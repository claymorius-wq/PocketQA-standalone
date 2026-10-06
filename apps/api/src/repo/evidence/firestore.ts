import { MAX_EVIDENCE_BYTES_PER_PARTICIPATION, MAX_EVIDENCE_ITEMS_PER_PARTICIPATION } from '@pocket-qa/contracts';
import { canUploadEvidence } from '@pocket-qa/domain';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { runTxCtx, type TxCtx, type TxHooks } from '../../firestore/tx';
import { fail, iso, sha256 } from '../../util';
import { evidenceView, type EvidenceRow } from '../../views/evidence';
import type { DeletionPurpose, EvidenceRepo, IntentRow, NewEvidence, Usage } from './types';

/**
 * Evidence repository on Firestore (plan §2.1, §3 T4, §6; r2 §R2 rows 4–6, §R4, §R5).
 *
 *  evidence/{id}                         the EvidenceRow shape
 *  evidenceSegments/{pid}:{sha256(seg)}  UNIQUE(evidence.participation_id, client_segment_id)
 *  uploadIntents/{sha256(object_key)}    the intent row (+ created_at, quarantine_swept);
 *                                        object_key UNIQUE by construction (create() fails)
 *  openSegments/{pid}:{sha256(seg)}      upload_intents_one_open_segment: exists only while the
 *                                        intent is pending/completing; deleted in the same tx
 *                                        that closes it (completed, rejected, expired)
 *  evidenceUsage/{pid}                   quota counters (see Usage below)
 *  playbackTokens/{tokenHash}            local playback tokens (hosted playback is a presigned GET)
 *  storageObjects/{sha256(key)}          ownership registry (A5): written before the object, never removed
 *  storageDeletions/{sha256(key)}        retried deletion outbox
 *
 * Firestore has no aggregates inside a transaction, so SQLite's `usage()` SUMs become one
 * per-participation document read in every transaction that changes quota. It holds stored
 * evidence totals and a map of open intents to their reserved bytes and expiry; an entry past its
 * expiry stops counting at once (expiry enforced on read, §R5), whatever the sweep has done.
 * The map is bounded by MAX_EVIDENCE_ITEMS_PER_PARTICIPATION.
 *
 * Queries (for firestore.indexes.json and the R7 coverage test):
 *  evidence          participation_id ==, orderBy created_at
 *  evidence          participation_id in
 *  uploadIntents     status ==, expires_at <=
 *  uploadIntents     status in, quarantine_swept ==, expires_at <=
 *  uploadIntents     evidence_id in
 *  uploadIntents     tester_id ==, status in
 *  storageDeletions  next_attempt_at <=
 *  playbackTokens    user_id ==
 *  participations    tester_id ==          (studies domain collection)
 *  participations    study_id in           (studies domain collection)
 *  studies           builder_id ==         (studies domain collection)
 *
 * Client segment ids are free text (≤ 64 chars, may contain `/`), so guard ids hash them.
 * Participations (`participations/{id}`, ParticipationRow fields) and tasks
 * (`studies/{studyId}/tasks/{taskId}`) belong to the studies domain; they are only read here.
 */

type UsageDoc = { evidence_count: number; evidence_bytes: number; open: Record<string, { bytes: number; expires_at: number }> };
type IntentDoc = IntentRow & { created_at: number; quarantine_swept: boolean };

const OPEN = ['pending', 'completing'];
const IN_LIMIT = 30; // Firestore `in` filter maximum
/** Writes per purge transaction stay far below Firestore's per-commit limits (lead: ≤ 450). */
const PURGE_EVIDENCE_PER_TX = 60; // ≤ 7 writes each
const PURGE_INTENTS_PER_TX = 100; // ≤ 3 writes each, plus one usage doc per participation

const segmentId = (pid: string, seg: string) => `${pid}:${sha256(seg)}`;
const keyId = (key: string) => sha256(key);
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
const emptyUsage = (): UsageDoc => ({ evidence_count: 0, evidence_bytes: 0, open: {} });

/** Open intents still reserving quota at `now`, optionally excluding one. */
function liveOpen(u: UsageDoc, now: number, except = '') {
  return Object.entries(u.open).filter(([id, o]) => id !== except && o.expires_at > now);
}
function quotaUsage(u: UsageDoc, now: number, except = ''): Usage {
  const open = liveOpen(u, now, except);
  return { n: u.evidence_count + open.length, bytes: u.evidence_bytes + open.reduce((s, [, o]) => s + o.bytes, 0) };
}
function assertQuota(u: Usage, addBytes: number) {
  if (u.n + 1 > MAX_EVIDENCE_ITEMS_PER_PARTICIPATION) throw fail('CONFLICT_STATE', `At most ${MAX_EVIDENCE_ITEMS_PER_PARTICIPATION} evidence items per participation.`);
  if (u.bytes + addBytes > MAX_EVIDENCE_BYTES_PER_PARTICIPATION) throw fail('PAYLOAD_TOO_LARGE', 'Evidence storage limit for this participation reached.');
}

function refs(fs: Firestore) {
  return {
    evidence: (id: string) => fs.collection('evidence').doc(id),
    segment: (pid: string, seg: string) => fs.collection('evidenceSegments').doc(segmentId(pid, seg)),
    // An intent's object key is `quarantine/{id}` (handlers/evidence.ts), so its document is found from its id.
    intentByKey: (key: string) => fs.collection('uploadIntents').doc(keyId(key)),
    intent: (id: string) => fs.collection('uploadIntents').doc(keyId(`quarantine/${id}`)),
    openSegment: (pid: string, seg: string) => fs.collection('openSegments').doc(segmentId(pid, seg)),
    usage: (pid: string) => fs.collection('evidenceUsage').doc(pid),
    participation: (pid: string) => fs.collection('participations').doc(pid),
    playback: (hash: string) => fs.collection('playbackTokens').doc(hash),
    object: (key: string) => fs.collection('storageObjects').doc(keyId(key)),
    deletion: (key: string) => fs.collection('storageDeletions').doc(keyId(key)),
  };
}

async function readUsage(t: TxCtx, ref: DocumentReference): Promise<UsageDoc> {
  const s = await t.get(ref);
  return s.exists ? (s.data() as UsageDoc) : emptyUsage();
}

/**
 * For submission (studies domain, composed into its transaction): intents of the participation
 * still open at `now`. Reads `evidenceUsage/{pid}`, so a submission and an upload completion that
 * race conflict and one retries (each also reads the participation).
 */
export async function openIntentCountInTx(t: TxCtx, fs: Firestore, participationId: string, nowMs: number): Promise<number> {
  return liveOpen(await readUsage(t, refs(fs).usage(participationId)), nowMs).length;
}

/** For findings (studies domain, composed into its transaction): the evidence exists in this participation. */
export async function evidenceInParticipationInTx(t: TxCtx, fs: Firestore, evidenceId: string, participationId: string): Promise<boolean> {
  const s = await t.get(refs(fs).evidence(evidenceId));
  return s.exists && (s.data() as EvidenceRow).participation_id === participationId;
}

export function firestoreEvidenceRepo(fs: Firestore, hooks: TxHooks = {}): EvidenceRepo {
  const r = refs(fs);
  const tx = <T>(fn: (t: TxCtx) => Promise<T>) => runTxCtx(fs, fn, hooks);

  const getEvidence = async (id: string) => {
    const s = await r.evidence(id).get();
    return s.exists ? (s.data() as EvidenceRow) : undefined;
  };
  const getIntentDoc = async (id: string) => {
    const s = await r.intent(id).get();
    const d = s.exists ? (s.data() as IntentDoc) : undefined;
    return d && d.id === id ? d : undefined;
  };
  const participationStatus = async (t: TxCtx, pid: string) => {
    const s = await t.get(r.participation(pid));
    if (!s.exists) throw fail('NOT_FOUND', 'Participation not found.');
    return (s.data() as { status: Parameters<typeof canUploadEvidence>[0] }).status;
  };
  const newEvidenceDoc = (e: NewEvidence, now: number): EvidenceRow => ({ ...e, created_at: iso(now) });

  /**
   * Closes an open intent inside a transaction the caller has already read it in: sets `status`,
   * deletes its open-segment guard (only if the guard still points at it) and drops its reservation
   * from `usage` (mutated; the caller writes it once).
   */
  const closeIntentWrites = (t: TxCtx, intent: IntentDoc, status: 'completed' | 'rejected' | 'expired', guardIntentId: string | null, usage: UsageDoc) => {
    t.update(r.intent(intent.id), { status });
    if (guardIntentId === intent.id) t.delete(r.openSegment(intent.participation_id, intent.client_segment_id));
    delete usage.open[intent.id];
  };
  const readGuardIntentId = async (t: TxCtx, intent: IntentRow) => {
    const g = await t.get(r.openSegment(intent.participation_id, intent.client_segment_id));
    return g.exists ? ((g.data() as { intent_id: string }).intent_id ?? null) : null;
  };

  /** Moves one intent from an open status to `status` in its own transaction (no-op if `from` doesn't hold). */
  const transition = (id: string, from: IntentRow['status'][], status: 'rejected' | 'expired') =>
    tx(async (t) => {
      const s = await t.get(r.intent(id));
      if (!s.exists) return false;
      const intent = s.data() as IntentDoc;
      if (!from.includes(intent.status)) return false;
      const guard = await readGuardIntentId(t, intent);
      const usage = await readUsage(t, r.usage(intent.participation_id));
      closeIntentWrites(t, intent, status, guard, usage);
      t.set(r.usage(intent.participation_id), usage);
      return true;
    });

  const revokePlaybackTokens = async (userId: string) => {
    for (;;) {
      const q = await fs.collection('playbackTokens').where('user_id', '==', userId).limit(400).get();
      if (q.empty) return;
      const b = fs.batch();
      for (const d of q.docs) b.delete(d.ref);
      await b.commit();
    }
  };

  return {
    getEvidence,
    async listEvidence(participationId) {
      const q = await fs.collection('evidence').where('participation_id', '==', participationId).orderBy('created_at').get();
      return q.docs.map((d) => d.data() as EvidenceRow);
    },
    async evidenceUsage(participationId) {
      const s = await r.usage(participationId).get();
      const u = s.exists ? (s.data() as UsageDoc) : emptyUsage();
      return { n: u.evidence_count, bytes: u.evidence_bytes };
    },
    async segmentUploaded(participationId, clientSegmentId) {
      return (await r.segment(participationId, clientSegmentId).get()).exists;
    },
    async evidenceInParticipation(evidenceId, participationId) {
      return (await getEvidence(evidenceId))?.participation_id === participationId;
    },
    async openIntentCount(participationId, now) {
      const s = await r.usage(participationId).get();
      return s.exists ? liveOpen(s.data() as UsageDoc, now).length : 0;
    },

    addUploadedEvidence(e, now) {
      return tx(async (t) => {
        // Same checks, same order, as the SQLite transaction (state, count, bytes, segment).
        const status = await participationStatus(t, e.participation_id);
        const usage = await readUsage(t, r.usage(e.participation_id));
        const seg = await t.get(r.segment(e.participation_id, e.client_segment_id));
        const existing = await t.get(r.evidence(e.id));
        if (!canUploadEvidence(status)) throw fail('CONFLICT_STATE', 'The participation was submitted; evidence is frozen.');
        if (usage.evidence_count >= MAX_EVIDENCE_ITEMS_PER_PARTICIPATION) throw fail('CONFLICT_STATE', `At most ${MAX_EVIDENCE_ITEMS_PER_PARTICIPATION} evidence items per participation.`);
        if (usage.evidence_bytes + e.size_bytes > MAX_EVIDENCE_BYTES_PER_PARTICIPATION) throw fail('PAYLOAD_TOO_LARGE', 'Evidence storage limit for this participation reached.');
        if (seg.exists) throw fail('CONFLICT_STATE', 'This segment was already uploaded.');
        // A deterministic (Idempotency-Key) id already used: a clean conflict, not ALREADY_EXISTS.
        if (existing.exists) throw fail('CONFLICT_STATE', 'This upload was already recorded.');
        const row = newEvidenceDoc(e, now);
        t.create(r.evidence(e.id), row);
        t.create(r.segment(e.participation_id, e.client_segment_id), { evidence_id: e.id });
        t.set(r.usage(e.participation_id), { ...usage, evidence_count: usage.evidence_count + 1, evidence_bytes: usage.evidence_bytes + e.size_bytes });
        return row;
      });
    },

    async findOpenIntent(participationId, clientSegmentId, now) {
      const g = await r.openSegment(participationId, clientSegmentId).get();
      if (!g.exists) return undefined;
      const intent = await getIntentDoc((g.data() as { intent_id: string }).intent_id);
      return intent && OPEN.includes(intent.status) && intent.expires_at > now ? intent : undefined;
    },

    openUploadIntent(intent, now) {
      if (intent.object_key !== `quarantine/${intent.id}`) throw new Error('upload intent object keys are quarantine/{id}');
      return tx(async (t) => {
        const pid = intent.participation_id;
        const seg = await t.get(r.segment(pid, intent.client_segment_id));
        const guard = await t.get(r.openSegment(pid, intent.client_segment_id));
        const usage = await readUsage(t, r.usage(pid));
        const obj = await t.get(r.object(intent.object_key));
        // Expired pending intents release their reservation and open-segment slot (as SQLite's
        // UPDATE … 'expired'); read them all before any write.
        const staleIds = Object.entries(usage.open)
          .filter(([, o]) => o.expires_at <= now)
          .map(([id]) => id);
        const stale = (await t.getAll(...staleIds.map((id) => r.intent(id)))).map((s) => (s.exists ? (s.data() as IntentDoc) : null));
        const guardIntentId = guard.exists ? (guard.data() as { intent_id: string }).intent_id : null;
        const staleHolder = guardIntentId ? stale[staleIds.indexOf(guardIntentId)] : undefined;
        const holderSnap = guardIntentId && staleHolder === undefined ? await t.get(r.intent(guardIntentId)) : null;
        const holder = staleHolder ?? (holderSnap?.exists ? (holderSnap.data() as IntentDoc) : null);

        if (seg.exists) throw fail('CONFLICT_STATE', 'This segment was already uploaded.');
        // The segment still has an open intent: SQLite's partial UNIQUE index (pending or
        // completing, whatever the expiry) refuses the insert; so does this. An expired PENDING
        // holder is expired just below, as SQLite's UPDATE does before its insert.
        if (holder && (holder.status === 'completing' || (holder.status === 'pending' && holder.expires_at > now))) {
          throw fail('CONFLICT_STATE', 'This segment already has an open upload with different details.');
        }
        for (const [i, id] of staleIds.entries()) {
          const s = stale[i];
          // The guard itself is overwritten below, so it isn't deleted here (one write per document).
          if (s?.status === 'pending') closeIntentWrites(t, s, 'expired', null, usage);
          else delete usage.open[id]; // closed elsewhere, or past expiry while completing: no longer counts
        }
        if (holder && holder.status === 'pending' && !staleIds.includes(holder.id)) {
          closeIntentWrites(t, holder, 'expired', null, usage); // expired, though its reservation was already gone
        }
        assertQuota(quotaUsage(usage, now), intent.declared_size);

        const doc: IntentDoc = { ...intent, status: 'pending', evidence_id: null, created_at: now, quarantine_swept: false };
        t.create(r.intentByKey(intent.object_key), doc);
        // The guard is replaced only when its holder is closed or expired (read above).
        t.set(r.openSegment(pid, intent.client_segment_id), { intent_id: intent.id });
        usage.open[intent.id] = { bytes: intent.declared_size, expires_at: intent.expires_at };
        t.set(r.usage(pid), usage);
        // Registered before any URL that can create it is issued.
        if (!obj.exists) t.create(r.object(intent.object_key), { object_key: intent.object_key, created_at: now });
      });
    },

    getIntent: getIntentDoc,
    async expireIntent(id) {
      await transition(id, ['pending'], 'expired');
    },
    claimIntent(id, evidenceId) {
      return tx(async (t) => {
        const s = await t.get(r.intent(id));
        if (!s.exists || (s.data() as IntentDoc).status !== 'pending') return false;
        t.update(r.intent(id), { status: 'completing', evidence_id: evidenceId });
        return true;
      });
    },
    async releaseIntent(id, status) {
      if (status === 'rejected') {
        await transition(id, ['completing'], 'rejected');
        return;
      }
      await tx(async (t) => {
        const s = await t.get(r.intent(id));
        if (s.exists && (s.data() as IntentDoc).status === 'completing') t.update(r.intent(id), { status: 'pending' });
      });
    },

    finalizeIntent(intent, e, now) {
      return tx(async (t) => {
        const pid = intent.participation_id;
        const status = await participationStatus(t, pid);
        const seg = await t.get(r.segment(pid, intent.client_segment_id));
        const usage = await readUsage(t, r.usage(pid));
        const cur = await t.get(r.intent(intent.id));
        const guardIntentId = await readGuardIntentId(t, intent);
        if (!canUploadEvidence(status)) throw fail('CONFLICT_STATE', 'The participation was submitted; evidence is frozen.');
        if (seg.exists) throw fail('CONFLICT_STATE', 'This segment was already uploaded.');
        assertQuota(quotaUsage(usage, now, intent.id), e.size_bytes);
        // Only the claim holder completes; an intent closed meanwhile is refused (the caller deletes the promoted copy).
        const curIntent = cur.exists ? (cur.data() as IntentDoc) : null;
        if (!curIntent || curIntent.status !== 'completing') throw fail('CONFLICT_STATE', 'This upload was closed while it was being completed.');
        const row = newEvidenceDoc(e, now);
        t.create(r.evidence(e.id), row);
        t.create(r.segment(pid, intent.client_segment_id), { evidence_id: e.id });
        closeIntentWrites(t, curIntent, 'completed', guardIntentId, usage);
        t.set(r.usage(pid), { ...usage, evidence_count: usage.evidence_count + 1, evidence_bytes: usage.evidence_bytes + e.size_bytes });
        return row;
      });
    },

    async issuePlaybackToken(tokenHash, evidenceId, userId, expiresAt) {
      await r.playback(tokenHash).create({ token_hash: tokenHash, evidence_id: evidenceId, user_id: userId, expires_at: expiresAt });
    },
    async getPlaybackToken(tokenHash) {
      const s = await r.playback(tokenHash).get();
      if (!s.exists) return undefined;
      const t = s.data() as { evidence_id: string; user_id: string; expires_at: number };
      // ON DELETE CASCADE in SQLite: a token for deleted evidence is gone.
      return (await r.evidence(t.evidence_id).get()).exists ? t : undefined;
    },
    revokePlaybackTokens,

    async registerObject(key, now) {
      try {
        await r.object(key).create({ object_key: key, created_at: now });
      } catch (e) {
        if ((e as { code?: number }).code !== 6) throw e; // ALREADY_EXISTS: registered before (ON CONFLICT DO NOTHING)
      }
    },
    async ownsObject(key) {
      const s = await r.object(key).get();
      return s.exists && (s.data() as { object_key: string }).object_key === key;
    },
    async enqueueDeletion(key, purpose, now) {
      try {
        await r.deletion(key).create({ object_key: key, attempts: 1, next_attempt_at: now + 60_000, created_at: now, purpose });
      } catch (e) {
        if ((e as { code?: number }).code !== 6) throw e; // already queued
      }
    },
    async dueDeletions(now, limit) {
      const q = await fs.collection('storageDeletions').where('next_attempt_at', '<=', now).limit(limit).get();
      return q.docs.map((d) => {
        const x = d.data() as { object_key: string; attempts: number; purpose: DeletionPurpose };
        return { object_key: x.object_key, attempts: x.attempts, purpose: x.purpose };
      });
    },
    async deletionDone(key) {
      await r.deletion(key).delete();
    },
    async deletionRetry(key, nextAttemptAt) {
      await tx(async (t) => {
        const s = await t.get(r.deletion(key));
        if (s.exists) t.update(r.deletion(key), { attempts: (s.data() as { attempts: number }).attempts + 1, next_attempt_at: nextAttemptAt });
      });
    },

    async duePending(now, limit) {
      const q = await fs.collection('uploadIntents').where('status', '==', 'pending').where('expires_at', '<=', now).limit(limit).get();
      return q.docs.map((d) => (d.data() as IntentDoc).id);
    },
    async stuckCompleting(cutoff, limit) {
      const q = await fs.collection('uploadIntents').where('status', '==', 'completing').where('expires_at', '<=', cutoff).limit(limit).get();
      return q.docs.map((d) => {
        const x = d.data() as IntentDoc;
        return { id: x.id, evidence_id: x.evidence_id };
      });
    },
    async evidenceExists(id) {
      return (await r.evidence(id).get()).exists;
    },
    async expireIntentNow(id) {
      // SQLite sets 'expired' unconditionally; from an open status this also releases the guard and
      // reservation, and a closed intent is set to 'expired' as before.
      if (await transition(id, ['pending', 'completing'], 'expired')) return;
      await tx(async (t) => {
        const s = await t.get(r.intent(id));
        if (s.exists) t.update(r.intent(id), { status: 'expired' });
      });
    },
    async closedUnswept(now, limit) {
      const q = await fs
        .collection('uploadIntents')
        .where('status', 'in', ['completed', 'rejected', 'expired'])
        .where('quarantine_swept', '==', false)
        .where('expires_at', '<=', now)
        .limit(limit)
        .get();
      return q.docs.map((d) => {
        const x = d.data() as IntentDoc;
        return { id: x.id, object_key: x.object_key, status: x.status };
      });
    },
    async intentEvidenceExists(intentId) {
      const intent = await getIntentDoc(intentId);
      return !!intent?.evidence_id && (await r.evidence(intent.evidence_id).get()).exists;
    },
    async markQuarantineSwept(id) {
      await r.intent(id).update({ quarantine_swept: true });
    },

    async exportUser(userId) {
      const parts = await fs.collection('participations').where('tester_id', '==', userId).get();
      const ids = parts.docs.map((d) => d.id);
      const rows: EvidenceRow[] = [];
      for (const c of chunks(ids, IN_LIMIT)) {
        const q = await fs.collection('evidence').where('participation_id', 'in', c).get();
        rows.push(...q.docs.map((d) => d.data() as EvidenceRow));
      }
      return { evidence: rows.map(evidenceView) };
    },

    /**
     * Account deletion, evidence part, in bounded transactions; safe to rerun (each step re-reads
     * and skips what is already done). Every object key is also put in the deletion outbox in the
     * transaction that removes its row, so a crash between steps can't leave an object nobody
     * will delete; the caller's immediate deleteOrQueue then finds it queued already.
     */
    async purgeUser(userId, nowMs) {
      const media: string[] = [];
      const evidenceIds: string[] = [];
      const queue = (t: TxCtx, key: string) =>
        t.set(r.deletion(key), { object_key: key, attempts: 0, next_attempt_at: nowMs, created_at: nowMs, purpose: 'account_deletion' });

      // Evidence the user recorded, and evidence inside studies the user owns.
      const own = await fs.collection('participations').where('tester_id', '==', userId).get();
      const studies = await fs.collection('studies').where('builder_id', '==', userId).get();
      const pids = new Set(own.docs.map((d) => d.id));
      for (const c of chunks(studies.docs.map((d) => d.id), IN_LIMIT)) {
        for (const d of (await fs.collection('participations').where('study_id', 'in', c).get()).docs) pids.add(d.id);
      }
      const evIds: string[] = [];
      for (const c of chunks([...pids], IN_LIMIT)) {
        for (const d of (await fs.collection('evidence').where('participation_id', 'in', c).get()).docs) evIds.push(d.id);
      }
      for (const c of chunks(evIds, PURGE_EVIDENCE_PER_TX)) {
        // The retained quarantine copy of each recording (direct uploads), if any.
        const copies = new Map<string, string[]>();
        for (const ic of chunks(c, IN_LIMIT)) {
          for (const d of (await fs.collection('uploadIntents').where('evidence_id', 'in', ic).get()).docs) {
            const x = d.data() as IntentDoc;
            copies.set(x.evidence_id!, [...(copies.get(x.evidence_id!) ?? []), x.object_key]);
          }
        }
        const removed = await tx(async (t) => {
          const snaps = await t.getAll(...c.map((id) => r.evidence(id)));
          const rows = snaps.filter((s) => s.exists).map((s) => s.data() as EvidenceRow);
          const byPid = [...new Set(rows.map((e) => e.participation_id))];
          const usages = new Map<string, UsageDoc>();
          for (const pid of byPid) usages.set(pid, await readUsage(t, r.usage(pid)));
          const keys: string[] = [];
          for (const e of rows) {
            keys.push(e.storage_key, ...(copies.get(e.id) ?? []));
            t.delete(r.evidence(e.id));
            t.delete(r.segment(e.participation_id, e.client_segment_id));
            const u = usages.get(e.participation_id)!;
            u.evidence_count = Math.max(0, u.evidence_count - 1);
            u.evidence_bytes = Math.max(0, u.evidence_bytes - e.size_bytes);
          }
          for (const [pid, u] of usages) t.set(r.usage(pid), u);
          for (const k of keys) queue(t, k);
          return { ids: rows.map((e) => e.id), keys };
        });
        evidenceIds.push(...removed.ids);
        media.push(...removed.keys);
      }

      await revokePlaybackTokens(userId);

      // Open direct uploads: close them and remove their quarantine objects.
      const quarantine: string[] = [];
      for (;;) {
        const q = await fs.collection('uploadIntents').where('tester_id', '==', userId).where('status', 'in', OPEN).limit(PURGE_INTENTS_PER_TX).get();
        if (q.empty) break;
        const closed = await tx(async (t) => {
          const snaps = await t.getAll(...q.docs.map((d) => d.ref));
          const open = snaps.filter((s) => s.exists).map((s) => s.data() as IntentDoc).filter((i) => OPEN.includes(i.status));
          const guards = await t.getAll(...open.map((i) => r.openSegment(i.participation_id, i.client_segment_id)));
          const usages = new Map<string, UsageDoc>();
          for (const pid of new Set(open.map((i) => i.participation_id))) usages.set(pid, await readUsage(t, r.usage(pid)));
          open.forEach((i, n) => {
            const g = guards[n]?.exists ? (guards[n]!.data() as { intent_id: string }).intent_id : null;
            closeIntentWrites(t, i, 'expired', g, usages.get(i.participation_id)!);
            queue(t, i.object_key);
          });
          for (const [pid, u] of usages) t.set(r.usage(pid), u);
          return open.map((i) => i.object_key);
        });
        quarantine.push(...closed);
        if (closed.length === 0) break;
      }
      return { mediaKeys: [...media, ...quarantine], evidenceIds };
    },
  };
}
