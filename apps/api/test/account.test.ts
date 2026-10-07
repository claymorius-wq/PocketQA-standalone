import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { ExportBundle } from '@pocket-qa/contracts';
import { makeApp, PNG, seeded, type TestApp } from './helpers';

let t: TestApp;
beforeEach(async () => {
  t = await makeApp();
});
afterEach(async () => t.close());

describe('auth', () => {
  it('cannot self-register as admin; wrong password is 401; logout ends the session', async () => {
    const r = await t.req('POST', '/auth/register', undefined, { email: 'x@example.test', password: 'correct horse battery staple', displayName: 'X', role: 'admin' });
    expect(r.status).toBe(400);
    const u = await t.register('tester');
    expect((await t.req('POST', '/auth/login', undefined, { email: u.email, password: 'nope nope nope' })).status).toBe(401);
    const ok = await t.req('POST', '/auth/login', undefined, { email: u.email.toUpperCase(), password: 'correct horse battery staple' });
    expect(ok.status).toBe(200);
    expect(ok.body.user).not.toHaveProperty('password_hash');
    await t.req('POST', '/auth/logout', ok.body.token);
    expect((await t.req('GET', '/me', ok.body.token)).status).toBe(401);
  });

  it('rate-limits repeated failed logins', async () => {
    const u = await t.register('tester');
    for (let i = 0; i < 10; i++) await t.req('POST', '/auth/login', undefined, { email: u.email, password: 'wrong wrong wrong' });
    const r = await t.req('POST', '/auth/login', undefined, { email: u.email, password: 'correct horse battery staple' });
    expect(r.status).toBe(429);
  });

  it('reports AI analysis as unavailable', async () => {
    const u = await t.register('builder');
    expect((await t.req('GET', '/ai/status', u.token)).body).toEqual({ available: false, provider: null });
  });
});

describe('export and deletion', () => {
  it('export contains only the requester’s data', async () => {
    const { tester, builder, participationId } = await seeded(t);
    await t.upload(tester.token, participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'e1' });
    const other = await t.register('tester');
    const mine = ExportBundle.parse((await t.req('POST', '/me/export', tester.token)).body);
    expect(mine.user.id).toBe(tester.id);
    expect(mine.participations.map((p) => p.testerId)).toEqual([tester.id]);
    expect(mine.studies).toEqual([]);
    expect(mine.evidence).toHaveLength(1);
    const theirs = ExportBundle.parse((await t.req('POST', '/me/export', other.token)).body);
    expect(theirs.participations).toEqual([]);
    expect(theirs.evidence).toEqual([]);
    const b = ExportBundle.parse((await t.req('POST', '/me/export', builder.token)).body);
    expect(b.participations).toEqual([]);
    expect(b.studies).toHaveLength(1);
  });

  it('deletion removes media and personal data but keeps anonymized ledger rows', async () => {
    const { tester, builder, participationId } = await seeded(t);
    await t.upload(tester.token, participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'e1' });
    await t.req('POST', `/participations/${participationId}/submit`, tester.token);
    // Submitted work blocks deletion until reviewed.
    expect((await t.req('DELETE', '/me', tester.token, { confirm: 'DELETE MY ACCOUNT' })).status).toBe(409);
    await t.req('POST', `/participations/${participationId}/approve`, builder.token, {});
    expect((await t.req('DELETE', '/me', tester.token, { confirm: 'yes' })).status).toBe(400);
    expect(readdirSync(t.mediaDir)).toHaveLength(1);
    expect((await t.req('DELETE', '/me', tester.token, { confirm: 'DELETE MY ACCOUNT' })).status).toBe(200);
    // A fixed-text audit row records the deletion, with no personal data (inc5).
    const deletion = (await t.deps.repo.core.listAudit()).find((a) => a.action === 'user.deleted')!;
    expect(deletion.reason).toBe('[account deleted by its owner]');
    expect(deletion.actor_id).toBe(deletion.target_id);

    expect(readdirSync(t.mediaDir)).toHaveLength(0);
    const u = (await t.deps.repo.core.userById(tester.id))!;
    const row = { email: u.email, display_name: u.display_name, password_hash: u.password_hash, device_json: u.device_json, status: u.status };
    expect(row).toEqual({ email: `deleted-${tester.id}@deleted.invalid`, display_name: 'Deleted user', password_hash: null, device_json: null, status: 'deleted' });
    expect(await t.deps.repo.studies.ledgerEntries(`user:${tester.id}`)).toHaveLength(1);
    expect((await t.req('GET', '/me', tester.token)).status).toBe(401);
    expect((await t.req('POST', '/auth/login', undefined, { email: tester.email, password: 'correct horse battery staple' })).status).toBe(401);
  });

  it('a builder must close live studies before deleting', async () => {
    const { builder } = await seeded(t);
    expect((await t.req('DELETE', '/me', builder.token, { confirm: 'DELETE MY ACCOUNT' })).status).toBe(409);
  });
});
