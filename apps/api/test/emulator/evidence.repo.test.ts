import { MAX_EVIDENCE_BYTES_PER_PARTICIPATION, MAX_EVIDENCE_ITEMS_PER_PARTICIPATION } from '@pocket-qa/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import { runTxCtx } from '../../src/firestore/tx';
import { firestoreCoreRepo } from '../../src/repo/core/firestore';
import { evidenceInParticipationInTx, firestoreEvidenceRepo, openIntentCountInTx } from '../../src/repo/evidence/firestore';
import type { IntentRow, NewEvidence } from '../../src/repo/evidence/types';
import { deleteOrQueue, sweepStorage } from '../../src/storage/sweep';
import type { EvidenceStore } from '../../src/storage/types';
import { sha256 } from '../../src/util';
import { clearEmulator, emulatorFirestore } from './fs';

// Evidence repository on Firestore (plan §3 T4, §6; r2 §R2 rows 4–6, §R4, §R5).
const fs = emulatorFirestore();
let attempts: number[] = [];
const repo = firestoreEvidenceRepo(fs, { onAttempt: (n) => attempts.push(n) });
beforeEach(async () => {
  attempts = [];
  await clearEmulator();
});

const NOW = Date.parse('2026-10-06T10:00:00.000Z');
const TTL = 15 * 60_000;
const N = 20;

async function participation(id: string, extra: Record<string, unknown> = {}) {
  await fs.collection('participations').doc(id).set({ id, study_id: 's1', tester_id: 't1', status: 'in_progress', ...extra });
}
const intent = (id: string, seg: string, extra: Partial<IntentRow> = {}): IntentRow => ({
  id: `intent-${id}`,
  participation_id: 'p1',
  tester_id: 't1',
  kind: 'screen_recording',
  mime_type: 'video/mp4',
  declared_size: 1000,
  duration_ms: 1000,
  task_id: null,
  captured_on: 'android',
  client_segment_id: seg,
  object_key: `quarantine/intent-${id}`,
  status: 'pending',
  evidence_id: null,
  expires_at: NOW + TTL,
  ...extra,
});
const evidence = (id: string, seg: string, extra: Partial<NewEvidence> = {}): NewEvidence => ({
  id,
  participation_id: 'p1',
  kind: 'screen_recording',
  mime_type: 'video/mp4',
  size_bytes: 1000,
  duration_ms: 1000,
  task_id: null,
  captured_on: 'android',
  client_segment_id: seg,
  storage_key: `evidence/${id}`,
  ...extra,
});
const settle = <T>(ps: Promise<T>[]) => Promise.allSettled(ps);
const ok = <T>(rs: PromiseSettledResult<T>[]) => rs.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<T>[];
const errors = (rs: PromiseSettledResult<unknown>[]) => rs.filter((r) => r.status === 'rejected').map((r) => ((r as PromiseRejectedResult).reason as Error).message);
const count = async (c: string) => (await fs.collection(c).get()).size;

/** Opens an intent, claims it and finalizes it into evidence `ev-{id}`. */
async function complete(id: string, seg: string, now = NOW) {
  const i = intent(id, seg);
  await repo.openUploadIntent(i, now);
  expect(await repo.claimIntent(i.id, `ev-${id}`)).toBe(true);
  return repo.finalizeIntent(i, evidence(`ev-${id}`, seg, { storage_key: `evidence/ev-${id}` }), now);
}

