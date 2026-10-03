import type { Readable } from 'node:stream';

/**
 * Evidence object storage (ADR 0005 §3). Keys are always server-generated; callers never
 * pass client input as a key. Objects are private: nothing here creates a public URL.
 */
export interface EvidenceStore {
  readonly kind: 'local' | 'r2';
  /** Size and entity tag of an object, or null if it does not exist. */
  head(key: string): Promise<{ size: number; etag: string } | null>;
  /** Inclusive byte range of an object, as a stream. `ifMatch` pins the exact version (else StorageChanged). */
  readRange(key: string, start: number, end: number, opts?: { ifMatch?: string }): Promise<Readable>;
  /** Server-side copy; `ifMatch` pins the source version (else StorageChanged). */
  copy(srcKey: string, dstKey: string, opts?: { ifMatch?: string }): Promise<void>;
  /** Deleting a missing object is not an error. */
  delete(key: string): Promise<void>;
  /**
   * Short-lived presigned PUT bound to `key`, the content type and the exact length.
   * A presigned URL is a bearer capability until it expires (not single use).
   */
  presignPut(key: string, opts: { contentType: string; contentLength: number; expiresInSeconds: number }): Promise<{ url: string; headers: Record<string, string> }>;
}

/** The object changed since it was inspected (ETag precondition failed). Retryable. */
export class StorageChanged extends Error {}

/** Server-generated keys only: a fixed prefix plus an id (no client input, no traversal). */
export const SAFE_KEY = /^(evidence|quarantine)\/[A-Za-z0-9_-]{8,64}$|^[A-Za-z0-9_-]{8,64}$/;
export function assertKey(key: string) {
  if (!SAFE_KEY.test(key)) throw new Error('unsafe storage key');
}

export async function readHead(store: EvidenceStore, key: string, n = 16, opts: { ifMatch?: string } = {}): Promise<Buffer> {
  const stream = await store.readRange(key, 0, n - 1, opts);
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks).subarray(0, n);
}
