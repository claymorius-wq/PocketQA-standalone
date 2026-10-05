import { afterEach, describe, expect, it } from 'vitest';
import { ClientConfig } from '@pocket-qa/contracts';
import { makeApp, STUDY, type TestApp } from './helpers';

// Ledger D3/D4: production never fakes funding. Test credits and devnet demo transfers are
// refused with FEATURE_UNAVAILABLE (nothing posted), and /config tells clients to hide them.
let t: TestApp;
afterEach(async () => t?.close());

describe('production feature gates', () => {
  it('/config reports test credits and devnet transfers as off in production, on in development', async () => {
    t = await makeApp({ production: true });
    expect(ClientConfig.parse((await t.req('GET', '/config')).body).features).toEqual({ testCredits: false, devnetTransfers: false, settlement: 'off' });
    await t.close();
    t = await makeApp();
    expect(ClientConfig.parse((await t.req('GET', '/config')).body).features).toEqual({ testCredits: true, devnetTransfers: true, settlement: 'off' });
  });

  it('test-credit top-up is refused and posts nothing; publishing then fails honestly', async () => {
    t = await makeApp({ production: true });
    const b = await t.register('builder');
    const r = await t.req('POST', '/me/credits/test-topup', b.token, { amount: 100 });
    expect([r.status, r.body.code]).toEqual([403, 'FEATURE_UNAVAILABLE']);
    expect((await t.req('GET', '/me/credits', b.token)).body.balance).toBe(0);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM ledger').get()).toEqual({ n: 0 });
    const s = (await t.req('POST', '/studies', b.token, STUDY)).body;
    expect((await t.req('POST', `/studies/${s.id}/publish`, b.token)).body.code).toBe('BUDGET_INSUFFICIENT');
  });

  it('devnet demo transfers are refused before any lookup or chain call', async () => {
    t = await makeApp({ production: true });
    const b = await t.register('builder');
    const r = await t.req('POST', '/devnet/transfers', b.token, { participationId: '00000000-0000-4000-8000-000000000000' });
    expect([r.status, r.body.code]).toEqual([403, 'FEATURE_UNAVAILABLE']);
    for (const [m, p] of [['GET', '/devnet/transfers/00000000-0000-4000-8000-000000000000/blockhash'], ['POST', '/devnet/transfers/00000000-0000-4000-8000-000000000000/signature']] as const) {
      expect((await t.req(m, p, b.token, m === 'POST' ? { signature: '1'.repeat(88) } : undefined)).body.code, p).toBe('FEATURE_UNAVAILABLE');
    }
  });
});