describe('row 6: one open upload intent per segment (openSegments guard)', () => {
  it(`${N} concurrent intents for one segment: exactly one opens, the rest get a conflict`, async () => {
    await participation('p1');
    const rs = await settle(Array.from({ length: N }, (_, i) => repo.openUploadIntent(intent(String(i), 'seg/1'), NOW)));
    expect(ok(rs)).toHaveLength(1);
    expect(new Set(errors(rs))).toEqual(new Set(['This segment already has an open upload with different details.']));
    expect(await count('uploadIntents')).toBe(1);
    expect(await count('openSegments')).toBe(1);
    expect(await repo.openIntentCount('p1', NOW)).toBe(1);
    expect(Math.max(...attempts)).toBeGreaterThan(1); // contention really happened
  });

  it('expiry is enforced on read: an expired intent stops counting and its segment can open again', async () => {
    await participation('p1');
    await repo.openUploadIntent(intent('old', 'seg'), NOW);
    const later = NOW + TTL + 1;
    expect(await repo.findOpenIntent('p1', 'seg', later)).toBeUndefined();
    expect(await repo.openIntentCount('p1', later)).toBe(0);
    await repo.openUploadIntent(intent('new', 'seg', { expires_at: later + TTL }), later);
    expect((await repo.getIntent('intent-old'))?.status).toBe('expired');
    expect((await repo.findOpenIntent('p1', 'seg', later))?.id).toBe('intent-new');
    expect(await count('openSegments')).toBe(1);
  });

  it('an expired intent still completing blocks the segment, as the SQLite partial index does', async () => {
    await participation('p1');
    await repo.openUploadIntent(intent('c', 'seg'), NOW);
    expect(await repo.claimIntent('intent-c', 'ev-c')).toBe(true);
    await expect(repo.openUploadIntent(intent('d', 'seg', { expires_at: NOW + 3 * TTL }), NOW + 2 * TTL)).rejects.toThrow('open upload');
  });

  it('closing an intent (rejected) frees the segment and its reservation', async () => {
    await participation('p1');
    await repo.openUploadIntent(intent('r', 'seg'), NOW);
    expect(await repo.claimIntent('intent-r', 'ev-r')).toBe(true);
    await repo.releaseIntent('intent-r', 'rejected');
    expect(await count('openSegments')).toBe(0);
    expect(await repo.openIntentCount('p1', NOW)).toBe(0);
    await repo.openUploadIntent(intent('r2', 'seg'), NOW);
  });
});

describe('row 5: upload_intents.object_key UNIQUE (doc id = sha256(key))', () => {
  it(`${N} concurrent intents with one object key (different segments): exactly one`, async () => {
    await participation('p1');
    const rs = await settle(Array.from({ length: N }, (_, i) => repo.openUploadIntent(intent('same', `seg-${i}`), NOW)));
    expect(ok(rs)).toHaveLength(1);
    expect(await count('uploadIntents')).toBe(1);
    expect((await fs.collection('uploadIntents').doc(sha256('quarantine/intent-same')).get()).exists).toBe(true);
  });
});

describe('row 4: evidence UNIQUE(participation, segment) (evidenceSegments guard)', () => {
  it(`${N} concurrent multipart uploads of one segment: exactly one evidence row`, async () => {
    await participation('p1');
    const rs = await settle(Array.from({ length: N }, (_, i) => repo.addUploadedEvidence(evidence(`e${i}`, 'seg'), NOW)));
    expect(ok(rs)).toHaveLength(1);
    expect(new Set(errors(rs))).toEqual(new Set(['This segment was already uploaded.']));
    expect(await count('evidence')).toBe(1);
    expect(await repo.evidenceUsage('p1')).toEqual({ n: 1, bytes: 1000 });
  });

  it(`${N} concurrent completions of one claimed intent: exactly one evidence row, intent completed`, async () => {
    await participation('p1');
    const i = intent('x', 'seg');
    await repo.openUploadIntent(i, NOW);
    expect(await repo.claimIntent(i.id, 'ev-x')).toBe(true);
    const rs = await settle(Array.from({ length: N }, (_, k) => repo.finalizeIntent(i, evidence(`ev-x${k}`, 'seg'), NOW)));
    expect(ok(rs)).toHaveLength(1);
    expect(await count('evidence')).toBe(1);
    expect((await repo.getIntent(i.id))?.status).toBe('completed');
    expect(await count('openSegments')).toBe(0);
    expect(await repo.openIntentCount('p1', NOW)).toBe(0);
    expect(await repo.evidenceUsage('p1')).toEqual({ n: 1, bytes: 1000 });
  });

  it('a multipart upload and a completion racing for one segment: one evidence row', async () => {
    await participation('p1');
    const i = intent('m', 'seg');
    await repo.openUploadIntent(i, NOW);
    await repo.claimIntent(i.id, 'ev-m');
    const rs = await settle([
      ...Array.from({ length: N / 2 }, (_, k) => repo.addUploadedEvidence(evidence(`mp${k}`, 'seg'), NOW)),
      ...Array.from({ length: N / 2 }, (_, k) => repo.finalizeIntent(i, evidence(`fi${k}`, 'seg'), NOW)),
    ]);
    expect(ok(rs)).toHaveLength(1);
    expect(await count('evidence')).toBe(1);
  });
});

