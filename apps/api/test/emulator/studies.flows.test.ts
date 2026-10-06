import { FAUCET, studyAccount, userAccount } from '@pocket-qa/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { firestoreCoreRepo } from '../../src/repo/core/firestore';
import { firestoreStudiesRepo } from '../../src/repo/studies/firestore';
import { newId } from '../../src/util';
import type { UserRow } from '../../src/views/core';
import { clearEmulator, emulatorFirestore } from './fs';

// Studies repository on Firestore: the same rules as the SQLite repository, end to end.
const fs = emulatorFirestore();
const core = firestoreCoreRepo(fs);
const repo = firestoreStudiesRepo(fs);
const NOW = Date.parse('2026-10-06T10:00:00.000Z');
const DAY = 24 * 3600 * 1000;
beforeEach(clearEmulator);

const device = JSON.stringify({ platform: 'web', androidApiLevel: null, languages: ['en'] });
async function user(id: string, role: UserRow['role'] = 'tester', extra: Partial<UserRow> = {}): Promise<UserRow> {
  const u: UserRow = { id, email: `${id}@example.test`, password_hash: null, display_name: `User ${id}`, role, status: 'active', device_json: device, created_at: '2026-10-06T00:00:00.000Z', ...extra };
  expect(await core.createUser(u)).toBe('created');
  return u;
}
async function draft(builder: UserRow, opts: { slots: number; reward: number; createdAt?: string }) {
  const id = newId();
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
    taskIds: [],
    createdAt: opts.createdAt ?? '2026-10-06T09:00:00.000Z',
    escrow: null,
  });
  return id;
}
async function published(builder: UserRow, opts: { slots: number; reward: number; createdAt?: string }) {
  await repo.topUp(builder.id, opts.reward * opts.slots, NOW);
  const id = await draft(builder, opts);
  await repo.studyTransition(id, builder, 'publish', false, NOW);
  return id;
}
const join = (studyId: string, tester: UserRow, now = NOW) => repo.consent({ studyId, tester, consentVersion: 1, settlementEnabled: false, id: newId(), nowMs: now });
async function submitted(studyId: string, tester: UserRow, now = NOW) {
  const p = await join(studyId, tester, now);
  await repo.testerTransition(p.id, tester, 'start', null, now);
  return repo.testerTransition(p.id, tester, 'submit', null, now);
}
/** Double entry: every account's postings, faucet included, sum to zero. */
async function ledgerSum() {
  return (await fs.collection('ledger').get()).docs.reduce((s, d) => s + (d.data().amount as number), 0);
}

