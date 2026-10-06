import { FAUCET, userAccount } from '@pocket-qa/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { firestoreCoreRepo } from '../../src/repo/core/firestore';
import { firestoreStudiesRepo } from '../../src/repo/studies/firestore';
import { newId } from '../../src/util';
import type { UserRow } from '../../src/views/core';
import { clearEmulator, emulatorFirestore } from './fs';

// Studies repository guards on Firestore (plan r2 §R2 rows 2, 3, 7, 8, 11): each a ≥ 20-way race,
// plus forced reruns proving that a rerun callback never duplicates its effects.
const fs = emulatorFirestore();
const core = firestoreCoreRepo(fs);
let attempts: number[] = [];
const repo = firestoreStudiesRepo(fs, { onAttempt: (n) => attempts.push(n) });
const NOW = Date.parse('2026-10-06T10:00:00.000Z');
const N = 20;

beforeEach(async () => {
  await clearEmulator();
  attempts = [];
});

const device = JSON.stringify({ platform: 'web', androidApiLevel: null, languages: ['en'] });
async function user(id: string, role: UserRow['role'] = 'tester'): Promise<UserRow> {
  const u: UserRow = { id, email: `${id}@example.test`, password_hash: null, display_name: `User ${id}`, role, status: 'active', device_json: device, created_at: '2026-10-06T00:00:00.000Z' };
  expect(await core.createUser(u)).toBe('created');
  return u;
}
async function publishedStudy(builder: UserRow, opts: { slots: number; reward: number }) {
  const id = newId();
  await repo.topUp(builder.id, opts.reward * opts.slots, NOW);
  await repo.createStudy({
    id,
    builderId: builder.id,
    title: 'Checkout flow',
    objective: 'Find friction in checkout',
    buildUnderTest: null,
    deviceCriteriaJson: JSON.stringify({ platforms: ['android', 'web'], minAndroidApi: null, languages: ['en'] }),
    rewardCredits: opts.reward,
    slots: opts.slots,
    consentText: 'I agree to record my screen for this study.',
    tasks: [{ instruction: 'Open the app' }, { instruction: 'Buy an item', successCriteria: 'Order placed' }],
    createdAt: '2026-10-06T09:00:00.000Z',
    escrow: null,
  });
  await repo.studyTransition(id, builder, 'publish', false, NOW);
  return id;
}
const join = (studyId: string, tester: UserRow, now = NOW) =>
  repo.consent({ studyId, tester, consentVersion: 1, settlementEnabled: false, id: newId(), nowMs: now });
async function submitted(studyId: string, tester: UserRow) {
  const p = await join(studyId, tester);
  await repo.testerTransition(p.id, tester, 'start', null, NOW);
  return repo.testerTransition(p.id, tester, 'submit', null, NOW);
}
/**
 * Runs the operations concurrently. A burst on one document can exhaust Firestore's transaction
 * attempts: such a loser fails whole (nothing written) with a contention error, and the client
 * retries. So contention losers are rerun one by one, and the race is judged on the final outcome
 * of every operation; any other failure is a domain outcome (the guard working).
 */
async function settle<T>(ps: (() => Promise<T>)[]): Promise<PromiseSettledResult<T>[]> {
  const out = await Promise.allSettled(ps.map((f) => f()));
  const lost = out.flatMap((r, i) => (r.status === 'rejected' && isContention(r.reason) ? [i] : []));
  if (lost.length) process.stderr.write(`[studies.guards] ${lost.length} contention loser(s): ${reasonOf(out[lost[0]!] as PromiseRejectedResult)}\n`);
  for (const i of lost) out[i] = (await Promise.allSettled([ps[i]!()]))[0]!;
  return out;
}
const isContention = (e: unknown) => {
  const x = e as { code?: unknown; message?: string };
  // ABORTED (10), or the emulator's form for a transaction it aborted under contention:
  // INVALID_ARGUMENT (3) "Transaction is invalid or closed". Either way the commit wrote nothing.
  return x.code === 10 || (x.code === 3 && /Transaction is invalid or closed/.test(x.message ?? '')) || /contention|ABORTED/i.test(x.message ?? '');
};
const reasonOf = (r: PromiseRejectedResult) => `code=${String((r.reason as { code?: unknown }).code)} ${String((r.reason as Error).message).slice(0, 80)}`;
const ok = <T>(rs: PromiseSettledResult<T>[]) => rs.filter((r) => r.status === 'fulfilled') as PromiseFulfilledResult<T>[];
const errs = <T>(rs: PromiseSettledResult<T>[]) => (rs.filter((r) => r.status === 'rejected') as PromiseRejectedResult[]).map((r) => r.reason as { code?: string; message: string });

