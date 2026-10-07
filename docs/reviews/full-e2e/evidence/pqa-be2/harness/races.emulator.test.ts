// pqa-be2 full-E2E race / failure harness (2026-10-06). Firestore + Auth emulators only, synthetic
// data only. Lives in evidence/, NOT in apps/api/test, so it never joins anyone else's suite; it
// imports the real repositories and hosted app read-only. Run (from apps/api):
//   firebase emulators:exec --only firestore,auth --project demo-pocketqa --config ../../firebase.emu-be2.json \
//     '../../node_modules/.bin/vitest run --config ../../docs/reviews/full-e2e/evidence/pqa-be2/harness/vitest.races.config.ts'
// Every scenario ends in reconcile(): every ledger amount an integer, every ledger transaction and
// the whole ledger summing to 0, every account document equal to the sum of its own entries (total
// and per kind), no negative study account, a closed study at exactly 0.
import type { FastifyInstance } from 'fastify';
import type { Firestore, Transaction } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { firestoreCoreRepo } from '../../../../../../apps/api/src/repo/core/firestore';
import { firestoreStudiesRepo } from '../../../../../../apps/api/src/repo/studies/firestore';
import { buildHostedApp, hostedDeps, type HostedDeps } from '../../../../../../apps/api/src/hosted/app';
import { newId } from '../../../../../../apps/api/src/util';
import type { UserRow } from '../../../../../../apps/api/src/views/core';
import { FakeS3 } from '../../../../../../apps/api/test/fakeS3';
import { clearEmulator, emulatorFirestore, PROJECT } from '../../../../../../apps/api/test/emulator/fs';

const N = 20;
const T0 = Date.parse('2026-10-06T10:00:00.000Z');
const DAY = 24 * 3600 * 1000;
const WINDOW = 7 * DAY; // DISPUTE_WINDOW_MS
const obs = (id: string, o: unknown) => process.stdout.write(`[E-OBS ${id}] ${JSON.stringify(o)}\n`);

const fs = emulatorFirestore();
const core = firestoreCoreRepo(fs);

// ── Fault injection: a Firestore whose transactions can fail mid-flush or "crash" after commit ──
type Fault = { kind: 'none' } | { kind: 'midFlush'; ledgerCreatesBeforeThrow: number } | { kind: 'afterCommit' };
let fault: Fault = { kind: 'none' };
const faultyFs: Firestore = new Proxy(fs, {
  get(target, prop, recv) {
    if (prop === 'runTransaction') {
      return async (cb: (tx: Transaction) => Promise<unknown>, opts: unknown) => {
        const f = fault;
        let ledgerCreates = 0;
        const out = await target.runTransaction((tx) => {
          ledgerCreates = 0;
          const wrapped = new Proxy(tx, {
            get(t, p) {
              if (p === 'create' && f.kind === 'midFlush') {
                return (ref: { path: string }, data: unknown) => {
                  if (ref.path.startsWith('ledger/') && ++ledgerCreates > f.ledgerCreatesBeforeThrow) {
                    throw new Error(`injected failure mid-settlement after ${f.ledgerCreatesBeforeThrow} ledger write(s) were applied to the transaction`);
                  }
                  return (t.create as (...a: unknown[]) => unknown)(ref, data);
                };
              }
              const v = Reflect.get(t, p, t);
              return typeof v === 'function' ? v.bind(t) : v;
            },
          });
          return cb(wrapped);
        }, opts as never);
        if (f.kind === 'afterCommit') throw new Error('injected crash after commit (response lost)');
        return out;
      };
    }
    const v = Reflect.get(target, prop, recv);
    return typeof v === 'function' ? v.bind(target) : v;
  },
});
const repo = firestoreStudiesRepo(fs);
const faultyRepo = firestoreStudiesRepo(faultyFs);

// ── Fixtures (synthetic) ──────────────────────────────────────────────────────────────────
const device = JSON.stringify({ platform: 'android', androidApiLevel: 35, languages: ['en'] });
let seq = 0;
async function user(role: UserRow['role'] = 'tester'): Promise<UserRow> {
  const id = `pqa-e2e-${role}-${++seq}-${newId().slice(0, 8)}`;
  const u: UserRow = { id, email: `${id}@example.test`, password_hash: null, display_name: `QA synthetic ${role} ${seq}`, role, status: 'active', device_json: device, created_at: '2026-10-06T00:00:00.000Z' };
  expect(await core.createUser(u)).toBe('created');
  return u;
}
async function draft(builder: UserRow, o: { slots: number; reward: number }) {
  const id = newId();
  await repo.createStudy({
    id, builderId: builder.id, title: 'QA synthetic race study', objective: 'Race and failure proof (synthetic)', buildUnderTest: null,
    deviceCriteriaJson: JSON.stringify({ platforms: ['android', 'web'], minAndroidApi: null, languages: ['en'] }),
    rewardCredits: o.reward, slots: o.slots, consentText: 'I agree to this synthetic QA study recording.',
    tasks: [{ instruction: 'Open the app' }], taskIds: [], createdAt: '2026-10-06T09:00:00.000Z', escrow: null,
  });
  return id;
}
async function published(builder: UserRow, o: { slots: number; reward: number }) {
  await repo.topUp(builder.id, o.slots * o.reward, T0);
  const id = await draft(builder, o);
  await repo.studyTransition(id, builder, 'publish', false, T0);
  return id;
}
const join = (studyId: string, tester: UserRow) => repo.consent({ studyId, tester, consentVersion: 1, settlementEnabled: false, id: newId(), nowMs: T0 });
async function submitted(studyId: string, tester: UserRow) {
  const p = await join(studyId, tester);
  await repo.testerTransition(p.id, tester, 'start', null, T0);
  return repo.testerTransition(p.id, tester, 'submit', null, T0);
}
const approve = (r: typeof repo, pid: string, builder: UserRow, now = T0) => r.decideParticipation(pid, { by: 'builder', actor: builder, decision: 'approve', helpful: false }, now);
const reject = (pid: string, builder: UserRow, now = T0) => repo.decideParticipation(pid, { by: 'builder', actor: builder, decision: 'reject', reason: 'QA synthetic rejection reason', helpful: false }, now);

