import { createWriteStream, openSync, readSync, closeSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  EvidenceUploadMeta,
  MAX_EVIDENCE_BYTES,
  MAX_EVIDENCE_BYTES_PER_PARTICIPATION,
  MAX_EVIDENCE_ITEMS_PER_PARTICIPATION,
  PLAYBACK_TOKEN_TTL_SECONDS,
  UPLOAD_INTENT_TTL_SECONDS,
} from '@pocket-qa/contracts';
import { canUploadEvidence } from '@pocket-qa/domain';
import { partyParticipation, testerParticipation } from '../access';
import { me, type Ctx, type Handler } from '../context';
import { fail, iso, newId, newToken, notFound, sha256 } from '../util';
import { deleteOrQueue } from '../storage/sweep';
import { readHead as storeHead, StorageChanged } from '../storage/types';
import { evidenceView, type EvidenceRow, type UserRow } from '../views';

/** Longest life of a presigned PUT; always within the intent's own lifetime. */
const PRESIGN_SECONDS = 10 * 60;

type IntentRow = {
  id: string;
  participation_id: string;
  tester_id: string;
  kind: string;
  mime_type: EvidenceRow['mime_type'];
  declared_size: number;
  duration_ms: number | null;
  task_id: string | null;
  captured_on: string;
  client_segment_id: string;
  object_key: string;
  status: 'pending' | 'completing' | 'completed' | 'rejected' | 'expired';
  evidence_id: string | null;
  expires_at: number;
};

