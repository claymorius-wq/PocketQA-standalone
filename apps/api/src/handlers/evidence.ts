import { createReadStream, createWriteStream, openSync, readSync, closeSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import {
  EvidenceUploadMeta,
  MAX_EVIDENCE_BYTES_PER_PARTICIPATION,
  MAX_EVIDENCE_ITEMS_PER_PARTICIPATION,
  PLAYBACK_TOKEN_TTL_SECONDS,
} from '@pocket-qa/contracts';
import { canUploadEvidence } from '@pocket-qa/domain';
import { partyParticipation, testerParticipation } from '../access';
import { me, type Ctx, type Handler } from '../context';
import { fail, iso, newId, newToken, notFound, sha256 } from '../util';
import { evidenceView, type EvidenceRow, type UserRow } from '../views';

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

  media: (ctx) => {
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
    const path = join(ctx.deps.mediaDir, ev.storage_key);
    const size = statSync(path).size;
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
      return reply.send(createReadStream(path, { start, end }));
    }
    reply.header('Content-Length', String(size));
    return reply.send(createReadStream(path));
  },
} satisfies Record<string, Handler>;