describe('row 2: participations UNIQUE(study_id, tester_id) → participationPairs/{study}_{tester}', () => {
  it(`${N} concurrent joins by one tester: one participation, the rest CONFLICT_STATE`, async () => {
    const builder = await user('b', 'builder');
    const tester = await user('t');
    const sid = await publishedStudy(builder, { slots: 5, reward: 10 });
    const rs = await settle(Array.from({ length: N }, () => () => join(sid, tester)));
    expect(ok(rs)).toHaveLength(1);
    expect(errs(rs).filter((e) => !(e.code === 'CONFLICT_STATE' && /already joined/.test(e.message))).map((e) => `${String(e.code)} ${e.message}`)).toEqual([]);
    expect((await fs.collection('participations').where('study_id', '==', sid).get()).size).toBe(1);
    expect((await repo.findParticipation(sid, tester.id))?.id).toBe(ok(rs)[0]!.value.id);
  });

  it('a withdrawn tester still cannot join again (the guard outlives the slot, as the UNIQUE does)', async () => {
    const builder = await user('b', 'builder');
    const tester = await user('t');
    const sid = await publishedStudy(builder, { slots: 2, reward: 10 });
    const p = await join(sid, tester);
    await repo.testerTransition(p.id, tester, 'withdraw', 'changed my mind', NOW);
    await expect(join(sid, tester)).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
    expect(await repo.slotsFilled(sid)).toBe(0);
  });
});

describe('row 3: slots never oversold, budget never over-committed', () => {
  it(`${N} testers race for 3 slots: exactly 3 join, every study write reran consistently`, async () => {
    const builder = await user('b', 'builder');
    const sid = await publishedStudy(builder, { slots: 3, reward: 10 });
    const testers = await Promise.all(Array.from({ length: N }, (_, i) => user(`t${i}`)));
    attempts = [];
    const rs = await settle(testers.map((t) => () => join(sid, t)));
    expect(ok(rs)).toHaveLength(3);
    expect(errs(rs).filter((e) => !(e.code === 'CONFLICT_STATE' && /full/.test(e.message))).map((e) => `${String(e.code)} ${e.message}`)).toEqual([]);
    expect(await repo.slotsFilled(sid)).toBe(3);
    expect(((await fs.collection('studies').doc(sid).get()).data() as { join_seq: number }).join_seq).toBe(3);
    expect(Math.max(...attempts)).toBeGreaterThan(1); // the contention really forced reruns
  });

  it('a slot freed by a withdrawal can be taken again', async () => {
    const builder = await user('b', 'builder');
    const [a, b] = [await user('ta'), await user('tb')];
    const sid = await publishedStudy(builder, { slots: 1, reward: 10 });
    const p = await join(sid, a);
    await expect(join(sid, b)).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
    await repo.testerTransition(p.id, a, 'withdraw', null, NOW);
    expect((await join(sid, b)).tester_id).toBe('tb');
  });
});

describe('row 8: ledger_one_reward (participation_id, kind) → ledgerRewards/{pid}:{kind}', () => {
  it(`${N} concurrent approvals of one submission: one reward credit, budget and balances exact`, async () => {
    const builder = await user('b', 'builder');
    const tester = await user('t');
    const sid = await publishedStudy(builder, { slots: 2, reward: 25 });
    const p = await submitted(sid, tester);
    const rs = await settle(Array.from({ length: N }, () => () => repo.decideParticipation(p.id, { by: 'builder', actor: builder, decision: 'approve', helpful: false }, NOW)));
    expect(ok(rs)).toHaveLength(1);
    expect(errs(rs).filter((e) => !(e.code === 'CONFLICT_STATE')).map((e) => `${String(e.code)} ${e.message}`)).toEqual([]);
    const credits = (await fs.collection('ledger').where('participation_id', '==', p.id).get()).docs.map((d) => d.data());
    expect(credits.filter((e) => e.kind === 'reward_credit' && e.amount > 0)).toHaveLength(1);
    expect((await fs.collection('ledgerRewards').get()).docs.map((d) => d.id)).toEqual([`${p.id}:reward_credit`]);
    expect(await repo.accountBalance(userAccount(tester.id))).toBe(25);
    expect((await repo.getParticipation(p.id))?.status).toBe('approved');
    // Study account: reserve 50, reward -25.
    expect(await repo.studyKindSums(sid)).toEqual({ study_reserve: 50, reward_credit: -25 });
  });

  it(`${N} concurrent approvals across ${N} submissions of one study: every reward paid once, budget exact`, async () => {
    const builder = await user('b', 'builder');
    const sid = await publishedStudy(builder, { slots: N, reward: 5 });
    const testers = await Promise.all(Array.from({ length: N }, (_, i) => user(`t${i}`)));
    const ps = [];
    for (const t of testers) ps.push(await submitted(sid, t));
    attempts = [];
    const rs = await settle(ps.map((p) => () => repo.decideParticipation(p.id, { by: 'builder', actor: builder, decision: 'approve', helpful: false }, NOW)));
    expect(ok(rs)).toHaveLength(N);
    for (const p of ps) expect((await repo.getParticipation(p.id))?.status).toBe('approved');
    expect(await repo.studyKindSums(sid)).toEqual({ study_reserve: 5 * N, reward_credit: -5 * N });
    for (const t of testers) expect(await repo.accountBalance(userAccount(t.id))).toBe(5);
    expect(Math.max(...attempts)).toBeGreaterThan(1);
  });
});