describe('claim and quota', () => {
  it(`${N} concurrent claims of one intent: exactly one wins`, async () => {
    await participation('p1');
    await repo.openUploadIntent(intent('c', 'seg'), NOW);
    const rs = await Promise.all(Array.from({ length: N }, (_, k) => repo.claimIntent('intent-c', `ev-${k}`)));
    expect(rs.filter(Boolean)).toHaveLength(1);
  });

  it('concurrent intents never reserve more than the byte quota', async () => {
    await participation('p1');
    const size = Math.floor(MAX_EVIDENCE_BYTES_PER_PARTICIPATION / 3) + 1; // only two fit
    const rs = await settle(Array.from({ length: N }, (_, i) => repo.openUploadIntent(intent(String(i), `seg-${i}`, { declared_size: size }), NOW)));
    expect(ok(rs)).toHaveLength(2);
    expect(new Set(errors(rs))).toEqual(new Set(['Evidence storage limit for this participation reached.']));
    expect(await repo.openIntentCount('p1', NOW)).toBe(2);
  });

  it('concurrent intents never exceed the item cap (stored evidence counts too)', async () => {
    await participation('p1');
    await complete('first', 'seg-first');
    const rs = await settle(Array.from({ length: MAX_EVIDENCE_ITEMS_PER_PARTICIPATION + 5 }, (_, i) => repo.openUploadIntent(intent(String(i), `seg-${i}`, { declared_size: 1 }), NOW)));
    expect(ok(rs)).toHaveLength(MAX_EVIDENCE_ITEMS_PER_PARTICIPATION - 1);
    expect(await repo.openIntentCount('p1', NOW)).toBe(MAX_EVIDENCE_ITEMS_PER_PARTICIPATION - 1);
  });

  it('a submitted participation freezes evidence', async () => {
    await participation('p1', { status: 'submitted' });
    await expect(repo.addUploadedEvidence(evidence('e', 'seg'), NOW)).rejects.toThrow('evidence is frozen');
  });
});

describe('submission vs completion (openIntentCountInTx composed into the studies transaction)', () => {
  it('never ends with a submitted participation and an intent still open; never adds evidence after submission', async () => {
    for (let round = 0; round < N; round += 1) {
      await clearEmulator();
      await participation('p1');
      const i = intent(String(round), 'seg');
      await repo.openUploadIntent(i, NOW);
      await repo.claimIntent(i.id, `ev-${round}`);
      const submit = runTxCtx(fs, async (t) => {
        const p = await t.get(fs.collection('participations').doc('p1'));
        if ((await openIntentCountInTx(t, fs, 'p1', NOW)) > 0) throw new Error('uploads open');
        if (p.data()!.status !== 'in_progress') throw new Error('not in progress');
        t.update(p.ref, { status: 'submitted' });
      });
      const finalize = repo.finalizeIntent(i, evidence(`ev-${round}`, 'seg'), NOW);
      const [s, f] = await Promise.allSettled([submit, finalize]);
      const status = (await fs.collection('participations').doc('p1').get()).data()!.status;
      const intentStatus = (await repo.getIntent(i.id))!.status;
      expect(f.status).toBe('fulfilled'); // the intent is open, so submission can't overtake it
      if (s.status === 'fulfilled') expect(status).toBe('submitted');
      expect(!(status === 'submitted' && intentStatus === 'completing')).toBe(true);
    }
  });
});

describe('transaction reruns', () => {
  it('reruns under contention leave counters exactly equal to the documents (no duplicated effect)', async () => {
    await participation('p1');
    const rs = await settle(Array.from({ length: N }, (_, i) => repo.addUploadedEvidence(evidence(`e${i}`, `seg-${i % 5}`, { size_bytes: 10 }), NOW)));
    expect(Math.max(...attempts)).toBeGreaterThan(1);
    // Losers fail only on the guard, never with a contention abort.
    expect(new Set(errors(rs))).toEqual(new Set(['This segment was already uploaded.']));
    expect(await count('evidence')).toBe(5);
    expect(await count('evidenceSegments')).toBe(5);
    expect(await repo.evidenceUsage('p1')).toEqual({ n: 5, bytes: 50 });
  });
});

describe('storage registry and deletion outbox', () => {
  it(`${N} concurrent registrations and enqueues of one key: one document each`, async () => {
    await Promise.all(Array.from({ length: N }, () => repo.registerObject('evidence/abcdefgh', NOW)));
    await Promise.all(Array.from({ length: N }, () => repo.enqueueDeletion('evidence/abcdefgh', 'failed_upload', NOW)));
    expect(await count('storageObjects')).toBe(1);
    expect(await count('storageDeletions')).toBe(1);
    expect(await repo.ownsObject('evidence/abcdefgh')).toBe(true);
    expect(await repo.dueDeletions(NOW + 60_000, 10)).toEqual([{ object_key: 'evidence/abcdefgh', attempts: 1, purpose: 'failed_upload' }]);
    await repo.deletionRetry('evidence/abcdefgh', NOW + 999_999);
    expect(await repo.dueDeletions(NOW + 60_000, 10)).toEqual([]);
    await repo.deletionDone('evidence/abcdefgh');
    expect(await count('storageDeletions')).toBe(0);
  });
});

