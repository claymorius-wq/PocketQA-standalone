import { afterEach, describe, expect, it } from 'vitest';
import { UPLOAD_INTENT_TTL_SECONDS, UploadIntent } from '@pocket-qa/contracts';
import { sweepStorage } from '../src/storage/sweep';
import { makeApp, MP4, seeded, type TestApp } from './helpers';

// Plan R5: sweepStorage in bounded, fenced slices (maxItems, deadlineMs, lease), resumable with no
// work done twice. The Firestore path is covered in test/emulator/evidence.repo.test.ts.
let t: TestApp;
afterEach(async () => t.close());

/** Counts provider deletes per key. */
function countDeletes(app: TestApp) {
  const calls = new Map<string, number>();
  const real = app.deps.store.delete.bind(app.deps.store);
  app.deps.store.delete = async (key) => {
    calls.set(key, (calls.get(key) ?? 0) + 1);
    return real(key);
  };
  return calls;
}

/** `n` registered objects waiting in the outbox, due now. */
function outbox(n: number) {
  const keys = Array.from({ length: n }, (_, i) => `evidence/outbox-${String(i).padStart(4, '0')}`);
  for (const k of keys) {
    t.s3.objects.set(`pqa-test/${k}`, { body: Buffer.from(k), contentType: 'video/mp4' });
    t.db.prepare('INSERT INTO storage_objects (object_key, created_at) VALUES (?, 0)').run(k);
    t.db.prepare(`INSERT INTO storage_deletions (object_key, attempts, next_attempt_at, created_at, purpose) VALUES (?, 1, 0, 0, 'account_deletion')`).run(k);
  }
  return keys;
}
const pendingOutbox = () => (t.db.prepare('SELECT COUNT(*) AS n FROM storage_deletions').get() as { n: number }).n;

/** Two direct uploads opened and left to expire (their quarantine objects did arrive). */
async function abandonedUploads() {
  const s = await seeded(t);
  for (const seg of ['a', 'b']) {
    const r = await t.req('POST', `/participations/${s.participationId}/evidence/upload-intents`, s.tester.token, {
      kind: 'screen_recording',
      mimeType: 'video/mp4',
      sizeBytes: MP4.length,
      capturedOn: 'android',
      clientSegmentId: seg,
    });
    const i = UploadIntent.parse(r.body);
    await fetch(i.uploadUrl, { method: 'PUT', headers: i.headers, body: MP4 });
  }
  t.clock.now += UPLOAD_INTENT_TTL_SECONDS * 1000 + 1;
}

describe('sweepStorage slices (SQLite)', () => {
  it('maxItems slices resume to completion; every object is deleted exactly once', async () => {
    t = await makeApp({ storage: 'r2' });
    await abandonedUploads(); // 2 expiries + 2 quarantine deletions
    const keys = outbox(5); // + 5 outbox deletions
    const calls = countDeletes(t);
    const runs: boolean[] = [];
    for (let i = 0; i < 10; i += 1) {
      const { complete } = await sweepStorage(t.deps, { maxItems: 2 });
      runs.push(complete);
      if (complete) break;
    }
    // 9 items at 2 per slice: 5 slices, the last one complete.
    expect(runs).toEqual([false, false, false, false, true]);
    expect(pendingOutbox()).toBe(0);
    expect((t.db.prepare(`SELECT COUNT(*) AS n FROM upload_intents WHERE status = 'pending'`).get() as { n: number }).n).toBe(0);
    for (const k of keys) expect(calls.get(k)).toBe(1);
    const quarantine = [...calls.keys()].filter((k) => k.startsWith('quarantine/'));
    expect(quarantine).toHaveLength(2);
    for (const k of quarantine) expect(calls.get(k)).toBe(1);
    expect(t.s3.keys().filter((k) => k.includes('outbox-') || k.includes('quarantine/'))).toEqual([]);
    // Nothing left: a further slice does nothing and is complete.
    expect(await sweepStorage(t.deps, { maxItems: 2 })).toEqual({ complete: true });
    expect([...calls.values()].every((n) => n === 1)).toBe(true);
  });

  it('a deadline already passed does nothing', async () => {
    t = await makeApp({ storage: 'r2' });
    outbox(3);
    const calls = countDeletes(t);
    expect(await sweepStorage(t.deps, { deadlineMs: t.clock.now })).toEqual({ complete: false });
    expect(calls.size).toBe(0);
    expect(pendingOutbox()).toBe(3);
  });

  it('a stale fence stops before any item; the current holder completes', async () => {
    t = await makeApp({ storage: 'r2' });
    outbox(3);
    const calls = countDeletes(t);
    const core = t.deps.repo.core;
    const stale = (await core.acquireLease('sweep', 'holder-1', 60_000, t.clock.now))!;
    t.clock.now += 61_000; // holder-1's lease lapsed; holder-2 takes over
    const current = (await core.acquireLease('sweep', 'holder-2', 60_000, t.clock.now))!;
    expect(current).toBeGreaterThan(stale);
    expect(await sweepStorage(t.deps, { lease: { job: 'sweep', fence: stale } })).toEqual({ complete: false });
    expect(calls.size).toBe(0);
    expect(await sweepStorage(t.deps, { lease: { job: 'sweep', fence: current } })).toEqual({ complete: true });
    expect(calls.size).toBe(3);
  });

  it('a lease that lapses mid-slice stops at the next item', async () => {
    t = await makeApp({ storage: 'r2' });
    outbox(4);
    const core = t.deps.repo.core;
    const fence = (await core.acquireLease('sweep', 'holder-1', 60_000, t.clock.now))!;
    const calls = countDeletes(t);
    const real = t.deps.store.delete;
    t.deps.store.delete = async (key) => {
      await real(key);
      t.clock.now += 61_000; // the first item outlives the lease
    };
    expect(await sweepStorage(t.deps, { lease: { job: 'sweep', fence } })).toEqual({ complete: false });
    expect(calls.size).toBe(1);
    expect(pendingOutbox()).toBe(3);
  });

  it('no slice: everything in one run, complete', async () => {
    t = await makeApp({ storage: 'r2' });
    await abandonedUploads();
    outbox(3);
    expect(await sweepStorage(t.deps)).toEqual({ complete: true });
    expect(pendingOutbox()).toBe(0);
  });
});