/** Evidence plus open (unexpired) intents: an intent reserves its declared bytes until it closes. */
function usage(db: Ctx['deps']['db'], participationId: string, now: number, exceptIntent = '') {
  const ev = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes),0) AS bytes FROM evidence WHERE participation_id = ?').get(participationId) as { n: number; bytes: number };
  const open = db
    .prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(declared_size),0) AS bytes FROM upload_intents WHERE participation_id = ? AND status IN ('pending','completing') AND expires_at > ? AND id != ?`)
    .get(participationId, now, exceptIntent) as { n: number; bytes: number };
  return { n: ev.n + open.n, bytes: ev.bytes + open.bytes };
}

function assertQuota(u: { n: number; bytes: number }, addBytes: number) {
  if (u.n + 1 > MAX_EVIDENCE_ITEMS_PER_PARTICIPATION) throw fail('CONFLICT_STATE', `At most ${MAX_EVIDENCE_ITEMS_PER_PARTICIPATION} evidence items per participation.`);
  if (u.bytes + addBytes > MAX_EVIDENCE_BYTES_PER_PARTICIPATION) throw fail('PAYLOAD_TOO_LARGE', 'Evidence storage limit for this participation reached.');
}

// ISO-BMFF major brands that are MP4 video. HEIC/AVIF/QuickTime share the `ftyp` box but aren't MP4.
const MP4_BRANDS = new Set(['isom', 'iso2', 'iso3', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'dash', 'M4V ']);

/** Content type is decided by file signature, never by the client's claim. */
export function sniffMime(head: Buffer): EvidenceRow['mime_type'] | null {
  if (head.length >= 12 && head.subarray(4, 8).toString('latin1') === 'ftyp' && MP4_BRANDS.has(head.subarray(8, 12).toString('latin1'))) {
    return 'video/mp4';
  }
  if (head.length >= 4 && head.readUInt32BE(0) === 0x1a45dfa3) return 'video/webm';
  if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (head.length >= 12 && head.subarray(0, 4).toString('latin1') === 'RIFF' && head.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

function readHead(path: string): Buffer {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(16);
    const n = readSync(fd, buf, 0, 16, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

export const evidenceHandlers = {
  uploadEvidence: async (ctx: Ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    const { p } = testerParticipation(db, ctx.params.id!, user);
    if (ctx.deps.store.kind !== 'local') {
      (await ctx.req.file())?.file.resume();
      throw fail('CONFLICT_STATE', 'This deployment uses direct uploads: create an upload intent instead.');
    }
    if (!canUploadEvidence(p.status)) throw fail('CONFLICT_STATE', 'Evidence can only be added while the participation is in progress.');

    const file = await ctx.req.file();
    if (!file) throw fail('VALIDATION', 'Multipart field "file" is required.');
    const metaField = file.fields.meta as { value?: unknown } | undefined;
    let metaRaw: unknown;
    try {
      metaRaw = JSON.parse(String(metaField?.value ?? ''));
    } catch {
      metaRaw = null;
    }
    const meta = EvidenceUploadMeta.safeParse(metaRaw);
    if (!meta.success) {
      file.file.resume();
      throw fail('VALIDATION', 'Multipart field "meta" (sent before "file") must be valid evidence metadata.');
    }

    const usage = db
      .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes),0) AS bytes FROM evidence WHERE participation_id = ?')
      .get(p.id) as { n: number; bytes: number };
    if (usage.n >= MAX_EVIDENCE_ITEMS_PER_PARTICIPATION) {
      file.file.resume();
      throw fail('CONFLICT_STATE', `At most ${MAX_EVIDENCE_ITEMS_PER_PARTICIPATION} evidence items per participation.`);
    }
    if (db.prepare('SELECT 1 FROM evidence WHERE participation_id = ? AND client_segment_id = ?').get(p.id, meta.data.clientSegmentId)) {
      file.file.resume();
      throw fail('CONFLICT_STATE', 'This segment was already uploaded.');
    }
    if (meta.data.taskId && !db.prepare('SELECT 1 FROM tasks WHERE id = ? AND study_id = ?').get(meta.data.taskId, p.study_id)) {
      file.file.resume();
      throw fail('VALIDATION', 'Unknown task for this study.');
    }

    const key = newId();
    const path = join(ctx.deps.mediaDir, key);
    try {
      await pipeline(file.file, createWriteStream(path, { mode: 0o600 }));
      if (file.file.truncated) throw fail('PAYLOAD_TOO_LARGE', 'Evidence file is too large.');
      const size = statSync(path).size;
      if (size === 0) throw fail('VALIDATION', 'Evidence file is empty.');
      if (usage.bytes + size > MAX_EVIDENCE_BYTES_PER_PARTICIPATION) throw fail('PAYLOAD_TOO_LARGE', 'Evidence storage limit for this participation reached.');
      const mime = sniffMime(readHead(path));
      if (!mime) throw fail('VALIDATION', 'Unsupported file type. Use MP4, WebM, PNG, JPEG or WebP.');
      const isVideo = mime.startsWith('video/');
      if (isVideo !== (meta.data.kind === 'screen_recording')) throw fail('VALIDATION', 'File type does not match the evidence kind.');

      const id = newId();
      db.transaction(() => {
        // Re-check state inside the write transaction: submission may have raced the upload.
        const cur = db.prepare('SELECT status FROM participations WHERE id = ?').get(p.id) as { status: typeof p.status };
        if (!canUploadEvidence(cur.status)) throw fail('CONFLICT_STATE', 'The participation was submitted; evidence is frozen.');
        // Caps and duplicates again inside the write transaction: parallel uploads may have raced.
        const now = db
          .prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size_bytes),0) AS bytes FROM evidence WHERE participation_id = ?')
          .get(p.id) as { n: number; bytes: number };
        if (now.n >= MAX_EVIDENCE_ITEMS_PER_PARTICIPATION) throw fail('CONFLICT_STATE', `At most ${MAX_EVIDENCE_ITEMS_PER_PARTICIPATION} evidence items per participation.`);
        if (now.bytes + size > MAX_EVIDENCE_BYTES_PER_PARTICIPATION) throw fail('PAYLOAD_TOO_LARGE', 'Evidence storage limit for this participation reached.');
        if (db.prepare('SELECT 1 FROM evidence WHERE participation_id = ? AND client_segment_id = ?').get(p.id, meta.data.clientSegmentId)) {
          throw fail('CONFLICT_STATE', 'This segment was already uploaded.');
        }
        db.prepare(
          `INSERT INTO evidence (id, participation_id, kind, mime_type, size_bytes, duration_ms, task_id, captured_on, client_segment_id, storage_key, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(id, p.id, meta.data.kind, mime, size, meta.data.durationMs ?? null, meta.data.taskId ?? null, meta.data.capturedOn, meta.data.clientSegmentId, key, iso(ctx.deps.now()));
      })();
      return evidenceView(db.prepare('SELECT * FROM evidence WHERE id = ?').get(id) as EvidenceRow);
    } catch (e) {
      rmSync(path, { force: true });
      throw e;
    }
  },

  listEvidence: (ctx) => {
    const { p } = partyParticipation(ctx.deps.db, ctx.params.id!, me(ctx));
    const rows = ctx.deps.db.prepare('SELECT * FROM evidence WHERE participation_id = ? ORDER BY created_at').all(p.id) as EvidenceRow[];
    return { items: rows.map(evidenceView) };
  },

  playbackToken: (ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    const ev = db.prepare('SELECT * FROM evidence WHERE id = ?').get(ctx.params.id!) as EvidenceRow | undefined;
    if (!ev) throw notFound('Evidence');
    try {
      partyParticipation(db, ev.participation_id, user);
    } catch {
      throw notFound('Evidence');
    }
    const token = newToken();
    const expires = ctx.deps.now() + PLAYBACK_TOKEN_TTL_SECONDS * 1000;
    db.prepare('INSERT INTO playback_tokens (token_hash, evidence_id, user_id, expires_at) VALUES (?,?,?,?)').run(sha256(token), ev.id, user.id, expires);
    return { token, expiresAt: iso(expires) };
  },

  media: async (ctx) => {
    const db = ctx.deps.db;
    const t = db.prepare('SELECT * FROM playback_tokens WHERE token_hash = ?').get(sha256(ctx.params.token ?? '')) as
      | { evidence_id: string; user_id: string; expires_at: number }
      | undefined;
    if (!t || t.expires_at <= ctx.deps.now()) throw notFound('Media');
    const ev = db.prepare('SELECT * FROM evidence WHERE id = ?').get(t.evidence_id) as EvidenceRow | undefined;
    const holder = db.prepare(`SELECT * FROM users WHERE id = ? AND status = 'active'`).get(t.user_id) as UserRow | undefined;
    if (!ev || !holder) throw notFound('Media');
    // Access is re-checked at use time, not only at issuance.
    try {
      partyParticipation(db, ev.participation_id, holder);
    } catch {
      throw notFound('Media');
    }
    const head = await ctx.deps.store.head(ev.storage_key);
    if (!head) throw notFound('Media');
    const size = head.size;
    const reply = ctx.reply;
    reply.header('Content-Type', ev.mime_type);
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Disposition', 'inline');
    reply.header('Accept-Ranges', 'bytes');
    const range = /^bytes=(\d*)-(\d*)$/.exec(ctx.req.headers.range ?? '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, start);
      end = Math.min(size - 1, end);
      if (start > end) {
        reply.code(416).header('Content-Range', `bytes */${size}`);
        return reply.send();
      }
      reply.code(206).header('Content-Range', `bytes ${start}-${end}/${size}`).header('Content-Length', String(end - start + 1));
      return reply.send(await ctx.deps.store.readRange(ev.storage_key, start, end));
    }
    reply.header('Content-Length', String(size));
    return reply.send(await ctx.deps.store.readRange(ev.storage_key, 0, size - 1));
  },

  /**
   * Direct upload, step 1 (r2 storage). Same authorization, consent/state and quota rules
   * as the multipart route, counting bytes reserved by open intents. Idempotent per
   * segment: a retry gets a fresh URL for the same quarantine key.
   */
  createUploadIntent: async (ctx: Ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    // Ownership first, so non-owners always get 404 whatever the storage mode.
    const { p } = testerParticipation(db, ctx.params.id!, user);
    if (ctx.deps.store.kind === 'local') throw fail('CONFLICT_STATE', 'This deployment stores evidence locally: use the multipart upload.');
    if (!canUploadEvidence(p.status)) throw fail('CONFLICT_STATE', 'Evidence can only be added while the participation is in progress.');
    const b = ctx.body as { kind: string; mimeType: EvidenceRow['mime_type']; sizeBytes: number; durationMs?: number; taskId?: string; capturedOn: string; clientSegmentId: string };
    if (b.mimeType.startsWith('video/') !== (b.kind === 'screen_recording')) throw fail('VALIDATION', 'File type does not match the evidence kind.');
    if (b.taskId && !db.prepare('SELECT 1 FROM tasks WHERE id = ? AND study_id = ?').get(b.taskId, p.study_id)) throw fail('VALIDATION', 'Unknown task for this study.');
    const now = ctx.deps.now();
    const existing = db
      .prepare(`SELECT * FROM upload_intents WHERE participation_id = ? AND client_segment_id = ? AND status IN ('pending','completing') AND expires_at > ?`)
      .get(p.id, b.clientSegmentId, now) as IntentRow | undefined;
    let intent: IntentRow;
    if (existing) {
      if (existing.status !== 'pending' || existing.declared_size !== b.sizeBytes || existing.mime_type !== b.mimeType) {
        throw fail('CONFLICT_STATE', 'This segment already has an open upload with different details.');
      }
      intent = existing;
    } else {
      const id = newId();
      intent = {
        id,
        participation_id: p.id,
        tester_id: user.id,
        kind: b.kind,
        mime_type: b.mimeType,
        declared_size: b.sizeBytes,
        duration_ms: b.durationMs ?? null,
        task_id: b.taskId ?? null,
        captured_on: b.capturedOn,
        client_segment_id: b.clientSegmentId,
        object_key: `quarantine/${id}`,
        status: 'pending',
        evidence_id: null,
        expires_at: now + UPLOAD_INTENT_TTL_SECONDS * 1000,
      };
      db.transaction(() => {
        if (db.prepare('SELECT 1 FROM evidence WHERE participation_id = ? AND client_segment_id = ?').get(p.id, b.clientSegmentId)) {
          throw fail('CONFLICT_STATE', 'This segment was already uploaded.');
        }
        // Expired pending intents release their reservation (and their open-segment slot).
        db.prepare(`UPDATE upload_intents SET status = 'expired' WHERE participation_id = ? AND status = 'pending' AND expires_at <= ?`).run(p.id, now);
        assertQuota(usage(db, p.id, now), b.sizeBytes);
        db.prepare(
          `INSERT INTO upload_intents (id, participation_id, tester_id, kind, mime_type, declared_size, duration_ms, task_id, captured_on, client_segment_id, object_key, status, expires_at, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending', ?, ?)`,
        ).run(intent.id, p.id, user.id, b.kind, b.mimeType, b.sizeBytes, intent.duration_ms, intent.task_id, b.capturedOn, b.clientSegmentId, intent.object_key, intent.expires_at, now);
      })();
    }
    const seconds = Math.max(1, Math.min(PRESIGN_SECONDS, Math.floor((intent.expires_at - now) / 1000)));
    const signed = await ctx.deps.store.presignPut(intent.object_key, { contentType: intent.mime_type, contentLength: intent.declared_size, expiresInSeconds: seconds });
    return { id: intent.id, method: 'PUT' as const, uploadUrl: signed.url, headers: signed.headers, expiresAt: iso(intent.expires_at) };
  },

  /**
   * Direct upload, step 2. Nothing is evidence until the server has checked the stored
   * object's real size and content signature against the declaration, re-checked state
   * and quota in a transaction, and promoted it to an immutable final key that no client
   * URL can write.
   */
  completeUploadIntent: async (ctx: Ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    const store = ctx.deps.store;
    const now = ctx.deps.now();
    const intent = db.prepare('SELECT * FROM upload_intents WHERE id = ?').get(ctx.params.id!) as IntentRow | undefined;
    if (!intent || intent.tester_id !== user.id) throw notFound('Upload');
    if (intent.status !== 'pending') throw fail('CONFLICT_STATE', `This upload is ${intent.status}.`);
    if (intent.expires_at <= now) {
      db.prepare(`UPDATE upload_intents SET status = 'expired' WHERE id = ? AND status = 'pending'`).run(intent.id);
      throw fail('CONFLICT_STATE', 'This upload expired. Start it again.');
    }
    const head = await store.head(intent.object_key);
    if (!head) throw fail('CONFLICT_STATE', 'The upload has not arrived yet. Retry the upload, then complete it.');
    // Never proceed unpinned: without a version tag the bytes could change under us.
    if (!head.etag) throw fail('CONFLICT_STATE', 'Storage did not report a version for the upload. Complete it again.');

    // Claim the intent atomically: concurrent completions get 409.
    const evidenceId = newId();
    const claimed = db.prepare(`UPDATE upload_intents SET status = 'completing', evidence_id = ? WHERE id = ? AND status = 'pending'`).run(evidenceId, intent.id);
    if (claimed.changes !== 1) throw fail('CONFLICT_STATE', 'This upload is already being completed.');
    // Conditional: never reopen or overwrite an intent that something else (account
    // deletion, the sweep) closed meanwhile.
    const setStatus = (status: IntentRow['status']) => db.prepare(`UPDATE upload_intents SET status = ? WHERE id = ? AND status = 'completing'`).run(status, intent.id);
    const changedMeanwhile = () => {
      setStatus('pending');
      return fail('CONFLICT_STATE', 'The upload changed while it was being checked. Complete it again.');
    };
    const reject = async (message: string) => {
      setStatus('rejected');
      await deleteOrQueue(ctx.deps, intent.object_key);
      return fail('VALIDATION', message);
    };

    if (head.size !== intent.declared_size || head.size > MAX_EVIDENCE_BYTES) throw await reject('The uploaded file size does not match what was declared.');
    // Everything below is pinned to the exact version HEAD saw: bytes swapped in with the
    // still-valid presigned URL can't slip between validation and promotion.
    let mime: EvidenceRow['mime_type'] | null;
    try {
      mime = sniffMime(await storeHead(store, intent.object_key, 16, { ifMatch: head.etag }));
    } catch (e) {
      if (e instanceof StorageChanged) throw changedMeanwhile();
      setStatus('pending'); // transient read failure: retryable
      throw e;
    }
    if (mime !== intent.mime_type) throw await reject('The uploaded file is not the declared type. Use MP4, WebM, PNG, JPEG or WebP.');

    const finalKey = `evidence/${evidenceId}`;
    try {
      await store.copy(intent.object_key, finalKey, { ifMatch: head.etag });
    } catch (e) {
      if (e instanceof StorageChanged) throw changedMeanwhile();
      setStatus('pending'); // transient storage failure: retryable
      throw e;
    }
    try {
      db.transaction(() => {
        const cur = db.prepare('SELECT status FROM participations WHERE id = ?').get(intent.participation_id) as { status: Parameters<typeof canUploadEvidence>[0] };
        if (!canUploadEvidence(cur.status)) throw fail('CONFLICT_STATE', 'The participation was submitted; evidence is frozen.');
        if (db.prepare('SELECT 1 FROM evidence WHERE participation_id = ? AND client_segment_id = ?').get(intent.participation_id, intent.client_segment_id)) {
          throw fail('CONFLICT_STATE', 'This segment was already uploaded.');
        }
        assertQuota(usage(db, intent.participation_id, now, intent.id), head.size);
        db.prepare(
          `INSERT INTO evidence (id, participation_id, kind, mime_type, size_bytes, duration_ms, task_id, captured_on, client_segment_id, storage_key, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        ).run(evidenceId, intent.participation_id, intent.kind, mime, head.size, intent.duration_ms, intent.task_id, intent.captured_on, intent.client_segment_id, finalKey, iso(now));
        // Only the claim holder completes; if the intent was closed meanwhile, roll back
        // (the failure path below deletes the promoted copy).
        if (db.prepare(`UPDATE upload_intents SET status = 'completed' WHERE id = ? AND status = 'completing'`).run(intent.id).changes !== 1) {
          throw fail('CONFLICT_STATE', 'This upload was closed while it was being completed.');
        }
      })();
    } catch (e) {
      setStatus('rejected');
      await deleteOrQueue(ctx.deps, finalKey);
      await deleteOrQueue(ctx.deps, intent.object_key);
      throw e;
    }
    await deleteOrQueue(ctx.deps, intent.object_key);
    return evidenceView(db.prepare('SELECT * FROM evidence WHERE id = ?').get(evidenceId) as EvidenceRow);
  },
} satisfies Record<string, Handler>;
