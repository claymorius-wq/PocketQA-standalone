import { afterEach, describe, expect, it } from 'vitest';
import { Study } from '@pocket-qa/contracts';
import { DEVICE, makeApp, seeded, STUDY, type TestApp } from './helpers';

// Plan R12 (pqa-qa early r1 P2-F), escrow domain: a request whose effect committed but whose
// idempotency record was never completed is retried with the same key, and never doubles its effect.
//  - createEscrowFunding: rule G (one open funding request per study, reused inside the transaction)
//  - createTransfer:      rule D (id from ctx.idemId('transfer'); the existing row is returned)
//  - adminFraud:          rule G (one fraud finding per participation; reversals guarded)
let t: TestApp;
afterEach(async () => t?.close());

const key = (k: string) => ({ 'idempotency-key': k });

/** The completion write fails once: the effect is committed, the stored response is not. */
function failNextCompletion(app: TestApp) {
  const core = app.deps.repo.core;
  const real = core.completeIdempotency.bind(core);
  let armed = true;
  core.completeIdempotency = async (...args) => {
    if (armed) {
      armed = false;
      throw new Error('simulated crash after commit');
    }
    return real(...args);
  };
}

describe('crash-after-commit retries, escrow domain (P2-F)', () => {
  it('createEscrowFunding (rule G): the retry returns the same open request; one request exists', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const b = await t.register('builder');
    await t.linkWallet(b.token);
    const { rewardCredits: _, ...rest } = STUDY;
    const study = Study.parse((await t.req('POST', '/studies', b.token, { ...rest, slots: 2, payment: { mode: 'escrow', rewardUnits: 1_000_000 } })).body);
    failNextCompletion(t);
    expect((await t.req('POST', `/studies/${study.id}/escrow/fundings`, b.token, undefined, key('fund-key-0001'))).status).toBe(500);
    const retry = await t.req('POST', `/studies/${study.id}/escrow/fundings`, b.token, undefined, key('fund-key-0001'));
    expect(retry.status).toBe(200);
    const rows = t.db.prepare('SELECT id FROM escrow_fundings WHERE study_id = ?').all(study.id) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([retry.body.id]);
  });

  it('createTransfer (rule D): the retry returns the same transfer; one transfer exists', async () => {
    t = await makeApp();
    const s = await seeded(t);
    await t.req('POST', `/participations/${s.participationId}/submit`, s.tester.token);
    await t.req('POST', `/participations/${s.participationId}/approve`, s.builder.token, {});
    await t.linkWallet(s.builder.token);
    await t.linkWallet(s.tester.token);
    failNextCompletion(t);
    expect((await t.req('POST', '/devnet/transfers', s.builder.token, { participationId: s.participationId }, key('xfer-key-0001'))).status).toBe(500);
    const retry = await t.req('POST', '/devnet/transfers', s.builder.token, { participationId: s.participationId }, key('xfer-key-0001'));
    expect(retry.status).toBe(200);
    const rows = t.db.prepare('SELECT id FROM devnet_transfers WHERE participation_id = ?').all(s.participationId) as { id: string }[];
    expect(rows.map((r) => r.id)).toEqual([retry.body.id]);
    // Without the key, a second request is a new request: refused while one is open.
    expect((await t.req('POST', '/devnet/transfers', s.builder.token, { participationId: s.participationId })).status).toBe(409);
  });

  it('adminFraud (rule G): the retry is refused (409) and the points are reversed once', async () => {
    t = await makeApp();
    const b = await t.register('builder');
    await t.req('POST', '/me/credits/test-topup', b.token, { amount: 5000 });
    const study = (await t.req('POST', '/studies', b.token, STUDY)).body;
    await t.req('POST', `/studies/${study.id}/publish`, b.token);
    const u = await t.register('tester');
    await t.req('PUT', '/me/device', u.token, DEVICE);
    const p = (await t.req('POST', `/studies/${study.id}/consent`, u.token, { consentVersion: 1, accepted: true })).body.id as string;
    await t.req('POST', `/participations/${p}/start`, u.token);
    await t.req('POST', `/participations/${p}/submit`, u.token);
    await t.req('POST', `/participations/${p}/approve`, b.token, { helpful: true });
    const a = await t.admin();
    failNextCompletion(t);
    const body = { reason: 'Duplicate clip from another tester.' };
    expect((await t.req('POST', `/admin/participations/${p}/fraud`, a.token, body, key('fraud-key-001'))).status).toBe(500);
    expect((await t.req('POST', `/admin/participations/${p}/fraud`, a.token, body, key('fraud-key-001'))).status).toBe(409);
    const kinds = (t.db.prepare('SELECT kind FROM points_events WHERE participation_id = ?').all(p) as { kind: string }[]).map((r) => r.kind).sort();
    expect(kinds).toEqual(['accepted', 'helpful', 'reversal', 'reversal']);
    expect((t.db.prepare(`SELECT COUNT(*) AS n FROM audit WHERE action = 'reputation.fraud_upheld'`).get() as { n: number }).n).toBe(1);
  });
});