describe('R4: the deletion gate', () => {
  function fakeStore(failing = false): EvidenceStore & { deleted: string[] } {
    const deleted: string[] = [];
    return {
      kind: 'r2',
      canDelete: true,
      deleted,
      head: async () => null,
      readRange: async () => {
        throw new Error('unused');
      },
      copy: async () => {},
      delete: async (k) => {
        if (failing) throw new Error('provider down');
        deleted.push(k);
      },
      presignPut: async () => ({ url: '', headers: {} }),
      presignGet: async () => ({ url: '' }),
    };
  }
  const deps = (store: EvidenceStore) => ({ repo: { evidence: repo, core: firestoreCoreRepo(fs) }, store, now: () => NOW });
  const refusals = async () => (await fs.collection('audit').where('action', '==', 'storage.delete_refused').get()).docs.map((d) => d.data());

  it('the Seeker archive key is refused and audited, even when registered', async () => {
    const key = 'retained-local-submissions/4aef8a84-4439-4001-89fc-2389a89924a7.mp4';
    await repo.registerObject(key, NOW);
    const store = fakeStore();
    expect(await deleteOrQueue(deps(store), key, 'account_deletion', 'user-1')).toBe(false);
    expect(store.deleted).toEqual([]);
    expect(await count('storageDeletions')).toBe(0);
    const [a] = await refusals();
    expect(a).toMatchObject({ actor_id: 'user-1', target_type: 'storage_object', target_id: sha256(key), reason: 'account_deletion: outside evidence/|quarantine/' });
    expect(JSON.stringify(a)).not.toContain('retained-local-submissions');
  });

  it('an unregistered app-shaped key is refused and audited; a registered one is deleted', async () => {
    const store = fakeStore();
    expect(await deleteOrQueue(deps(store), 'evidence/notmine123', 'failed_upload', 'user-1')).toBe(false);
    expect((await refusals())[0]).toMatchObject({ reason: 'failed_upload: not registered' });
    await repo.registerObject('quarantine/mine12345', NOW);
    expect(await deleteOrQueue(deps(store), 'quarantine/mine12345', 'failed_upload', 'user-1')).toBe(true);
    expect(store.deleted).toEqual(['quarantine/mine12345']);
  });

  it('the sweep never acts on an outbox entry outside the app prefixes (audited as system)', async () => {
    const key = 'retained-local-submissions/x';
    await repo.registerObject(key, NOW);
    await fs.collection('storageDeletions').doc(sha256(key)).set({ object_key: key, attempts: 1, next_attempt_at: NOW, created_at: NOW, purpose: 'account_deletion' });
    const store = fakeStore();
    await sweepStorage(deps(store));
    expect(store.deleted).toEqual([]);
    expect(await count('storageDeletions')).toBe(0);
    expect((await refusals())[0]).toMatchObject({ actor_id: 'system' });
  });

  it('a provider failure queues the key; the sweep retries it', async () => {
    await repo.registerObject('evidence/retry1234', NOW);
    expect(await deleteOrQueue(deps(fakeStore(true)), 'evidence/retry1234', 'failed_upload', 'u')).toBe(false);
    expect(await count('storageDeletions')).toBe(1);
    const store = fakeStore();
    await sweepStorage({ ...deps(store), now: () => NOW + 61_000 });
    expect(store.deleted).toEqual(['evidence/retry1234']);
    expect(await count('storageDeletions')).toBe(0);
  });
});

describe('sweep', () => {
  it('expires due intents (guard and reservation released), deletes failed quarantine objects once, keeps completed copies', async () => {
    await participation('p1');
    await repo.openUploadIntent(intent('a', 'seg-a'), NOW);
    await complete('b', 'seg-b');
    const store = { deleted: [] as string[] };
    const s: EvidenceStore = {
      kind: 'r2',
      canDelete: true,
      head: async () => null,
      readRange: async () => {
        throw new Error('unused');
      },
      copy: async () => {},
      delete: async (k) => void store.deleted.push(k),
      presignPut: async () => ({ url: '', headers: {} }),
      presignGet: async () => ({ url: '' }),
    };
    const d = { repo: { evidence: repo, core: firestoreCoreRepo(fs) }, store: s, now: () => NOW + TTL + 1 };
    await sweepStorage(d);
    expect((await repo.getIntent('intent-a'))?.status).toBe('expired');
    expect(await count('openSegments')).toBe(0);
    expect(store.deleted).toEqual(['quarantine/intent-a']);
    await sweepStorage(d);
    expect(store.deleted).toEqual(['quarantine/intent-a']); // marked swept: once
  });
});

