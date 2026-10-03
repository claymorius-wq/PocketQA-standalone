import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { buildSiwsMessage, STUCK_AFTER_DAYS, StuckSubmission } from '@pocket-qa/contracts';
import { makeApp, MP4, seeded, type TestApp } from './helpers';

// Remaining local scope (2026-10-03): builder dispute view, admin stuck-submission
// resolution, transfer list + blockhash for the devnet demo transfer screen.
let t: TestApp;
beforeEach(async () => {
  t = await makeApp();
});
afterEach(async () => t.close());

const day = 24 * 3600 * 1000;

async function submitted() {
  const s = await seeded(t);
  await t.req('POST', `/participations/${s.participationId}/submit`, s.tester.token);
  return s;
}

describe('builder view of disputes on their own studies', () => {
  it('lists disputes for the owner only', async () => {
    const { builder, tester, participationId, study } = await submitted();
    await t.req('POST', `/participations/${participationId}/reject`, builder.token, { reason: 'Task two was not attempted.' });
    const d = (await t.req('POST', '/disputes', tester.token, { participationId, reason: 'I did attempt it, see my notes.' })).body;
    const mine = await t.req('GET', `/studies/${study.id}/disputes`, builder.token);
    expect(mine.status).toBe(200);
    expect(mine.body.items.map((x: { id: string }) => x.id)).toEqual([d.id]);
    const other = await t.register('builder');
    expect((await t.req('GET', `/studies/${study.id}/disputes`, other.token)).status).toBe(404);
    expect((await t.req('GET', `/studies/${study.id}/disputes`, tester.token)).status).toBe(403);
  });
});

describe('admin resolution of stuck submissions (audited)', () => {
  it('lists a submission whose builder is suspended; a fresh one with an active builder is not stuck', async () => {
    const { builder, participationId } = await submitted();
    const admin = await t.admin();
    expect((await t.req('GET', '/admin/stuck', admin.token)).body.items).toEqual([]);
    await t.req('POST', `/admin/moderation/users/${builder.id}`, admin.token, { action: 'suspend', reason: 'Not responding to testers' });
    const list = (await t.req('GET', '/admin/stuck', admin.token)).body.items;
    expect(list).toHaveLength(1);
    const item = StuckSubmission.parse(list[0]);
    expect(item.participation.id).toBe(participationId);
    expect(item).toMatchObject({ builderStatus: 'suspended', reason: 'builder_inactive' });
  });

  it('flags overdue submissions after the window and lets an admin approve once, with an audit entry', async () => {
    const { tester, participationId } = await submitted();
    const admin = await t.admin();
    expect((await t.req('POST', `/admin/participations/${participationId}/decide`, admin.token, { decision: 'approve', reason: 'Builder never reviewed it.' })).status).toBe(409);
    t.clock.now += STUCK_AFTER_DAYS * day;
    expect((await t.req('GET', '/admin/stuck', admin.token)).body.items[0].reason).toBe('overdue');
    expect((await t.req('POST', `/admin/participations/${participationId}/decide`, admin.token, { decision: 'approve', reason: 'short' })).status).toBe(400);
    expect((await t.req('POST', `/admin/participations/${participationId}/decide`, admin.token, { decision: 'approve', reason: 'Payout of $50 sent to you' })).status).toBe(400);
    const ok = await t.req('POST', `/admin/participations/${participationId}/decide`, admin.token, { decision: 'approve', reason: 'Work matches the tasks; builder unresponsive.' });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'approved', decidedBy: admin.id, decisionReason: 'Work matches the tasks; builder unresponsive.' });
    expect((await t.req('GET', '/me/credits', tester.token)).body.balance).toBe(50);
    const again = await t.req('POST', `/admin/participations/${participationId}/decide`, admin.token, { decision: 'approve', reason: 'Trying to credit twice.' });
    expect(again.status).toBe(409);
    expect((await t.req('GET', '/me/credits', tester.token)).body.balance).toBe(50);
    const audit = (await t.req('GET', '/admin/audit', admin.token)).body.items;
    expect(audit[0]).toMatchObject({ action: 'participation.approve', targetType: 'participation', targetId: participationId, actorId: admin.id });
    expect((await t.req('GET', '/admin/stuck', admin.token)).body.items).toEqual([]);
  });

  it('gives the admin what is needed to judge stuck work: task text, notes and evidence playback (review r1 P3)', async () => {
    const s = await seeded(t);
    const up = await t.upload(s.tester.token, s.participationId, MP4, { kind: 'screen_recording', capturedOn: 'android', clientSegmentId: 'seg-1' });
    expect(up.status).toBe(200);
    await t.req('POST', `/participations/${s.participationId}/submit`, s.tester.token);
    const admin = await t.admin();
    await t.req('POST', `/admin/moderation/users/${s.builder.id}`, admin.token, { action: 'suspend', reason: 'Not responding to testers' });
    const [item] = (await t.req('GET', '/admin/stuck', admin.token)).body.items;
    expect(StuckSubmission.parse(item).tasks.map((x) => x.instruction)).toEqual(s.study.tasks.map((x: { instruction: string }) => x.instruction));
    const ev = await t.req('GET', `/participations/${s.participationId}/evidence`, admin.token);
    expect(ev.body.items).toHaveLength(1);
    expect((await t.req('POST', `/evidence/${ev.body.items[0].id}/playback-token`, admin.token)).status).toBe(200);
  });

  it('admin rejection of a stuck submission records the reason and lets the tester dispute', async () => {
    const { builder, tester, participationId } = await submitted();
    const admin = await t.admin();
    await t.req('POST', `/admin/moderation/users/${builder.id}`, admin.token, { action: 'suspend', reason: 'Not responding to testers' });
    const r = await t.req('POST', `/admin/participations/${participationId}/decide`, admin.token, { decision: 'reject', reason: 'No evidence or notes for any task.' });
    expect(r.body).toMatchObject({ status: 'rejected', decisionReason: 'No evidence or notes for any task.' });
    expect((await t.req('POST', '/disputes', tester.token, { participationId, reason: 'I added notes for every task, please re-check.' })).status).toBe(200);
  });

  it('account deletion redacts admin decision and dispute reasons about the tester’s work (review r1 P3)', async () => {
    const { builder, tester, participationId } = await submitted();
    const admin = await t.admin();
    await t.req('POST', `/admin/moderation/users/${builder.id}`, admin.token, { action: 'suspend', reason: 'Not responding to testers' });
    await t.req('POST', `/admin/participations/${participationId}/decide`, admin.token, { decision: 'reject', reason: 'Jane Roe skipped the checkout task entirely.' });
    const d = (await t.req('POST', '/disputes', tester.token, { participationId, reason: 'I did the checkout task, see note.' })).body;
    await t.req('POST', `/admin/disputes/${d.id}/resolve`, admin.token, { outcome: 'upheld', note: 'Jane Roe notes do not cover checkout.' });
    expect((await t.req('DELETE', '/me', tester.token, { confirm: 'DELETE MY ACCOUNT' })).status).toBe(200);
    const rows = t.db.prepare(`SELECT action, actor_id, reason FROM audit WHERE target_id IN (?, ?) ORDER BY action`).all(participationId, d.id) as { action: string; actor_id: string; reason: string }[];
    expect(rows.map((r) => r.action)).toEqual(['dispute.upheld', 'participation.reject']);
    expect(rows.every((r) => r.reason === '[redacted on account deletion]' && r.actor_id === admin.id)).toBe(true);
    // The builder's own moderation entry is about the builder and stays.
    expect((t.db.prepare(`SELECT reason FROM audit WHERE target_id = ?`).get(builder.id) as { reason: string }).reason).toBe('Not responding to testers');
  });

  it('only admins can list or decide', async () => {
    const { builder, tester, participationId } = await submitted();
    for (const u of [builder, tester]) {
      expect((await t.req('GET', '/admin/stuck', u.token)).status).toBe(403);
      expect((await t.req('POST', `/admin/participations/${participationId}/decide`, u.token, { decision: 'approve', reason: 'Approving my own work.' })).status).toBe(403);
    }
  });
});

