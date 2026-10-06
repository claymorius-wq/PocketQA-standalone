import { afterEach, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers';

// pqa-qa early r1 P2-F: a request whose effect committed but whose idempotency record was never
// completed (crash, timeout, failed completion write) is retried with the same key. Unguarded creates
// get deterministic ids from the key's scope, so the retry can't duplicate the effect.
let t: TestApp;
afterEach(async () => {
  await t?.app.close();
});

/** Simulates a crash after commit: the completion write fails once. */
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

describe('crash-after-commit retries (P2-F)', () => {
  it('moderateUser: retried with the same key, one audit row', async () => {
    t = await makeApp();
    const adm = await t.admin();
    const target = await t.register('tester');
    failNextCompletion(t);
    const first = await t.req('POST', `/admin/moderation/users/${target.id}`, adm.token, { action: 'suspend', reason: 'Testing the retry rule' }, { 'idempotency-key': 'mod-key-00001' });
    expect(first.status).toBe(500);
    const retry = await t.req('POST', `/admin/moderation/users/${target.id}`, adm.token, { action: 'suspend', reason: 'Testing the retry rule' }, { 'idempotency-key': 'mod-key-00001' });
    expect(retry.status).toBe(200);
    const audit = await t.req('GET', '/admin/audit', adm.token);
    expect(audit.body.items.filter((a: { targetId: string; action: string }) => a.targetId === target.id && a.action === 'user.suspend')).toHaveLength(1);
  });
});
