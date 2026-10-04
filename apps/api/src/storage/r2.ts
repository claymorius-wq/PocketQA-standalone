import { Readable } from 'node:stream';
import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config';
import { assertKey, StorageChanged, type EvidenceStore } from './types';

/**
 * Cloudflare R2 through its S3-compatible API. Credentials are server-only (env); the
 * bucket is private (public access off; see docs/deploy/cloud-backend.md). `endpoint`
 * defaults to the account's R2 endpoint and may be overridden for tests (loopback only).
 */
export function r2Store(r2: NonNullable<Config['r2']>): EvidenceStore {
  const client = new S3Client({
    region: 'auto',
    endpoint: r2.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: r2.accessKeyId, secretAccessKey: r2.secretAccessKey },
  });
  const Bucket = r2.bucket;
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
        const r = await client.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: Number(r.ContentLength ?? 0), etag: r.ETag ?? '' };
      } catch (e) {
        if (notFound(e)) return null;
        throw e;
      }
    },
    async readRange(key, start, end, opts) {
      assertKey(key);
      try {
        const r = await client.send(new GetObjectCommand({ Bucket, Key: key, Range: `bytes=${start}-${end}`, ...(opts?.ifMatch ? { IfMatch: opts.ifMatch } : {}) }));
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
        await client.send(new CopyObjectCommand({ Bucket, Key: dst, CopySource: `${Bucket}/${src}`, ...(opts?.ifMatch ? { CopySourceIfMatch: opts.ifMatch } : {}) }));
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
      if (!/^(evidence|quarantine)\//.test(key)) throw new Error('refusing to delete a key outside evidence/ and quarantine/');
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
    async presignPut(key, { contentType, contentLength, expiresInSeconds }) {
      assertKey(key);
      const cmd = new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: contentLength });
      // content-type and content-length are signed, so the PUT must send exactly these.
      const url = await getSignedUrl(client, cmd, { expiresIn: expiresInSeconds, signableHeaders: new Set(['content-type', 'content-length']) });
      return { url, headers: { 'content-type': contentType } };
    },
  };
}
