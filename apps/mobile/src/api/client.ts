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
  } catch {
    throw new ApiError('OFFLINE', 'Can’t reach the Pocket QA server. Check that the local API is running.', 0);
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

/** Multipart evidence upload; `file` is a web File/Blob or a native `{uri,name,type}` descriptor. */
export async function uploadEvidence(participationId: string, meta: Record<string, unknown>, file: Blob | { uri: string; name: string; type: string }) {
  const form = new FormData();
  form.append('meta', JSON.stringify(meta)); // must precede `file`
  form.append('file', file as unknown as Blob);
  const data = await send('POST', buildPath(routes.uploadEvidence.path, { id: participationId }), { body: form });
  const parsed = routes.uploadEvidence.response.safeParse(data);
  if (!parsed.success) throw new ApiError('BAD_RESPONSE', 'Unexpected upload response.', 200);
  return parsed.data;
}

export const mediaUrl = (token: string) => `${API_BASE_URL}${buildPath(routes.media.path, { token })}`;