/** Concurrent run; exhausted-contention losers (nothing written, client retries) are rerun one by one. */
const isContention = (e: unknown) => {
  const x = e as { code?: unknown; message?: string };
  return x.code === 10 || (x.code === 3 && /Transaction is invalid or closed/.test(x.message ?? '')) || /contention|ABORTED|busy right now/i.test(x.message ?? '');
};
let reruns = 0;
async function race<T>(fns: (() => Promise<T>)[]): Promise<PromiseSettledResult<T>[]> {
  const out = await Promise.allSettled(fns.map((f) => f()));
  for (let i = 0; i < out.length; i++) {
    const r = out[i]!;
    if (r.status === 'rejected' && isContention(r.reason)) {
      reruns++;
      out[i] = (await Promise.allSettled([fns[i]!()]))[0]!;
    }
  }
  return out;
}
const codes = (rs: PromiseSettledResult<unknown>[]) => {
  const m: Record<string, number> = {};
  for (const r of rs) {
    const k = r.status === 'fulfilled' ? 'ok' : String((r.reason as { code?: string }).code ?? (r.reason as Error).message);
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
};

type Entry = { id: string; tx_id: string; account: string; amount: number; kind: string; participation_id: string | null; study_id: string | null };
async function reconcile(label: string) {
  const entries = (await fs.collection('ledger').get()).docs.map((d) => d.data() as Entry);
  const accounts = (await fs.collection('accounts').get()).docs.map((d) => d.data() as { account: string; balance: number; by_kind: Record<string, number> });
  const nonInteger = entries.filter((e) => !Number.isInteger(e.amount)).length;
  const txSums = new Map<string, number>();
  for (const e of entries) txSums.set(e.tx_id, (txSums.get(e.tx_id) ?? 0) + e.amount);
  const unbalancedTx = [...txSums.values()].filter((s) => s !== 0).length;
  const total = entries.reduce((s, e) => s + e.amount, 0);
  const mismatches: string[] = [];
  for (const a of accounts) {
    const own = entries.filter((e) => e.account === a.account);
    const sum = own.reduce((s, e) => s + e.amount, 0);
    if (sum !== a.balance || !Number.isInteger(a.balance)) mismatches.push(`${a.account}: doc ${a.balance} vs entries ${sum}`);
    const kinds = new Set([...Object.keys(a.by_kind), ...own.map((e) => e.kind)]);
    for (const k of kinds) {
      const ks = own.filter((e) => e.kind === k).reduce((s, e) => s + e.amount, 0);
      if ((a.by_kind[k] ?? 0) !== ks) mismatches.push(`${a.account}.${k}: doc ${a.by_kind[k]} vs entries ${ks}`);
    }
  }
  const studies = (await fs.collection('studies').get()).docs.map((d) => d.data() as { id: string; status: string });
  const bal = (acct: string) => accounts.find((a) => a.account === acct)?.balance ?? 0;
  const negativeStudy = studies.filter((s) => bal(`study:${s.id}`) < 0).map((s) => s.id);
  const closedNonZero = studies.filter((s) => s.status === 'closed' && bal(`study:${s.id}`) !== 0).map((s) => s.id);
  const rewardGuards = (await fs.collection('ledgerRewards').get()).size;
  const positiveRewardEntries = entries.filter((e) => (e.kind === 'reward_credit' || e.kind === 'dispute_credit') && e.amount > 0).length;
  const r = { label, entries: entries.length, transactions: txSums.size, total, nonInteger, unbalancedTx, accountMismatches: mismatches, negativeStudy, closedNonZero, rewardGuards, positiveRewardEntries };
  obs('reconcile', r);
  expect(nonInteger).toBe(0);
  expect(unbalancedTx).toBe(0);
  expect(total).toBe(0);
  expect(mismatches).toEqual([]);
  expect(negativeStudy).toEqual([]);
  expect(closedNonZero).toEqual([]);
  expect(rewardGuards).toBe(positiveRewardEntries);
  return { bal, entries };
}
const sumKind = (entries: Entry[], acct: string, kind: string) => entries.filter((e) => e.account === acct && e.kind === kind).reduce((s, e) => s + e.amount, 0);

beforeEach(async () => {
  await clearEmulator();
  fault = { kind: 'none' };
  reruns = 0;
});

// ── Repository-level races (test credits: the frozen hosted deployment's settlement model) ──────
describe('E-capacity: N testers race for the LAST slot', () => {
  it(`${N} testers join a 3-slot study that already has 2: exactly 1 joins, ${N - 1} refused, slots and holds exact`, async () => {
    const b = await user('builder');
    const sid = await published(b, { slots: 3, reward: 25 });
    await join(sid, await user());
    await join(sid, await user());
    const testers = await Promise.all(Array.from({ length: N }, () => user()));
    const rs = await race(testers.map((t) => () => join(sid, t)));
    const filled = await repo.slotsFilled(sid);
    const c = codes(rs);
    const { bal } = await reconcile('capacity');
    obs('E-capacity', { slots: 3, preJoined: 2, racers: N, outcomes: c, contentionReruns: reruns, slotsFilledAfter: filled, studyAccountBalance: bal(`study:${sid}`), builderBalance: bal(`user:${b.id}`) });
    expect(c.ok).toBe(1);
    expect(filled).toBe(3);
    expect(bal(`study:${sid}`)).toBe(75);
  });
});

describe('E-budget-exhaustion', () => {
  it(`a builder funded for 2 studies publishes 5 concurrently: exactly 2 publish, 3 BUDGET_INSUFFICIENT, balance never negative`, async () => {
    const b = await user('builder');
    await repo.topUp(b.id, 100, T0);
    const ids = await Promise.all(Array.from({ length: 5 }, () => draft(b, { slots: 2, reward: 20 }))); // 40 each
    const rs = await race(ids.map((id) => () => repo.studyTransition(id, b, 'publish', false, T0)));
    const statuses = await Promise.all(ids.map(async (id) => (await repo.getStudy(id))!.status));
    const c = codes(rs);
    const { bal } = await reconcile('budget-exhaustion');
    obs('E-budget-exhaustion', { topUp: 100, perStudyReserve: 40, publishes: 5, outcomes: c, contentionReruns: reruns, statuses, builderBalanceAfter: bal(`user:${b.id}`) });
    expect(c.ok).toBe(2);
    expect(c.BUDGET_INSUFFICIENT).toBe(3);
    expect(bal(`user:${b.id}`)).toBe(20);
  });

  it('a fully committed study (every slot held) refuses one more tester; approvals never exceed the reserve', async () => {
    const b = await user('builder');
    const sid = await published(b, { slots: 2, reward: 30 });
    const ps = [await submitted(sid, await user()), await submitted(sid, await user())];
    const extra = await join(sid, await user()).then(() => 'ok', (e) => (e as { code?: string }).code);
    await Promise.all(ps.map((p) => approve(repo, p.id, b)));
    const st = await repo.getStudy(sid);
    const { bal, entries } = await reconcile('budget-full');
    obs('E-budget-exhaustion/full', { slots: 2, reward: 30, thirdJoin: extra, studyStatus: st!.status, studyAccountAfterApprovals: bal(`study:${sid}`), rewardCredited: entries.filter((e) => e.kind === 'reward_credit' && e.amount > 0).reduce((s, e) => s + e.amount, 0) });
    expect(extra).not.toBe('ok');
    expect(bal(`study:${sid}`)).toBe(0);
  });
});

describe('E-approvals: concurrent and duplicate approvals', () => {
  it('5 submissions × 4 duplicate approves each, all 20 concurrent: each paid exactly once, budget exact', async () => {
    const b = await user('builder');
    const sid = await published(b, { slots: 5, reward: 17 });
    const testers = await Promise.all(Array.from({ length: 5 }, () => user()));
    const ps = [];
    for (const t of testers) ps.push(await submitted(sid, t));
    const rs = await race(ps.flatMap((p) => Array.from({ length: 4 }, () => () => approve(repo, p.id, b))));
    const c = codes(rs);
    const { bal, entries } = await reconcile('approvals');
    const perTester = testers.map((t) => sumKind(entries, `user:${t.id}`, 'reward_credit'));
    obs('E-approvals', { submissions: 5, requests: 20, outcomes: c, contentionReruns: reruns, perTesterCredits: perTester, studyAccountAfter: bal(`study:${sid}`) });
    expect(c.ok).toBe(5);
    expect(perTester).toEqual([17, 17, 17, 17, 17]);
    expect(bal(`study:${sid}`)).toBe(0);
  });
});

describe('E-crash: failure injected mid-settlement, and a crash after commit', () => {
  it('a failure inside the approval transaction after a ledger write was applied leaves nothing; the retry credits once', async () => {
    const b = await user('builder');
    const t = await user();
    const sid = await published(b, { slots: 1, reward: 50 });
    const p = await submitted(sid, t);
    fault = { kind: 'midFlush', ledgerCreatesBeforeThrow: 1 };
    const first = await approve(faultyRepo, p.id, b).then(() => 'ok', (e) => (e as Error).message);
    fault = { kind: 'none' };
    const afterFail = {
      participation: (await repo.getParticipation(p.id))!.status,
      ledgerEntriesForParticipation: (await fs.collection('ledger').where('participation_id', '==', p.id).get()).size,
      rewardGuard: (await fs.collection('ledgerRewards').doc(`${p.id}:reward_credit`).get()).exists,
      testerBalance: (await repo.accountBalance(`user:${t.id}`)),
    };
    await reconcile('crash-midflush-after-fail');
    const retry = await approve(repo, p.id, b).then((r) => r.status, (e) => (e as { code?: string }).code);
    const again = await approve(repo, p.id, b).then((r) => r.status, (e) => (e as { code?: string }).code);
    const { bal, entries } = await reconcile('crash-midflush-after-retry');
    obs('E-crash/midflush', { firstAttempt: first, afterFail, retry, secondRetry: again, testerCredits: sumKind(entries, `user:${t.id}`, 'reward_credit'), studyAccount: bal(`study:${sid}`) });
    expect(first).toMatch(/injected failure mid-settlement/);
    expect(afterFail).toEqual({ participation: 'submitted', ledgerEntriesForParticipation: 0, rewardGuard: false, testerBalance: 0 });
    expect(retry).toBe('approved');
    expect(again).toBe('CONFLICT_STATE');
    expect(sumKind(entries, `user:${t.id}`, 'reward_credit')).toBe(50);
  });

  it('a crash after the approval committed (response lost): N client retries never credit twice', async () => {
    const b = await user('builder');
    const t = await user();
    const sid = await published(b, { slots: 1, reward: 50 });
    const p = await submitted(sid, t);
    fault = { kind: 'afterCommit' };
    const first = await approve(faultyRepo, p.id, b).then(() => 'ok', (e) => (e as Error).message);
    fault = { kind: 'none' };
    const retries = codes(await race(Array.from({ length: N }, () => () => approve(repo, p.id, b))));
    const { entries } = await reconcile('crash-after-commit');
    obs('E-crash/after-commit', { firstAttempt: first, participation: (await repo.getParticipation(p.id))!.status, concurrentRetries: retries, testerCredits: sumKind(entries, `user:${t.id}`, 'reward_credit') });
    expect(first).toMatch(/after commit/);
    expect(retries.CONFLICT_STATE).toBe(N);
    expect(sumKind(entries, `user:${t.id}`, 'reward_credit')).toBe(50);
  });

  it('a failure mid-close (release posting) leaves the study published and funded; the retry releases once', async () => {
    const b = await user('builder');
    const sid = await published(b, { slots: 3, reward: 10 });
    fault = { kind: 'midFlush', ledgerCreatesBeforeThrow: 1 };
    const first = await faultyRepo.studyTransition(sid, b, 'close', false, T0).then(() => 'ok', (e) => (e as Error).message);
    fault = { kind: 'none' };
    const mid = { status: (await repo.getStudy(sid))!.status, study: await repo.accountBalance(`study:${sid}`), builder: await repo.accountBalance(`user:${b.id}`) };
    const retries = codes(await race(Array.from({ length: N }, () => () => repo.studyTransition(sid, b, 'close', false, T0))));
    const { bal, entries } = await reconcile('crash-close');
    obs('E-crash/close', { firstAttempt: first, afterFail: mid, concurrentRetries: retries, statusAfter: (await repo.getStudy(sid))!.status, builderBalance: bal(`user:${b.id}`), studyAccount: bal(`study:${sid}`), releaseEntries: entries.filter((e) => e.kind === 'study_release').length });
    expect(mid).toEqual({ status: 'published', study: 30, builder: 0 });
    expect(retries.ok).toBe(1);
    expect(bal(`user:${b.id}`)).toBe(30);
  });
});

describe('E-dispute-refund races', () => {
  it('close at the dispute-window boundary races a dispute: exactly one of {dispute opened, study closed}', async () => {
    const outcomes: string[] = [];
    for (let trial = 0; trial < 5; trial++) {
      await clearEmulator();
      const b = await user('builder');
      const t = await user();
      const sid = await published(b, { slots: 2, reward: 20 });
      const p = await submitted(sid, t);
      await reject(p.id, b, T0);
      // The tester's clock says "window still open" (T0+W−1ms); the builder's says "ended" (T0+W+1ms).
      const fns: (() => Promise<string>)[] = [];
      for (let i = 0; i < 10; i++) {
        fns.push(() => repo.openDispute(p.id, t, 'QA synthetic dispute reason', newId(), T0 + WINDOW - 1).then(() => 'dispute'));
        fns.push(() => repo.studyTransition(sid, b, 'close', false, T0 + WINDOW + 1).then(() => 'close'));
      }
      const rs = await race(fns);
      const okKinds = [...new Set(rs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])))];
      const disputes = (await fs.collection('disputes').where('participation_id', '==', p.id).get()).size;
      const status = (await repo.getStudy(sid))!.status;
      const { bal } = await reconcile(`boundary-trial-${trial}`);
      outcomes.push(`${okKinds.sort().join('+')}|ok=${codes(rs).ok}|disputes=${disputes}|study=${status}|studyAcct=${bal(`study:${sid}`)}|builder=${bal(`user:${b.id}`)}`);
    }
    obs('E-dispute-refund/boundary', { trials: outcomes, contentionReruns: reruns });
    // Expected: never both. Observed both => bug (see bugs/E-08.md).
    expect(outcomes.filter((o) => o.startsWith('close+dispute'))).toEqual([]);
  });

  it('BUG repro (deterministic): a dispute whose request time precedes a close commits on the closed study; the overturn pays from the released budget', async () => {
    const b = await user('builder');
    const admin = await user('admin');
    const t = await user();
    const sid = await published(b, { slots: 2, reward: 20 });
    const p = await submitted(sid, t);
    await reject(p.id, b, T0);
    // 1) Builder closes just after the window ends: allowed, full 40 released to the builder.
    await repo.studyTransition(sid, b, 'close', false, T0 + WINDOW + 1);
    const afterClose = { study: (await repo.getStudy(sid))!.status, studyAcct: await repo.accountBalance(`study:${sid}`), builder: await repo.accountBalance(`user:${b.id}`) };
    // 2) The tester's dispute request was received 2 ms earlier (its handler took now = T0+W−1) and
    //    commits after the close: openDispute checks only the window, never study.status.
    const dispute = await repo.openDispute(p.id, t, 'QA synthetic dispute reason', newId(), T0 + WINDOW - 1).then((d) => d, (e) => e as { code?: string });
    const disputeOutcome = 'id' in dispute ? 'opened' : String(dispute.code);
    // 3) Admin overturns.
    let overturn = 'not attempted';
    if ('id' in dispute) overturn = await repo.resolveDispute(dispute.id, admin, 'overturned', 'QA synthetic overturn', T0 + WINDOW + 10).then(() => 'ok', (e) => String((e as { code?: string }).code ?? (e as Error).message));
    const entries = (await fs.collection('ledger').get()).docs.map((d) => d.data() as Entry);
    const after = { studyAcct: await repo.accountBalance(`study:${sid}`), builder: await repo.accountBalance(`user:${b.id}`), tester: await repo.accountBalance(`user:${t.id}`), testerDisputeCredit: sumKind(entries, `user:${t.id}`, 'dispute_credit'), builderRelease: sumKind(entries, `user:${b.id}`, 'study_release') };
    const studyView = await Promise.resolve().then(async () => {
      const { studyBudget } = await import('../../../../../../packages/domain/src/ledger');
      const by = ((await fs.collection('accounts').doc(`study:${sid}`).get()).data() as { by_kind: Record<string, number> }).by_kind;
      try {
        return studyBudget({ reserved: by.study_reserve ?? 0, awarded: -((by.reward_credit ?? 0) + (by.dispute_credit ?? 0)), released: -(by.study_release ?? 0), rewardCredits: 20, committingCount: 0, closed: true });
      } catch (e) {
        return `throws ${(e as { code?: string }).code}: ${(e as Error).message}`;
      }
    });
    obs('E-dispute-refund/BUG-closed-study-dispute', { afterClose, disputeOnClosedStudy: disputeOutcome, overturn, after, studyBudgetView: studyView, minted: after.builder + after.tester - 40 });
    // Expected (no double settlement): the dispute is refused on a closed study, or the overturn
    // cannot pay from a released budget. Either way builder + tester never exceed the 40 funded.
    expect(after.builder + after.tester).toBeLessThanOrEqual(40);
    expect(after.studyAcct).toBeGreaterThanOrEqual(0);
  });

  it(`overturn ×${N / 2} races close ×${N / 2}: one dispute credit; close only after resolution; refund = reserve − awards`, async () => {
    const b = await user('builder');
    const admin = await user('admin');
    const t = await user();
    const sid = await published(b, { slots: 3, reward: 20 });
    const p = await submitted(sid, t);
    await reject(p.id, b, T0);
    const d = await repo.openDispute(p.id, t, 'QA synthetic dispute reason', newId(), T0 + 1000);
    const fns: (() => Promise<string>)[] = [];
    for (let i = 0; i < N / 2; i++) {
      fns.push(() => repo.resolveDispute(d.id, admin, 'overturned', 'QA synthetic overturn', T0 + 2000).then(() => 'overturn'));
      fns.push(() => repo.studyTransition(sid, b, 'close', false, T0 + 2000).then(() => 'close'));
    }
    const rs = await race(fns);
    const okBy = rs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    let status = (await repo.getStudy(sid))!.status;
    let closedLater = false;
    if (status !== 'closed') {
      await repo.studyTransition(sid, b, 'close', false, T0 + 3000);
      closedLater = true;
      status = (await repo.getStudy(sid))!.status;
    }
    const { bal, entries } = await reconcile('overturn-vs-close');
    obs('E-dispute-refund/overturn-vs-close', { outcomes: codes(rs), okBy: okBy.sort(), closedAfterRaceByFollowUp: closedLater, studyStatus: status, testerDisputeCredit: sumKind(entries, `user:${t.id}`, 'dispute_credit'), builderRelease: sumKind(entries, `user:${b.id}`, 'study_release'), builderBalance: bal(`user:${b.id}`), studyAccount: bal(`study:${sid}`) });
    expect(okBy.filter((x) => x === 'overturn')).toHaveLength(1);
    expect(okBy.filter((x) => x === 'close').length).toBeLessThanOrEqual(1);
    expect(sumKind(entries, `user:${t.id}`, 'dispute_credit')).toBe(20);
    expect(bal(`user:${b.id}`)).toBe(40);
  });

  it(`last approval ×${N / 2} races close ×${N / 2}, then ${N} concurrent closes: one credit, one release`, async () => {
    const b = await user('builder');
    const t = await user();
    const sid = await published(b, { slots: 4, reward: 15 });
    const p = await submitted(sid, t);
    const fns: (() => Promise<string>)[] = [];
    for (let i = 0; i < N / 2; i++) {
      fns.push(() => approve(repo, p.id, b).then(() => 'approve'));
      fns.push(() => repo.studyTransition(sid, b, 'close', false, T0).then(() => 'close'));
    }
    const rs = await race(fns);
    const okBy = rs.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])).sort();
    const closes = codes(await race(Array.from({ length: N }, () => () => repo.studyTransition(sid, b, 'close', false, T0))));
    const { bal, entries } = await reconcile('approve-vs-close');
    obs('E-dispute-refund/approve-vs-close', { race: codes(rs), okBy, thenConcurrentCloses: closes, testerCredit: sumKind(entries, `user:${t.id}`, 'reward_credit'), releaseEntries: entries.filter((e) => e.kind === 'study_release' && e.account === `user:${b.id}`).length, builderBalance: bal(`user:${b.id}`), studyAccount: bal(`study:${sid}`) });
    expect(okBy.filter((x) => x === 'approve')).toHaveLength(1);
    expect(sumKind(entries, `user:${t.id}`, 'reward_credit')).toBe(15);
    expect(entries.filter((e) => e.kind === 'study_release' && e.account === `user:${b.id}`)).toHaveLength(1);
    expect(bal(`user:${b.id}`)).toBe(45);
  });
});