describe('account export and purge', () => {
  async function seedAccount() {
    // t1 tests p1..p4 (study s1, built by b1); b9 built s9, where t2 tested p9.
    for (const id of ['p1', 'p2', 'p3', 'p4']) await participation(id);
    await participation('p9', { study_id: 's9', tester_id: 't2' });
    await fs.collection('studies').doc('s9').set({ id: 's9', builder_id: 'b9' });
    await fs.collection('studies').doc('s1').set({ id: 's1', builder_id: 'b1' });
    for (const pid of ['p1', 'p2', 'p3', 'p4']) {
      // Sequential: the seed isn't a race test, and contention on one usage doc is slow on the emulator.
      for (let k = 0; k < 18; k += 1) await repo.addUploadedEvidence(evidence(`${pid}-e${k}`, `seg-${k}`, { participation_id: pid, size_bytes: 1 }), NOW);
    }
    await repo.addUploadedEvidence(evidence('p9-e', 'seg', { participation_id: 'p9' }), NOW);
    // A direct upload (retained quarantine copy) and an open intent for t1 on p1.
    const done = intent('done', 'seg-done');
    await repo.openUploadIntent(done, NOW);
    await repo.claimIntent(done.id, 'ev-done');
    await repo.finalizeIntent(done, evidence('ev-done', 'seg-done'), NOW);
    await repo.openUploadIntent(intent('open', 'seg-open'), NOW);
    await repo.issuePlaybackToken('h1', 'p1-e0', 't1', NOW + 1);
  }

  it('exports the evidence of the user’s own participations', async () => {
    await seedAccount();
    expect((await repo.exportUser('t1')).evidence).toHaveLength(4 * 18 + 1);
    expect((await repo.exportUser('t2')).evidence.map((e) => e.id)).toEqual(['p9-e']);
  });

  it('purges in bounded transactions, queues every key, and is safe to rerun', async () => {
    await seedAccount();
    const out = await repo.purgeUser('t1', NOW);
    expect(out.evidenceIds).toHaveLength(4 * 18 + 1);
    expect(out.mediaKeys).toContain('evidence/p1-e0');
    expect(out.mediaKeys).toContain('quarantine/intent-done'); // retained copy of a completed upload
    expect(out.mediaKeys.at(-1)).toBe('quarantine/intent-open'); // open intents' keys come last
    expect(out.mediaKeys).toHaveLength(4 * 18 + 1 + 1 + 1);
    expect(await count('evidence')).toBe(1); // p9's (another builder's study) stays
    expect(await count('evidenceSegments')).toBe(1);
    expect(await count('openSegments')).toBe(0);
    expect(await count('playbackTokens')).toBe(0);
    expect((await repo.getIntent('intent-open'))?.status).toBe('expired');
    expect(await repo.evidenceUsage('p1')).toEqual({ n: 0, bytes: 0 });
    expect(await repo.openIntentCount('p1', NOW)).toBe(0);
    expect(await count('storageDeletions')).toBe(out.mediaKeys.length);
    expect(await repo.purgeUser('t1', NOW)).toEqual({ mediaKeys: [], evidenceIds: [] });
  });

  it('a builder’s purge removes evidence in their studies', async () => {
    await seedAccount();
    const out = await repo.purgeUser('b9', NOW);
    expect(out.evidenceIds).toEqual(['p9-e']);
    expect(await count('evidence')).toBe(4 * 18 + 1);
  });
});

describe('in-transaction reads for the studies domain', () => {
  it('evidenceInParticipationInTx: true only for evidence of that participation', async () => {
    await participation('p1');
    await repo.addUploadedEvidence(evidence('e1', 'seg'), NOW);
    const check = (ev: string, pid: string) => runTxCtx(fs, (t) => evidenceInParticipationInTx(t, fs, ev, pid));
    expect(await check('e1', 'p1')).toBe(true);
    expect(await check('e1', 'p2')).toBe(false);
    expect(await check('missing', 'p1')).toBe(false);
  });
});