describe('study lifecycle and the test-credit ledger', () => {
  it('publish reserves reward × slots, close withdraws in-flight testers and releases the rest', async () => {
    const builder = await user('b', 'builder');
    const [t1, t2] = [await user('t1'), await user('t2')];
    const sid = await published(builder, { slots: 3, reward: 10 });
    expect(await repo.accountBalance(userAccount('b'))).toBe(0);
    expect(await repo.accountBalance(studyAccount(sid))).toBe(30);
    const p1 = await submitted(sid, t1);
    const p2 = await join(sid, t2);
    await expect(repo.studyTransition(sid, builder, 'close', false, NOW)).rejects.toMatchObject({ code: 'CONFLICT_STATE' }); // submitted work pending
    await repo.decideParticipation(p1.id, { by: 'builder', actor: builder, decision: 'approve', helpful: true }, NOW);
    await repo.studyTransition(sid, builder, 'close', false, NOW);
    expect((await repo.getParticipation(p2.id))).toMatchObject({ status: 'withdrawn', decision_reason: 'Study closed by the builder.' });
    expect((await repo.getStudy(sid))?.status).toBe('closed');
    expect(await repo.accountBalance(userAccount('b'))).toBe(20);
    expect(await repo.accountBalance(userAccount('t1'))).toBe(10);
    expect(await repo.accountBalance(studyAccount(sid))).toBe(0);
    expect(await ledgerSum()).toBe(0);
    expect((await repo.ledgerEntries(userAccount('b'))).map((e) => e.kind)).toEqual(['study_release', 'study_reserve', 'test_topup']);
  });

  it('publish without enough credits fails and writes nothing', async () => {
    const builder = await user('b', 'builder');
    const sid = await draft(builder, { slots: 3, reward: 10 });
    await expect(repo.studyTransition(sid, builder, 'publish', false, NOW)).rejects.toMatchObject({ code: 'BUDGET_INSUFFICIENT' });
    expect((await repo.getStudy(sid))?.status).toBe('draft');
    expect((await fs.collection('ledger').get()).size).toBe(0);
  });

  it('only the owner can change a study (404, no existence leak); suspended studies cannot publish', async () => {
    const builder = await user('b', 'builder');
    const other = await user('o', 'builder');
    const admin = await user('a', 'admin');
    const sid = await draft(builder, { slots: 1, reward: 10 });
    await expect(repo.studyTransition(sid, other, 'publish', false, NOW)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(repo.updateDraftStudy(sid, other, { title: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const s = await repo.moderateStudy(sid, 'suspended', { actorId: admin.id, action: 'study.suspend', reason: 'Spam', nowMs: NOW });
    expect(s.moderation).toBe('suspended');
    expect((await fs.collection('audit').where('action', '==', 'study.suspend').get()).size).toBe(1);
    await repo.topUp(builder.id, 10, NOW);
    await expect(repo.studyTransition(sid, builder, 'publish', false, NOW)).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
  });

  it('a draft edit replaces its tasks and bumps the consent version only when the text changes', async () => {
    const builder = await user('b', 'builder');
    const sid = await draft(builder, { slots: 1, reward: 10 });
    await repo.updateDraftStudy(sid, builder, { title: 'New title', tasks: [{ instruction: 'Only task' }] });
    expect((await repo.getStudy(sid))).toMatchObject({ title: 'New title', consent_version: 1 });
    expect((await repo.tasksOf(sid)).map((t) => [t.order, t.instruction])).toEqual([[0, 'Only task']]);
    await repo.updateDraftStudy(sid, builder, { consentText: 'New consent text for this study.' });
    expect((await repo.getStudy(sid))?.consent_version).toBe(2);
    await expect(repo.updateDraftStudy(sid, builder, { rewardUnits: 5 })).rejects.toMatchObject({ code: 'VALIDATION' });
  });
});

describe('participations, notes, findings, disputes', () => {
  it('consent rules: open study only, current consent version, device eligibility', async () => {
    const builder = await user('b', 'builder');
    const noDevice = await user('nd', 'tester', { device_json: null });
    const tester = await user('t');
    const sid = await published(builder, { slots: 2, reward: 10 });
    await expect(repo.consent({ studyId: sid, tester, consentVersion: 9, settlementEnabled: false, id: newId(), nowMs: NOW })).rejects.toThrow(/consent text changed/);
    await expect(join(sid, noDevice)).rejects.toThrow(/Not eligible/);
    await repo.studyTransition(sid, builder, 'pause', false, NOW);
    await expect(join(sid, tester)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await core.setStatus(builder.id, 'suspended');
    await repo.studyTransition(sid, builder, 'resume', false, NOW);
    await expect(join(sid, tester)).rejects.toMatchObject({ code: 'NOT_FOUND' }); // builder not active
  });

  it('tester flow: notes while in progress only, submit, reject, dispute window, uphold', async () => {
    const builder = await user('b', 'builder');
    const admin = await user('a', 'admin');
    const tester = await user('t');
    const other = await user('x');
    const sid = await published(builder, { slots: 2, reward: 10 });
    const p = await join(sid, tester);
    const [task] = await repo.tasksOf(sid);
    await expect(repo.putTaskNote(p.id, tester, task!.id, 'early')).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
    await repo.testerTransition(p.id, tester, 'start', null, NOW);
    await expect(repo.putTaskNote(p.id, other, task!.id, 'not mine')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(repo.putTaskNote(p.id, tester, 'no-such-task', 'x')).rejects.toMatchObject({ code: 'VALIDATION' });
    await repo.putTaskNote(p.id, tester, task!.id, 'Found the cart button');
    await repo.testerTransition(p.id, tester, 'submit', null, NOW);
    await expect(repo.putTaskNote(p.id, tester, task!.id, 'late')).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
    expect(await repo.taskNotes(p.id)).toEqual([{ task_id: task!.id, note: 'Found the cart button' }]);

    const f = await repo.createFinding(p.id, builder, { title: 'Cart hidden', severity: 'major', description: 'The cart icon is below the fold.' }, newId(), NOW);
    await expect(repo.createFinding(p.id, tester, { title: 'x', severity: 'minor', description: 'y' }, newId(), NOW)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Evidence links: only evidence of this participation (evidence repo helper, in the same tx).
    await fs.collection('evidence').doc('ev-own').set({ id: 'ev-own', participation_id: p.id });
    await fs.collection('evidence').doc('ev-other').set({ id: 'ev-other', participation_id: 'someone-else' });
    const linked = await repo.createFinding(p.id, builder, { title: 'Spinner', severity: 'minor', description: 'Long spinner at pay.', evidenceId: 'ev-own', timestampMs: 1500 }, newId(), NOW);
    expect(linked).toMatchObject({ evidence_id: 'ev-own', timestamp_ms: 1500 });
    await expect(repo.createFinding(p.id, builder, { title: 'x', severity: 'minor', description: 'y', evidenceId: 'ev-other' }, newId(), NOW)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await repo.listFindings(p.id)).map((x) => x.id).sort()).toEqual([f.id, linked.id].sort());

    await expect(repo.decideParticipation(p.id, { by: 'builder', actor: builder, decision: 'reject', reason: 'short', helpful: false }, NOW)).rejects.toMatchObject({ code: 'VALIDATION' });
    const r = await repo.decideParticipation(p.id, { by: 'builder', actor: builder, decision: 'reject', reason: 'The recording does not show the checkout at all.', helpful: false }, NOW);
    expect(r).toMatchObject({ status: 'rejected', decided_by: builder.id });
    // The reward stays held while the rejection can still be disputed.
    expect((await repo.participationStatuses(sid))[0]).toMatchObject({ status: 'rejected' });
    await expect(repo.openDispute(p.id, tester, 'Too late', newId(), NOW + 8 * DAY)).rejects.toThrow(/dispute window/);
    const d = await repo.openDispute(p.id, tester, 'I did complete the checkout task.', newId(), NOW + DAY);
    expect((await repo.listDisputesByOpener(tester.id)).map((x) => x.id)).toEqual([d.id]);
    expect((await repo.listAllDisputes())[0]?.status).toBe('open');
    const resolved = await repo.resolveDispute(d.id, admin, 'upheld', 'The video confirms the rejection.', NOW + 2 * DAY);
    expect(resolved).toMatchObject({ status: 'resolved', outcome: 'upheld', resolved_by: admin.id });
    await expect(repo.resolveDispute(d.id, admin, 'overturned', 'Changed my mind about it.', NOW + 2 * DAY)).rejects.toMatchObject({ code: 'CONFLICT_STATE' });
    expect(await repo.accountBalance(userAccount(tester.id))).toBe(0);
  });

  it('an admin decides stuck work only, audited; lists are ordered as in SQLite', async () => {
    const builder = await user('b', 'builder');
    const admin = await user('a', 'admin');
    const [t1, t2] = [await user('t1'), await user('t2')];
    const sid = await published(builder, { slots: 2, reward: 10 });
    const p1 = await submitted(sid, t1, NOW);
    const p2 = await submitted(sid, t2, NOW + 1000);
    expect((await repo.listParticipationsByStudy(sid)).map((p) => p.id)).toEqual([p1.id, p2.id]);
    expect((await repo.listSubmittedWithStudy()).map((p) => [p.id, p.study_title, p.builder_status])).toEqual([
      [p1.id, 'Checkout flow', 'active'],
      [p2.id, 'Checkout flow', 'active'],
    ]);
    await expect(repo.decideParticipation(p1.id, { by: 'admin_stuck', actor: admin, decision: 'approve', reason: 'Builder inactive.' }, NOW)).rejects.toThrow(/Only stuck submissions/);
    await core.setStatus(builder.id, 'suspended');
    const d = await repo.decideParticipation(p1.id, { by: 'admin_stuck', actor: admin, decision: 'approve', reason: 'Builder suspended.' }, NOW);
    expect(d.status).toBe('approved');
    expect(await repo.accountBalance(userAccount('t1'))).toBe(10);
    expect((await fs.collection('audit').where('action', '==', 'participation.approve').get()).size).toBe(1);
  });

  it('eligible studies: open, not joined, builder active, newest published first', async () => {
    const builder = await user('b', 'builder');
    const tester = await user('t');
    await repo.topUp(builder.id, 100, NOW);
    const older = await draft(builder, { slots: 1, reward: 10 });
    const newer = await draft(builder, { slots: 1, reward: 10 });
    await repo.studyTransition(older, builder, 'publish', false, NOW);
    await repo.studyTransition(newer, builder, 'publish', false, NOW + 1000);
    expect((await repo.listOpenStudiesFor(tester.id)).map((s) => s.id)).toEqual([newer, older]);
    await join(newer, tester);
    expect((await repo.listOpenStudiesFor(tester.id)).map((s) => s.id)).toEqual([older]);
    expect((await repo.listStudiesByBuilder(builder.id)).length).toBe(2);
    expect((await repo.listNonDraftStudies()).length).toBe(2);
  });
});

describe('account export and deletion', () => {
  it('exportUser returns own rows; purgeUser applies the deletion rules and is idempotent', async () => {
    const builder = await user('b', 'builder');
    const tester = await user('t');
    const sid = await published(builder, { slots: 3, reward: 10 });
    const sid2 = await published(builder, { slots: 1, reward: 10 });
    const rejected = await submitted(sid, tester);
    await repo.decideParticipation(rejected.id, { by: 'builder', actor: builder, decision: 'reject', reason: 'The recording does not show the checkout at all.', helpful: false }, NOW);
    const d = await repo.openDispute(rejected.id, tester, 'I did complete the checkout task.', newId(), NOW + 1000);
    await repo.resolveDispute(d.id, (await user('a', 'admin')), 'upheld', 'The video confirms the rejection.', NOW + 2000);
    const inFlight = await join(sid2, tester);
    await repo.testerTransition(inFlight.id, tester, 'start', null, NOW);
    const [task] = await repo.tasksOf(sid2);
    await repo.putTaskNote(inFlight.id, tester, task!.id, 'my note');
    await fs.collection('findings').doc('f-linked').set({ id: 'f-linked', participation_id: rejected.id, title: 't', severity: 'minor', description: 'd', evidence_id: 'ev-1', timestamp_ms: null, created_by: builder.id, created_at: '2026-10-06T10:00:00.000Z' });

    const ex = await repo.exportUser(tester.id);
    expect(ex.participations.map((p) => p.id).sort()).toEqual([inFlight.id, rejected.id].sort());
    expect(ex.findings.map((f) => f.id)).toEqual(['f-linked']);
    expect(ex.disputes.map((x) => x.id)).toEqual([d.id]);
    expect(ex.studies).toEqual([]);
    expect((await repo.exportUser(builder.id)).studies.length).toBe(2);
    expect(await repo.liveStudiesOf(builder.id)).toBe(2);
    expect(await repo.openParticipationsOf(tester.id)).toBe(0);

    const before = (await fs.collection('ledger').get()).size;
    for (let i = 0; i < 2; i++) expect(await repo.purgeUser(tester.id, NOW + 3000)).toEqual({ mediaKeys: [] });
    expect(await repo.taskNotes(inFlight.id)).toEqual([]);
    expect(await repo.getParticipation(inFlight.id)).toMatchObject({ status: 'withdrawn', decision_reason: null });
    expect(await repo.getParticipation(rejected.id)).toMatchObject({ status: 'resolved', decision_reason: null });
    expect((await repo.getDispute(d.id))?.reason).toBe('[deleted]');
    expect((await fs.collection('findings').doc('f-linked').get()).data()?.evidence_id).toBeNull();
    // Ledger postings are never touched.
    expect((await fs.collection('ledger').get()).size).toBe(before);
    expect(await repo.accountBalance(FAUCET)).toBe(-40);
  });
});

describe('rule D (plan R12): a retried create with the same id returns the existing row, no second effect', () => {
  it('createStudy, topUp, createFinding and moderateStudy are no-ops on an existing id', async () => {
    const builder = await user('b', 'builder');
    const admin = await user('a', 'admin');
    const tester = await user('t');
    const input = {
      id: 'study-fixed',
      builderId: builder.id,
      title: 'Checkout flow',
      objective: 'Find friction in checkout',
      buildUnderTest: null,
      deviceCriteriaJson: JSON.stringify({ platforms: ['web'], minAndroidApi: null, languages: ['en'] }),
      rewardCredits: 10,
      slots: 1,
      consentText: 'I agree to record my screen for this study.',
      tasks: [{ instruction: 'Open the app' }],
      taskIds: ['task-fixed-0'],
      createdAt: '2026-10-06T09:00:00.000Z',
      escrow: null,
    };
    await repo.createStudy(input);
    await repo.createStudy({ ...input, title: 'A retry must not overwrite', taskIds: ['task-other-0'] });
    expect((await repo.getStudy('study-fixed'))?.title).toBe('Checkout flow');
    expect((await repo.tasksOf('study-fixed')).map((x) => x.id)).toEqual(['task-fixed-0']);

    await repo.topUp(builder.id, 10, NOW, 'ledger-fixed');
    await repo.topUp(builder.id, 10, NOW, 'ledger-fixed');
    expect(await repo.accountBalance(userAccount(builder.id))).toBe(10);
    expect((await fs.collection('ledger').where('tx_id', '==', 'ledger-fixed').get()).docs.map((d) => d.id).sort()).toEqual(['ledger-fixed:0', 'ledger-fixed:1']);

    await repo.studyTransition('study-fixed', builder, 'publish', false, NOW);
    const p = await submitted('study-fixed', tester);
    const f1 = await repo.createFinding(p.id, builder, { title: 'Cart hidden', severity: 'major', description: 'Below the fold.' }, 'finding-fixed', NOW);
    const f2 = await repo.createFinding(p.id, builder, { title: 'Different', severity: 'minor', description: 'Retry body.' }, 'finding-fixed', NOW + 5);
    expect(f2).toEqual(f1);
    expect(await repo.listFindings(p.id)).toHaveLength(1);

    const audit = { id: 'audit-fixed', actorId: admin.id, action: 'study.suspend', reason: 'Spam', nowMs: NOW };
    expect((await repo.moderateStudy('study-fixed', 'suspended', audit)).moderation).toBe('suspended');
    expect((await repo.moderateStudy('study-fixed', 'suspended', audit)).moderation).toBe('suspended');
    expect((await fs.collection('audit').where('action', '==', 'study.suspend').get()).size).toBe(1);
  });
});