// ── Hosted app over HTTP (the deployed code path) on the emulators ──────────────────────────
const AUTH = process.env.FIREBASE_AUTH_EMULATOR_HOST!;
const s3 = new FakeS3();
let deps: HostedDeps;
let app: FastifyInstance;
const hostedEnv = () => ({
  POCKETQA_DATA_BACKEND: 'firestore', POCKETQA_AUTH_MODE: 'firebase', POCKETQA_FIREBASE_PROJECT_ID: PROJECT,
  POCKETQA_FIREBASE_WEB_API_KEY: 'emulator-key', // check-secrets: allow (placeholder)
  POCKETQA_FIREBASE_AUTH_EMULATOR_HOST: AUTH, FIREBASE_AUTH_EMULATOR_HOST: AUTH, FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
  POCKETQA_STORAGE: 'r2', POCKETQA_R2_ACCOUNT_ID: '0'.repeat(32), POCKETQA_R2_BUCKET: 'pqa-test', POCKETQA_R2_ACCESS_KEY_ID: 'test-key',
  POCKETQA_R2_SECRET_ACCESS_KEY: 'test-secret', // check-secrets: allow (placeholder)
  POCKETQA_R2_ENDPOINT: `http://127.0.0.1:${s3.port}`, POCKETQA_R2_ALLOW_DELETE: '1', POCKETQA_SETTLEMENT: 'simulated', CRON_SECRET: 'c'.repeat(40),
});
async function rest(path: string, body: unknown) {
  const res = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/${path}?key=emulator-key`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return (await res.json()) as Record<string, string>;
}
const call = async (method: string, url: string, token?: string, payload?: unknown, headers: Record<string, string> = {}) => {
  const r = await app.inject({ method: method as 'GET', url, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers }, ...(payload ? { payload: payload as object } : {}) });
  return { status: r.statusCode, body: r.body ? r.json() : null };
};
async function firebaseUser(tag: string) {
  const email = `pqa-e2e-${tag}-${newId().slice(0, 8)}@example.test`;
  const up = await rest('accounts:signUp', { email, password: 'QA synthetic password 1', returnSecureToken: true });
  const { getAuth } = await import('firebase-admin/auth');
  const { getApps } = await import('firebase-admin/app');
  await getAuth(getApps().find((a) => a.name === `pocketqa-${PROJECT}`)!).updateUser(up.localId!, { emailVerified: true });
  return (await rest('accounts:signInWithPassword', { email, password: 'QA synthetic password 1', returnSecureToken: true })).idToken!;
}
async function account(role: 'builder' | 'tester') {
  const token = await firebaseUser(role);
  const r = await call('POST', '/auth/identity/session', token, { newAccount: { role, displayName: `QA synthetic ${role}` } });
  expect(r.status).toBe(200);
  return token;
}
async function httpSubmitted(builder: string, slots = 2, reward = 30) {
  expect((await call('POST', '/me/credits/test-topup', builder, { amount: slots * reward })).status).toBe(200);
  const st = await call('POST', '/studies', builder, { title: 'QA synthetic HTTP study', objective: 'Idempotency proof (synthetic)', tasks: [{ instruction: 'Open the app home' }], deviceCriteria: { platforms: ['android', 'web'], minAndroidApi: null, languages: ['en'] }, rewardCredits: reward, slots, consentText: 'I agree to this synthetic QA study recording.' });
  expect(st.status).toBe(200);
  expect((await call('POST', `/studies/${st.body.id}/publish`, builder)).status).toBe(200);
  const tester = await account('tester');
  expect((await call('PUT', '/me/device', tester, { platform: 'android', osVersion: '15', androidApiLevel: 35, model: 'QA synthetic device', languages: ['en'] })).status).toBe(200);
  const p = await call('POST', `/studies/${st.body.id}/consent`, tester, { consentVersion: 1, accepted: true });
  expect(p.status).toBe(200);
  expect((await call('POST', `/participations/${p.body.id}/start`, tester)).status).toBe(200);
  expect((await call('POST', `/participations/${p.body.id}/submit`, tester)).status).toBe(200);
  return { studyId: st.body.id as string, pid: p.body.id as string, tester };
}

describe('E-hosted: the hosted app over HTTP on the emulators', () => {
  beforeAll(async () => {
    await s3.start();
    deps = hostedDeps(hostedEnv());
    app = await buildHostedApp(deps, { cronLeaseWaitMs: 2_000 });
    await app.ready();
  });
  afterAll(async () => {
    await app?.close();
    await s3.stop();
  });

  it(`duplicate approve: ${N} concurrent with ONE Idempotency-Key, then ${N} with distinct keys: one credit; replay returns the first response`, async () => {
    const builder = await account('builder');
    const { pid, tester } = await httpSubmitted(builder);
    const key = { 'idempotency-key': `pqa-e2e-approve-${newId()}` };
    const same = await Promise.all(Array.from({ length: N }, () => call('POST', `/participations/${pid}/approve`, builder, {}, key)));
    const sameStatuses: Record<string, number> = {};
    for (const r of same) { const k = `${r.status} ${r.body?.code ?? r.body?.status ?? ''}`.trim(); sameStatuses[k] = (sameStatuses[k] ?? 0) + 1; }
    const replay = await call('POST', `/participations/${pid}/approve`, builder, {}, key);
    const reuse = await call('POST', `/participations/${pid}/approve`, builder, { note: 'different body' }, key);
    const distinct = await Promise.all(Array.from({ length: N }, () => call('POST', `/participations/${pid}/approve`, builder, {}, { 'idempotency-key': `pqa-e2e-approve-${newId()}` })));
    const distinctStatuses: Record<string, number> = {};
    for (const r of distinct) { const k = `${r.status} ${r.body?.code ?? r.body?.status ?? ''}`.trim(); distinctStatuses[k] = (distinctStatuses[k] ?? 0) + 1; }
    const credits = await call('GET', '/me/credits', tester);
    const rewardEntries = credits.body.entries.filter((e: { kind: string }) => e.kind === 'reward_credit');
    await reconcile('hosted-duplicate-approve');
    obs('E-hosted/duplicate-approve', { sameKey: sameStatuses, replay: `${replay.status} ${replay.body?.status}`, sameKeyDifferentBody: `${reuse.status} ${reuse.body?.code}`, distinctKeys: distinctStatuses, testerBalance: credits.body.balance, rewardEntries: rewardEntries.length });
    expect(Object.entries(sameStatuses).filter(([k]) => k.startsWith('200')).reduce((s, [, v]) => s + v, 0)).toBeGreaterThanOrEqual(1);
    expect(replay.status).toBe(200);
    expect(reuse.status).toBe(422);
    expect(distinctStatuses['409 CONFLICT_STATE']).toBe(N);
    expect(rewardEntries).toHaveLength(1);
    expect(credits.body.balance).toBe(30);
  });

  it('approve whose idempotency completion write failed (crash after commit): retried with the same key, credited once', async () => {
    const builder = await account('builder');
    const { pid, tester } = await httpSubmitted(builder);
    const c = deps.repo.core;
    const real = c.completeIdempotency.bind(c);
    let armed = true;
    c.completeIdempotency = async (...args) => {
      if (armed) { armed = false; throw new Error('injected crash after commit'); }
      return real(...args);
    };
    const key = { 'idempotency-key': `pqa-e2e-approve-crash-${newId()}` };
    let first, second, third;
    try {
      first = await call('POST', `/participations/${pid}/approve`, builder, {}, key);
      second = await call('POST', `/participations/${pid}/approve`, builder, {}, key);
      third = await call('POST', `/participations/${pid}/approve`, builder, {}, key);
    } finally {
      c.completeIdempotency = real;
    }
    const credits = await call('GET', '/me/credits', tester);
    const part = await call('GET', `/participations/${pid}`, builder);
    await reconcile('hosted-approve-crash');
    obs('E-hosted/approve-crash-after-commit', { first: `${first.status} ${first.body?.code ?? ''}`, retrySameKey: `${second.status} ${second.body?.code ?? second.body?.status ?? ''}`, retry2: `${third.status} ${third.body?.code ?? third.body?.status ?? ''}`, participation: part.body.status, testerBalance: credits.body.balance, rewardEntries: credits.body.entries.filter((e: { kind: string }) => e.kind === 'reward_credit').length });
    expect(part.body.status).toBe('approved');
    expect(credits.body.entries.filter((e: { kind: string }) => e.kind === 'reward_credit')).toHaveLength(1);
  });

  it('admin self-promotion and role isolation over HTTP', async () => {
    const idToken = await firebaseUser('admin-try');
    const selfAdmin = await call('POST', '/auth/identity/session', idToken, { newAccount: { role: 'admin', displayName: 'QA synthetic admin try' } });
    const builder = await account('builder');
    const other = await account('builder');
    const { pid, tester, studyId } = await httpSubmitted(builder);
    const checks = {
      selfRegisterAdmin: `${selfAdmin.status} ${selfAdmin.body?.code}`,
      testerApproves: (await call('POST', `/participations/${pid}/approve`, tester, {})).status,
      otherBuilderApproves: (await call('POST', `/participations/${pid}/approve`, other, {})).status,
      otherBuilderReadsStudy: (await call('GET', `/studies/${studyId}`, other)).status,
      builderAdminDisputes: (await call('GET', '/admin/disputes', builder)).status,
      testerAdminAudit: (await call('GET', '/admin/audit', tester)).status,
      testerModeratesSelf: (await call('POST', `/admin/moderation/users/x`, tester, { state: 'active', reason: 'QA synthetic self promote' })).status,
      builderTopUpByTester: (await call('POST', '/me/credits/test-topup', tester, { amount: 10 })).status,
      meRoleAfter: (await call('GET', '/me', tester)).body.role,
      unauthenticated: (await call('GET', '/me')).status,
    };
    obs('E-roles/http', checks);
    expect(selfAdmin.status).toBe(400);
    expect(checks.testerApproves).toBe(403);
    expect(checks.otherBuilderApproves).toBe(404);
    expect(checks.otherBuilderReadsStudy).toBe(404);
    expect(checks.builderAdminDisputes).toBe(403);
    expect(checks.testerAdminAudit).toBe(403);
    expect(checks.testerModeratesSelf).toBe(403);
    expect(checks.builderTopUpByTester).toBe(403);
    expect(checks.meRoleAfter).toBe('tester');
    expect(checks.unauthenticated).toBe(401);
  });

  it('export then erasure of a tester with an approved credit: export has their data only; erased account is gone; the ledger still reconciles', async () => {
    const builder = await account('builder');
    const { pid, tester } = await httpSubmitted(builder);
    expect((await call('POST', `/participations/${pid}/approve`, builder, {})).status).toBe(200);
    const exp = await call('POST', '/me/export', tester);
    const exportSummary = { status: exp.status, keys: Object.keys(exp.body ?? {}).sort(), participations: exp.body?.participations?.length, ledgerEntries: (exp.body?.ledger ?? exp.body?.credits?.entries ?? []).length, containsBuilderToken: JSON.stringify(exp.body).includes(builder.slice(0, 40)) };
    const wrongConfirm = await call('DELETE', '/me', tester, { confirm: 'nope' });
    const del = await call('DELETE', '/me', tester, { confirm: 'DELETE MY ACCOUNT' });
    const meAfter = await call('GET', '/me', tester);
    const rerun = await call('DELETE', '/me', tester, { confirm: 'DELETE MY ACCOUNT' });
    const builderView = await call('GET', `/participations/${pid}`, builder);
    await reconcile('hosted-erasure');
    obs('E-account/export-erasure', { export: exportSummary, deleteWrongConfirm: wrongConfirm.status, delete: del.status, meAfterDelete: `${meAfter.status} ${meAfter.body?.code ?? ''}`, deleteRerun: rerun.status, builderStillSeesParticipation: `${builderView.status} ${builderView.body?.status ?? ''}` });
    expect(exp.status).toBe(200);
    expect(wrongConfirm.status).toBe(400);
    expect(del.status).toBe(200);
    expect(meAfter.status).not.toBe(200);
  });

  it('persistence across a hosted-app restart: a new app instance reads the same state', async () => {
    const builder = await account('builder');
    const { pid, studyId, tester } = await httpSubmitted(builder, 3, 20);
    expect((await call('POST', `/participations/${pid}/approve`, builder, {})).status).toBe(200);
    const snap = async () => ({ study: (await call('GET', `/studies/${studyId}`, builder)).body, part: (await call('GET', `/participations/${pid}`, builder)).body, builderCredits: (await call('GET', '/me/credits', builder)).body, testerCredits: (await call('GET', '/me/credits', tester)).body });
    const before = await snap();
    await app.close();
    deps = hostedDeps(hostedEnv());
    app = await buildHostedApp(deps, { cronLeaseWaitMs: 2_000 });
    await app.ready();
    const after = await snap();
    obs('E-persistence/hosted-restart', { identical: JSON.stringify(before) === JSON.stringify(after), studyStatus: after.study.status, budget: after.study.budget, participation: after.part.status, builderBalance: after.builderCredits.balance, testerBalance: after.testerCredits.balance });
    expect(after).toEqual(before);
    await reconcile('hosted-restart');
  });
});