describe('row 7: disputes.participation_id UNIQUE → disputeByParticipation/{pid}', () => {
  it(`${N} concurrent disputes of one rejection: one dispute, the rest CONFLICT_STATE`, async () => {
    const builder = await user('b', 'builder');
    const tester = await user('t');
    const sid = await publishedStudy(builder, { slots: 2, reward: 10 });
    const p = await submitted(sid, tester);
    await repo.decideParticipation(p.id, { by: 'builder', actor: builder, decision: 'reject', reason: 'The recording does not show the checkout at all.', helpful: false }, NOW);
    const rs = await settle(Array.from({ length: N }, () => () => repo.openDispute(p.id, tester, 'I did complete the checkout task.', newId(), NOW + 1000)));
    expect(ok(rs)).toHaveLength(1);
    expect(errs(rs).filter((e) => !(e.code === 'CONFLICT_STATE')).map((e) => `${String(e.code)} ${e.message}`)).toEqual([]);
    expect((await fs.collection('disputes').get()).size).toBe(1);
    expect((await repo.listDisputesByStudy(sid)).map((d) => d.id)).toEqual([ok(rs)[0]!.value.id]);
  });

  it(`${N} concurrent overturns of one dispute: one dispute credit`, async () => {
    const builder = await user('b', 'builder');
    const admin = await user('a', 'admin');
    const tester = await user('t');
    const sid = await publishedStudy(builder, { slots: 2, reward: 10 });
    const p = await submitted(sid, tester);
    await repo.decideParticipation(p.id, { by: 'builder', actor: builder, decision: 'reject', reason: 'The recording does not show the checkout at all.', helpful: false }, NOW);
    const d = await repo.openDispute(p.id, tester, 'I did complete the checkout task.', newId(), NOW + 1000);
    const rs = await settle(Array.from({ length: N }, () => () => repo.resolveDispute(d.id, admin, 'overturned', 'The video shows the order placed.', NOW + 2000)));
    expect(ok(rs)).toHaveLength(1);
    expect(errs(rs).filter((e) => !(e.code === 'CONFLICT_STATE')).map((e) => `${String(e.code)} ${e.message}`)).toEqual([]);
    expect(await repo.accountBalance(userAccount(tester.id))).toBe(10);
    expect((await fs.collection('ledgerRewards').get()).docs.map((x) => x.id)).toEqual([`${p.id}:dispute_credit`]);
    expect((await fs.collection('audit').where('action', '==', 'dispute.overturned').get()).size).toBe(1);
  });
});

describe('row 11: task_notes PK(participation_id, task_id) → participations/{pid}/notes/{taskId}', () => {
  it(`${N} concurrent edits of one note: one document, one of the written values (last write wins)`, async () => {
    const builder = await user('b', 'builder');
    const tester = await user('t');
    const sid = await publishedStudy(builder, { slots: 2, reward: 10 });
    const p = await join(sid, tester);
    await repo.testerTransition(p.id, tester, 'start', null, NOW);
    const task = (await repo.tasksOf(sid))[0]!;
    expect(ok(await settle(Array.from({ length: N }, (_, i) => () => repo.putTaskNote(p.id, tester, task.id, `note ${i}`))))).toHaveLength(N);
    const notes = await repo.taskNotes(p.id);
    expect(notes).toHaveLength(1);
    expect(notes[0]!.task_id).toBe(task.id);
    expect(notes[0]!.note).toMatch(/^note \d+$/);
  });
});

describe('forced reruns never duplicate effects', () => {
  it(`${N} concurrent top-ups of one account rerun, yet each posts exactly one balanced pair`, async () => {
    const u = await user('u', 'builder');
    attempts = [];
    expect(ok(await settle(Array.from({ length: N }, () => () => repo.topUp(u.id, 7, NOW))))).toHaveLength(N);
    expect(Math.max(...attempts)).toBeGreaterThan(1);
    expect(await repo.accountBalance(userAccount(u.id))).toBe(7 * N);
    expect(await repo.accountBalance(FAUCET)).toBe(-7 * N);
    expect((await repo.ledgerEntries(userAccount(u.id))).length).toBe(N);
    expect((await fs.collection('ledger').get()).size).toBe(2 * N);
    // The running total's sequence counts exactly the entries (no rerun left a gap or a duplicate).
    expect(((await fs.collection('accounts').doc(userAccount(u.id)).get()).data() as { seq: number }).seq).toBe(N);
  });

  it('a failed rule inside the transaction writes nothing (no guard, no entry, no participation)', async () => {
    const builder = await user('b', 'builder');
    const tester = await user('t');
    const sid = await publishedStudy(builder, { slots: 1, reward: 10 });
    await expect(repo.consent({ studyId: sid, tester, consentVersion: 2, settlementEnabled: false, id: newId(), nowMs: NOW })).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
    expect((await fs.collection('participationPairs').get()).size).toBe(0);
    expect((await fs.collection('participations').get()).size).toBe(0);
    expect((await join(sid, tester)).status).toBe('consented');
  });
});