describe('devnet demo transfer support', () => {
  function key() {
    const sk = ed25519.utils.randomSecretKey();
    return { sk, address: base58.encode(ed25519.getPublicKey(sk)) };
  }
  async function link(token: string) {
    const kp = key();
    const { input } = (await t.req('POST', '/wallet/nonce', token, { address: kp.address })).body;
    const bytes = new TextEncoder().encode(buildSiwsMessage(input));
    await t.req('POST', '/wallet/link', token, {
      address: kp.address,
      nonce: input.nonce,
      signedMessage: Buffer.from(bytes).toString('base64'),
      signature: Buffer.from(ed25519.sign(bytes, kp.sk)).toString('base64'),
    });
    return kp;
  }

  it('lists a participation’s transfers for both parties only, and serves a devnet blockhash to the owner', async () => {
    const { builder, tester, participationId } = await submitted();
    await t.req('POST', `/participations/${participationId}/approve`, builder.token, {});
    await link(builder.token);
    await link(tester.token);
    const intent = (await t.req('POST', '/devnet/transfers', builder.token, { participationId })).body;
    for (const u of [builder, tester]) {
      const l = await t.req('GET', `/participations/${participationId}/devnet-transfers`, u.token);
      expect(l.body.items.map((x: { id: string }) => x.id)).toEqual([intent.id]);
    }
    const stranger = await t.register('tester');
    expect((await t.req('GET', `/participations/${participationId}/devnet-transfers`, stranger.token)).status).toBe(404);

    const bh = await t.req('GET', `/devnet/transfers/${intent.id}/blockhash`, builder.token);
    expect(bh.body).toEqual({ blockhash: t.rpc.blockhash, lastValidBlockHeight: 1000 });
    expect((await t.req('GET', `/devnet/transfers/${intent.id}/blockhash`, (await t.register('builder')).token)).status).toBe(404);
    t.rpc.genesis = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
    expect((await t.req('GET', `/devnet/transfers/${intent.id}/blockhash`, builder.token)).status).toBe(503);
  });
});
