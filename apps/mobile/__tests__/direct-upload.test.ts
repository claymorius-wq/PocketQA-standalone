import { configureClient, resetClientConfigCache, uploadEvidence } from '../src/api/client';

// ADR 0005 §3: when the server stores evidence in R2, the app uploads straight to a
// presigned URL and the server verifies it on completion. The bearer never goes to storage.
type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
const calls: Call[] = [];
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const evidence = { id: 'ev-1', participationId: 'p-1', kind: 'screen_recording', mimeType: 'video/mp4', sizeBytes: 4, durationMs: null, taskId: null, capturedOn: 'android', createdAt: '2026-10-04T00:00:00.000Z' };
const intent = { id: 'in-1', method: 'PUT', uploadUrl: 'https://acct.r2.cloudflarestorage.com/bucket/quarantine/in-1?X-Amz-Signature=abc', headers: { 'content-type': 'video/mp4' }, expiresAt: '2026-10-04T00:15:00.000Z' };

function mockFetch(storage: 'local' | 'r2', putStatuses: number[] = [200]) {
  calls.length = 0;
  const puts = [...putStatuses];
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body });
    if (u.endsWith('/config')) return json(200, { authMode: 'local', storage, walletLogin: false, features: { testCredits: true, devnetTransfers: true }, firebase: null });
    if (u.includes('/upload-intents/in-1/complete')) return json(200, evidence);
    if (u.endsWith('/evidence/upload-intents')) return json(200, intent);
    if (u.startsWith('https://acct.r2')) return new Response('', { status: puts.shift() ?? 200 });
    if (u.endsWith('/participations/p-1/evidence')) return json(200, evidence);
    return json(404, { code: 'NOT_FOUND', message: 'x' });
  }) as unknown as typeof fetch;
}

const meta = { kind: 'screen_recording', capturedOn: 'android', clientSegmentId: 'seg-1' };
const mp4 = () => new Blob([new Uint8Array([0, 0, 0, 0x18])], { type: 'video/mp4' });

beforeEach(() => {
  resetClientConfigCache();
  configureClient({ getToken: () => 'user-session-token', onUnauthenticated: () => {} });
});

it('local storage: multipart upload to the API, as before', async () => {
  mockFetch('local');
  await uploadEvidence('p-1', meta, mp4(), 'clip.mp4');
  expect(calls.map((c) => `${c.method} ${c.url.replace(/^https?:\/\/[^/]+/, '')}`)).toEqual(['GET /config', 'POST /participations/p-1/evidence']);
});

it('r2 storage: intent → PUT to the presigned URL (no bearer) → complete', async () => {
  mockFetch('r2');
  const ev = await uploadEvidence('p-1', meta, mp4(), 'clip.mp4');
  expect(ev.id).toBe('ev-1');
  const [, create, put, complete] = calls;
  expect(create!.method).toBe('POST');
  expect(JSON.parse(String(create!.body))).toEqual({ ...meta, mimeType: 'video/mp4', sizeBytes: 4 });
  expect(put!.method).toBe('PUT');
  expect(put!.url).toBe(intent.uploadUrl);
  expect(put!.headers).toEqual({ 'content-type': 'video/mp4' });
  expect(JSON.stringify(put!.headers)).not.toMatch(/authorization|user-session-token/i);
  expect(complete!.url).toMatch(/\/evidence\/upload-intents\/in-1\/complete$/);
  expect(complete!.headers.authorization).toBe('Bearer user-session-token');
});

it('retries a failed PUT, and never completes an upload that did not arrive', async () => {
  mockFetch('r2', [503, 200]);
  await uploadEvidence('p-1', meta, mp4(), 'clip.mp4');
  expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(2);
  mockFetch('r2', [500, 500, 500]);
  await expect(uploadEvidence('p-1', meta, mp4(), 'clip.mp4')).rejects.toThrow(/upload/i);
  expect(calls.some((c) => c.url.includes('/complete'))).toBe(false);
});

it('derives the type from the file name when the blob has none', async () => {
  mockFetch('r2');
  await uploadEvidence('p-1', { ...meta, kind: 'screenshot' }, new Blob([new Uint8Array([1])]), 'shot.PNG');
  expect(JSON.parse(String(calls[1]!.body)).mimeType).toBe('image/png');
});
