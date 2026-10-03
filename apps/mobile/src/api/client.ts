import { API_DEFAULT_BASE_URL, buildPath, ErrorBody, routes, type RouteName } from '@pocket-qa/contracts';
import type { z } from 'zod';

/** Local API only. Android reaches it through `adb reverse tcp:8787 tcp:8787`. */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || API_DEFAULT_BASE_URL;

export type ClientErrorCode = z.infer<typeof ErrorBody>['code'] | 'OFFLINE' | 'BAD_RESPONSE';
export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Def<N extends RouteName> = (typeof routes)[N];
export type Response<N extends RouteName> = Def<N>['response'] extends z.ZodTypeAny ? z.infer<Def<N>['response']> : never;
export type Body<N extends RouteName> = Def<N>['body'] extends z.ZodTypeAny ? z.input<Def<N>['body']> : never;

let tokenGetter: () => string | null = () => null;
let onUnauthenticated: () => void = () => {};
export function configureClient(opts: { getToken: () => string | null; onUnauthenticated: () => void }) {
  tokenGetter = opts.getToken;
  onUnauthenticated = opts.onUnauthenticated;
}

async function send(method: string, path: string, init: { body?: BodyInit; json?: unknown; token?: string | null }) {
  const headers: Record<string, string> = {};
  const token = init.token === undefined ? tokenGetter() : init.token;
  if (token) headers.authorization = `Bearer ${token}`;
  let body = init.body;
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.json);
  }
  let res: globalThis.Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, { method, headers, ...(body !== undefined ? { body } : {}) });
  } catch (e) {
    // Only genuine network failures are "offline"; anything else (e.g. an unsupported
    // request body) must surface as a real error instead of being hidden.
    const msg = e instanceof Error ? e.message : String(e);
    if (/network|failed to fetch|fetch failed|ECONNREFUSED|timed? ?out|abort/i.test(msg)) {
      throw new ApiError('OFFLINE', 'Can’t reach the Pocket QA server. Check that the local API is running.', 0);
    }
    console.warn('[pocketqa] request failed before reaching the server:', msg);
    throw new ApiError('BAD_RESPONSE', `The request couldn’t be sent (${msg}).`, 0);
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = ErrorBody.safeParse(data);
    if (err.success && err.data.code === 'UNAUTHENTICATED' && token) onUnauthenticated();
    throw err.success ? new ApiError(err.data.code, err.data.message, res.status) : new ApiError('BAD_RESPONSE', 'Unexpected server response.', res.status);
  }
  return data;
}

/** Typed call against the shared route table; responses are validated with the contract schema. */
export async function api<N extends RouteName>(
  name: N,
  opts: { params?: Record<string, string>; body?: Body<N>; token?: string | null } = {},
): Promise<Response<N>> {
  const def = routes[name];
  const data = await send(def.method, buildPath(def.path, opts.params), {
    ...(def.body && def.body !== 'multipart' ? { json: opts.body ?? {} } : {}),
    ...(opts.token !== undefined ? { token: opts.token } : {}),
  });
  if (def.response === 'binary') return data as Response<N>;
  const parsed = def.response.safeParse(data);
  if (!parsed.success) throw new ApiError('BAD_RESPONSE', 'The server response did not match the app’s contract.', 200);
  return parsed.data as Response<N>;
}

/**
 * Multipart evidence upload. `file` must be a real Blob: the web File, or on native an
 * expo-file-system `File` (which implements Blob). Expo's fetch does not support React
 * Native's legacy `{uri,name,type}` FormData parts.
 */
export async function uploadEvidence(participationId: string, meta: Record<string, unknown>, file: Blob, filename: string) {
  if ((await getClientConfig()).storage === 'r2') return uploadDirect(participationId, meta, file, filename);
  const form = new FormData();
  form.append('meta', JSON.stringify(meta)); // must precede `file`
  form.append('file', file, filename);
  const data = await send('POST', buildPath(routes.uploadEvidence.path, { id: participationId }), { body: form });
  const parsed = routes.uploadEvidence.response.safeParse(data);
  if (!parsed.success) throw new ApiError('BAD_RESPONSE', 'Unexpected upload response.', 200);
  return parsed.data;
}

let clientConfig: Promise<Response<'clientConfig'>> | null = null;
/** Public deployment config (auth mode, storage); fetched once per app session. */
export function getClientConfig() {
  clientConfig ??= api('clientConfig').catch((e) => {
    clientConfig = null; // don't cache a failure
    throw e;
  });
  return clientConfig;
}
export function resetClientConfigCache() {
  clientConfig = null;
}

const MIME_BY_EXT: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const PUT_ATTEMPTS = 3;

/**
 * Direct upload to private storage (ADR 0005 §3): ask the API for an intent, PUT the bytes
 * to its short-lived presigned URL with exactly the signed headers (never the session
 * bearer), then ask the API to verify and complete it. Nothing counts as evidence until
 * completion succeeds; a failed PUT is retried, and never completed.
 */
async function uploadDirect(participationId: string, meta: Record<string, unknown>, file: Blob, filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const mimeType = file.type || MIME_BY_EXT[ext] || '';
  const intent = await api('createUploadIntent', { params: { id: participationId }, body: { ...meta, mimeType, sizeBytes: file.size } as Body<'createUploadIntent'> });
  let ok = false;
  for (let attempt = 1; attempt <= PUT_ATTEMPTS && !ok; attempt += 1) {
    try {
      const res = await fetch(intent.uploadUrl, { method: 'PUT', headers: intent.headers, body: file });
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!ok && attempt < PUT_ATTEMPTS) await new Promise((r) => setTimeout(r, 300 * attempt));
  }
  if (!ok) throw new ApiError('OFFLINE', 'The upload didn’t reach storage. Check your connection and try again.', 0);
  return api('completeUploadIntent', { params: { id: intent.id } });
}

export const mediaUrl = (token: string) => `${API_BASE_URL}${buildPath(routes.media.path, { token })}`;
