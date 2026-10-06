import { Readable } from 'node:stream';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config';
import { assertKey, PRESIGN_GET_MAX_SECONDS, StorageChanged, type EvidenceStore } from './types';

/**
 * Cloudflare R2 through its S3-compatible API. Credentials are server-only (env); the
 * bucket is private (public access off; see docs/deploy/cloud-backend.md). `endpoint`
 * defaults to the account's R2 endpoint and may be overridden for tests (loopback only).
 */
/**
 * `keyPrefix: 'devnet/'` (POCKETQA_ENV=devnet, CH-D2): every object this store touches lives under
 * that prefix. The app keeps its logical keys (`evidence/…`, `quarantine/…`, as registered in its
 * namespaced data); the prefix is added to the physical key after validation, so a devnet
 * deployment can never read, sign, copy or delete `evidence/` or `retained-local-submissions/`.
 */
export function r2Store(r2: NonNullable<Config['r2']>, opts: { keyPrefix?: 'devnet/' } = {}): EvidenceStore {
  const client = new S3Client({
    region: 'auto',
    endpoint: r2.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  });
  const Bucket = r2.bucket;
  const prefix = opts.keyPrefix ?? '';
  /** The physical key of a validated logical key. */
  const k = (key: string) => `${prefix}${key}`;
  const APP_PREFIX = /^(evidence|quarantine)\//;
  const changed = (e: unknown) => {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    return err.name === 'PreconditionFailed' || err.$metadata?.httpStatusCode === 412;
  };
  const notFound = (e: unknown) => {
    const err = e as { name?: string; $metadata?: { httpStatusCode?: number } };
    return err.name === 'NotFound' || err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404;
  };
  return {
    canDelete: r2.allowDelete,
    kind: 'r2',
    async head(key) {
      assertKey(key);
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket, Key: k(key) }));
        return { size: Number(r.ContentLength ?? 0), etag: r.ETag ?? '' };
      } catch (e) {
        if (notFound(e)) return null;
        throw e;
      }
    },
    async readRange(key, start, end, opts) {
      assertKey(key);
      try {
        const r = await client.send(new GetObjectCommand({ Bucket, Key: k(key), Range: `bytes=${start}-${end}`, ...(opts?.ifMatch ? { IfMatch: opts.ifMatch } : {}) }));
        return r.Body as Readable;
      } catch (e) {
        if (changed(e)) throw new StorageChanged('object changed');
        throw e;
      }
    },
    async copy(src, dst, opts) {
      assertKey(src);
      assertKey(dst);
      try {
        await client.send(new CopyObjectCommand({ Bucket, Key: k(dst), CopySource: `${Bucket}/${k(src)}`, ...(opts?.ifMatch ? { CopySourceIfMatch: opts.ifMatch } : {}) }));
      } catch (e) {
        if (changed(e)) throw new StorageChanged('object changed');
        throw e;
      }
    },
    async delete(key) {
      assertKey(key);
      // Refused before any request: the caller's deleteOrQueue keeps the key in the outbox.
      if (!r2.allowDelete) throw new Error('R2 deletion is disabled (POCKETQA_R2_ALLOW_DELETE is not set)');
      // Only the app's own key shapes, one object per call (no batch delete, listing or
      // lifecycle exists in this adapter); ownership itself is checked by deleteOrQueue.
      if (!APP_PREFIX.test(key)) throw new Error('refusing to delete a key outside evidence/ and quarantine/');
      await client.send(new DeleteObjectCommand({ Bucket, Key: k(key) }));
    },
    async presignGet(key, { contentType, expiresInSeconds, signingDate }) {
      assertKey(key);
      // Only the app's own objects are ever readable through a URL (never e.g. retained archives).
      if (!APP_PREFIX.test(key)) throw new Error('refusing to sign a key outside evidence/ and quarantine/');
      if (!(expiresInSeconds >= 1 && expiresInSeconds <= PRESIGN_GET_MAX_SECONDS)) throw new Error(`playback URLs live 1..${PRESIGN_GET_MAX_SECONDS} s`);
      const cmd = new GetObjectCommand({
        Bucket,
        Key: k(key),
        // Signed response overrides: served as the sniffed type, inline, never cached.
        ResponseContentType: contentType,
        ResponseContentDisposition: 'inline',
        ResponseCacheControl: 'no-store',
      });
      return { url: await getSignedUrl(client, cmd, { expiresIn: expiresInSeconds, signingDate }) };
    },
    async presignPut(key, { contentType, contentLength, expiresInSeconds }) {
      assertKey(key);
      const cmd = new PutObjectCommand({ Bucket, Key: k(key), ContentType: contentType, ContentLength: contentLength });
      // content-type and content-length are signed, so the PUT must send exactly these.
      const url = await getSignedUrl(client, cmd, { expiresIn: expiresInSeconds, signableHeaders: new Set(['content-type', 'content-length']) });
      return { url, headers: { 'content-type': contentType } };
    },
  };
}
