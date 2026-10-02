import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CreditsView, Participation, Study } from '@pocket-qa/contracts';
import { DEVICE, makeApp, PNG, seeded, STUDY, type TestApp } from './helpers';

let t: TestApp;
beforeEach(async () => {
  t = await makeApp();
});
afterEach(async () => t.close());

const balance = async (token: string) => CreditsView.parse((await t.req('GET', '/me/credits', token)).body).balance;

describe('study budget', () => {
  it('cannot publish without enough test credits, and reserves reward × slots on publish', async () => {
    const b = await t.register('builder');
    const s = (await t.req('POST', '/studies', b.token, STUDY)).body;
    const r1 = await t.req('POST', `/studies/${s.id}/publish`, b.token);
    expect(r1.status).toBe(409);
    expect(r1.body.code).toBe('BUDGET_INSUFFICIENT');

    await t.req('POST', '/me/credits/test-topup', b.token, { amount: 100 });
    const r2 = await t.req('POST', `/studies/${s.id}/publish`, b.token);
    expect(r2.status).toBe(200);
    const study = Study.parse(r2.body);
    expect(study.budget).toEqual({ reserved: 100, awarded: 0, committed: 0, available: 100 });
    expect(await balance(b.token)).toBe(0);
  });

  it('rejects earnings language in builder-entered text', async () => {
    const b = await t.register('builder');
    const r = await t.req('POST', '/studies', b.token, { ...STUDY, objective: 'Earn money fast by testing our wallet app!' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('VALIDATION');
  });

  it('only drafts are editable; consent text edits bump the consent version', async () => {
    const b = await t.register('builder');
    const s = (await t.req('POST', '/studies', b.token, STUDY)).body;
    const e = await t.req('PATCH', `/studies/${s.id}`, b.token, { consentText: STUDY.consentText + ' Updated wording.' });
    expect(e.body.consentVersion).toBe(2);
    await t.req('POST', '/me/credits/test-topup', b.token, { amount: 1000 });
    await t.req('POST', `/studies/${s.id}/publish`, b.token);
    const late = await t.req('PATCH', `/studies/${s.id}`, b.token, { title: 'New title' });
    expect(late.status).toBe(409);
  });
});

describe('tester flow', () => {
  it('discovers only eligible studies and must consent to the current version', async () => {
    const b = await t.register('builder');
    const tester = await t.register('tester');
    await t.req('POST', '/me/credits/test-topup', b.token, { amount: 1000 });
    const s = (await t.req('POST', '/studies', b.token, STUDY)).body;
    await t.req('POST', `/studies/${s.id}/publish`, b.token);

    expect((await t.req('GET', '/studies/eligible', tester.token)).body.items).toHaveLength(0); // no device profile yet
    await t.req('PUT', '/me/device', tester.token, { ...DEVICE, languages: ['fr'] });
    expect((await t.req('GET', '/studies/eligible', tester.token)).body.items).toHaveLength(0); // language mismatch
    await t.req('PUT', '/me/device', tester.token, DEVICE);
    const list = (await t.req('GET', '/studies/eligible', tester.token)).body.items;
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty('builderId');
    expect(list[0]).not.toHaveProperty('budget');

    const view = (await t.req('GET', `/tester/studies/${s.id}`, tester.token)).body;
    expect(view.consentText).toBe(STUDY.consentText);
    expect(view).not.toHaveProperty('budget');

    const stale = await t.req('POST', `/studies/${s.id}/consent`, tester.token, { consentVersion: 99, accepted: true });
    expect(stale.status).toBe(409);
    const ok = await t.req('POST', `/studies/${s.id}/consent`, tester.token, { consentVersion: 1, accepted: true });
    expect(Participation.parse(ok.body).status).toBe('consented');
    const again = await t.req('POST', `/studies/${s.id}/consent`, tester.token, { consentVersion: 1, accepted: true });
    expect(again.status).toBe(409);
  });

  it('a full study refuses more consents; withdrawal frees the slot', async () => {
    const { study } = await seeded(t); // 1 of 2 slots used
    const t2 = await t.register('tester');
    const t3 = await t.register('tester');
    for (const x of [t2, t3]) await t.req('PUT', '/me/device', x.token, DEVICE);
    const p2 = (await t.req('POST', `/studies/${study.id}/consent`, t2.token, { consentVersion: 1, accepted: true })).body;
    const full = await t.req('POST', `/studies/${study.id}/consent`, t3.token, { consentVersion: 1, accepted: true });
    expect(full.status).toBe(409);
    await t.req('POST', `/participations/${p2.id}/withdraw`, t2.token, {});
    const now = await t.req('POST', `/studies/${study.id}/consent`, t3.token, { consentVersion: 1, accepted: true });
    expect(now.status).toBe(200);
  });

  it('freezes notes and evidence after submission', async () => {
    const { tester, participationId, study } = await seeded(t);
    const taskId = study.tasks[0].id;
    expect((await t.req('PUT', `/participations/${participationId}/tasks/${taskId}/note`, tester.token, { note: 'Got stuck at OTP' })).status).toBe(200);
    expect((await t.upload(tester.token, participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 's1', taskId })).status).toBe(200);
    expect((await t.req('POST', `/participations/${participationId}/submit`, tester.token)).status).toBe(200);
    const late = await t.upload(tester.token, participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 's2' });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('CONFLICT_STATE');
    expect((await t.req('PUT', `/participations/${participationId}/tasks/${taskId}/note`, tester.token, { note: 'edit' })).status).toBe(409);
  });
});

describe('review and ledger', () => {
  it('approval credits exactly once (idempotent) and never takes the budget negative', async () => {
    const { builder, tester, participationId, study } = await seeded(t);
    await t.req('POST', `/participations/${participationId}/submit`, tester.token);
    const a1 = await t.req('POST', `/participations/${participationId}/approve`, builder.token, {});
    expect(a1.status).toBe(200);
    expect(a1.body.status).toBe('approved');
    const a2 = await t.req('POST', `/participations/${participationId}/approve`, builder.token, {});
    expect(a2.status).toBe(409);
    expect(await balance(tester.token)).toBe(50);
    const rows = t.db.prepare(`SELECT COUNT(*) AS n FROM ledger WHERE participation_id = ? AND kind = 'reward_credit' AND amount > 0`).get(participationId) as { n: number };
    expect(rows.n).toBe(1);
    const s = Study.parse((await t.req('GET', `/studies/${study.id}`, builder.token)).body);
    expect(s.budget).toEqual({ reserved: 100, awarded: 50, committed: 0, available: 50 });
  });

  it('the database itself refuses a second reward posting and any ledger edit', async () => {
    const { builder, tester, participationId } = await seeded(t);
    await t.req('POST', `/participations/${participationId}/submit`, tester.token);
    await t.req('POST', `/participations/${participationId}/approve`, builder.token, {});
    expect(() =>
      t.db
        .prepare(`INSERT INTO ledger (id, tx_id, account, amount, kind, study_id, participation_id, created_at) VALUES ('x','x','user:z',50,'reward_credit',NULL,?, 'now')`)
        .run(participationId),
    ).toThrow();
    expect(() => t.db.prepare('UPDATE ledger SET amount = 999').run()).toThrow(/append-only/);
    expect(() => t.db.prepare('DELETE FROM ledger').run()).toThrow(/append-only/);
  });

  it('rejection needs a reason; dispute overturned credits once; close is blocked until resolved', async () => {
    const { builder, tester, participationId, study } = await seeded(t);
    const admin = await t.admin();
    await t.req('POST', `/participations/${participationId}/submit`, tester.token);
    expect((await t.req('POST', `/participations/${participationId}/reject`, builder.token, { reason: 'no' })).status).toBe(400);
    const rej = await t.req('POST', `/participations/${participationId}/reject`, builder.token, { reason: 'No evidence attached for task 2.' });
    expect(rej.body.decisionReason).toBe('No evidence attached for task 2.');
    const d = await t.req('POST', '/disputes', tester.token, { participationId, reason: 'Task 2 evidence is in my note, please re-check.' });
    expect(d.status).toBe(200);
    expect((await t.req('POST', `/studies/${study.id}/close`, builder.token)).status).toBe(409);
    const res = await t.req('POST', `/admin/disputes/${d.body.id}/resolve`, admin.token, { outcome: 'overturned', note: 'Note covers task 2.' });
    expect(res.body.outcome).toBe('overturned');
    expect(await balance(tester.token)).toBe(50);
    const again = await t.req('POST', `/admin/disputes/${d.body.id}/resolve`, admin.token, { outcome: 'overturned', note: 'again' });
    expect(again.status).toBe(409);
    expect(await balance(tester.token)).toBe(50);
    const audit = (await t.req('GET', '/admin/audit', admin.token)).body.items;
    expect(audit[0].action).toBe('dispute.overturned');
  });

  it('closing withdraws in-flight testers and releases the remaining budget to the builder', async () => {
    const { builder, study } = await seeded(t); // tester in progress
    const before = await balance(builder.token);
    const c = await t.req('POST', `/studies/${study.id}/close`, builder.token);
    expect(c.status).toBe(200);
    expect(c.body.status).toBe('closed');
    expect(await balance(builder.token)).toBe(before + 100);
    const parts = (await t.req('GET', `/studies/${study.id}/participations`, builder.token)).body.items;
    expect(parts[0].status).toBe('withdrawn');
  });
});

describe('error mapping', () => {
  it('a ledger invariant breach surfaces as 500, not as a routine 409', async () => {
    const { builder, tester, participationId } = await seeded(t);
    await t.req('POST', `/participations/${participationId}/submit`, tester.token);
    // Simulate a buggy code path: a trigger-protected ledger row mutation inside a request.
    t.db.exec(`CREATE TRIGGER boom BEFORE INSERT ON ledger WHEN NEW.kind = 'reward_credit' BEGIN SELECT RAISE(ABORT, 'simulated invariant'); END;`);
    const r = await t.req('POST', `/participations/${participationId}/approve`, builder.token, {});
    expect(r.status).toBe(500);
    expect(r.body.code).toBe('INTERNAL');
  });
});
