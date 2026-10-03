import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DISPUTE_WINDOW_MS } from '@pocket-qa/domain';
import { makeApp, MP4, PNG, seeded, DEVICE, STUDY, type TestApp } from './helpers';

// Regression tests for Phase 2-3 review round 1 (docs/reviews/phase2-3/verdict-qa-r1.md).
let t: TestApp;
beforeEach(async () => {
  t = await makeApp();
});
afterEach(async () => t.close());

async function rejected() {
  const s = await seeded(t);
  await t.req('POST', `/participations/${s.participationId}/submit`, s.tester.token);
  await t.req('POST', `/participations/${s.participationId}/reject`, s.builder.token, { reason: 'Did not attempt task two.' });
  return s;
}

describe('finding 1: reject-then-close cannot strip the dispute right', () => {
  it('blocks close during the dispute window and keeps the reward on hold', async () => {
    const { builder, tester, participationId, study } = await rejected();
    const close = await t.req('POST', `/studies/${study.id}/close`, builder.token);
    expect(close.status).toBe(409);
    expect(close.body.message).toMatch(/dispute window/);
    const s = (await t.req('GET', `/studies/${study.id}`, builder.token)).body;
    expect(s.budget.committed).toBe(50);
    expect((await t.req('POST', '/disputes', tester.token, { participationId, reason: 'I did attempt task two, see notes.' })).status).toBe(200);
  });

  it('after the window: no new dispute, the hold releases, and close succeeds', async () => {
    const { builder, tester, participationId, study } = await rejected();
    t.clock.now += DISPUTE_WINDOW_MS;
    expect((await t.req('POST', '/disputes', tester.token, { participationId, reason: 'Too late but trying anyway.' })).status).toBe(409);
    expect((await t.req('GET', `/studies/${study.id}`, builder.token)).body.budget.committed).toBe(0);
    expect((await t.req('POST', `/studies/${study.id}/close`, builder.token)).status).toBe(200);
  });
});

describe('finding 2: deletion scrubs dispute text, transfer addresses, audit notes and playback tokens', () => {
  it('removes residual personal data', async () => {
    const { builder, tester, participationId } = await rejected();
    const admin = await t.admin();
    const d = (await t.req('POST', '/disputes', tester.token, { participationId, reason: 'My personal explanation text.' })).body;
    await t.req('POST', `/admin/disputes/${d.id}/resolve`, admin.token, { outcome: 'upheld', note: 'Upheld after review.' });
    await t.req('POST', `/admin/moderation/users/${tester.id}`, admin.token, { action: 'suspend', reason: 'Tester Jane Roe posted spam' });
    await t.req('POST', `/admin/moderation/users/${tester.id}`, admin.token, { action: 'reinstate', reason: 'Reinstated Jane Roe' });
    t.db
      .prepare(
        `INSERT INTO devnet_transfers (id, participation_id, builder_id, tester_id, sender, recipient, lamports, status, created_at, expires_at)
         VALUES ('tx1', ?, ?, ?, 'SenderAddr', 'RecipientAddr', 1, 'failed', 'x', 'x')`,
      )
      .run(participationId, builder.id, tester.id);
    expect((await t.req('DELETE', '/me', tester.token, { confirm: 'DELETE MY ACCOUNT' })).status).toBe(200);
    const dispute = t.db.prepare('SELECT reason FROM disputes WHERE id = ?').get(d.id) as { reason: string };
    expect(dispute.reason).toBe('[deleted]');
    expect(t.db.prepare(`SELECT COUNT(*) AS n FROM devnet_transfers WHERE tester_id = ? OR builder_id = ?`).get(tester.id, tester.id)).toEqual({ n: 0 });
    const audits = t.db.prepare(`SELECT reason FROM audit WHERE target_id = ?`).all(tester.id) as { reason: string }[];
    expect(audits.length).toBe(2);
    expect(audits.every((a) => a.reason === '[redacted on account deletion]')).toBe(true);
  });

  it('deletion revokes the user’s playback tokens', async () => {
    const { builder, tester, participationId } = await seeded(t);
    const ev = (await t.upload(tester.token, participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'k0' })).body;
    // The builder's own token for the tester's evidence must die with the evidence too.
    const mine = (await t.req('POST', `/evidence/${ev.id}/playback-token`, tester.token)).body.token;
    const theirs = (await t.req('POST', `/evidence/${ev.id}/playback-token`, builder.token)).body.token;
    expect((await t.req('GET', `/media/${mine}`)).status).toBe(200);
    expect((await t.req('DELETE', '/me', tester.token, { confirm: 'DELETE MY ACCOUNT' })).status).toBe(200);
    expect((await t.req('GET', `/media/${mine}`)).status).toBe(404);
    expect((await t.req('GET', `/media/${theirs}`)).status).toBe(404);
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM playback_tokens').get()).toEqual({ n: 0 });
  });

  it('logout revokes the user’s playback tokens', async () => {
    const { tester, participationId } = await seeded(t);
    const ev = (await t.upload(tester.token, participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'k1' })).body;
    const { token } = (await t.req('POST', `/evidence/${ev.id}/playback-token`, tester.token)).body;
    expect((await t.req('GET', `/media/${token}`)).status).toBe(200);
    await t.req('POST', '/auth/logout', tester.token);
    expect((await t.req('GET', `/media/${token}`)).status).toBe(404);
  });
});

describe('finding 3: earnings / fake-payment wording in all builder and admin text', () => {
  it('rejects banned wording in approve notes, findings and dispute resolutions', async () => {
    const { builder, tester, participationId } = await seeded(t);
    await t.req('POST', `/participations/${participationId}/submit`, tester.token);
    const f1 = await t.req('POST', `/participations/${participationId}/findings`, builder.token, { title: 'Payment sent to you', severity: 'info', description: 'ok' });
    expect(f1.status).toBe(400);
    const f2 = await t.req('POST', `/participations/${participationId}/findings`, builder.token, { title: 'Fine title', severity: 'info', description: 'You earned money, get paid soon' });
    expect(f2.status).toBe(400);
    const a = await t.req('POST', `/participations/${participationId}/approve`, builder.token, { note: 'Payment complete, you earned 50!' });
    expect(a.status).toBe(400);
    expect((await t.req('POST', `/participations/${participationId}/approve`, builder.token, { note: 'Clear, useful session.' })).status).toBe(200);
  });

  it('rejects banned wording in admin dispute resolution notes', async () => {
    const { tester, participationId } = await rejected();
    const admin = await t.admin();
    const d = (await t.req('POST', '/disputes', tester.token, { participationId, reason: 'Please re-check my work.' })).body;
    const r = await t.req('POST', `/admin/disputes/${d.id}/resolve`, admin.token, { outcome: 'overturned', note: 'Guaranteed payout coming' });
    expect(r.status).toBe(400);
  });
});

describe('final QA P2: no fake-payment wording from builders', () => {
  it('rejects "paid", payout and currency claims in approve notes and findings', async () => {
    const { builder, tester, participationId } = await seeded(t);
    await t.req('POST', `/participations/${participationId}/submit`, tester.token);
    for (const note of ['You’ve been paid', "You've been paid — payout of 50 USDC sent to your wallet", 'Bonus $20 for you']) {
      const r = await t.req('POST', `/participations/${participationId}/approve`, builder.token, { note });
      expect(r.status, note).toBe(400);
    }
    const f = await t.req('POST', `/participations/${participationId}/findings`, builder.token, { title: 'Payout processed', severity: 'info', description: 'ok text' });
    expect(f.status).toBe(400);
    expect((await t.req('POST', `/participations/${participationId}/approve`, builder.token, { note: 'Great session, thanks.' })).status).toBe(200);
  });
});

describe('copy scopes: study content may describe prices and devnet SOL', () => {
  it('accepts payment wording in study tasks but still rejects earnings promises', async () => {
    const b = await t.register('builder');
    const ok = await t.req('POST', '/studies', b.token, {
      ...STUDY,
      tasks: [{ instruction: 'Buy the $5 item and reach checkout' }, { instruction: 'Send 0.1 SOL on devnet and verify the payment is successful' }],
    });
    expect(ok.status).toBe(200);
    const bad = await t.req('POST', '/studies', b.token, { ...STUDY, objective: 'Earn money while testing our checkout' });
    expect(bad.status).toBe(400);
  });

  it('rejects money promised to testers in study text (review r1 P2)', async () => {
    const b = await t.register('builder');
    for (const body of [
      { ...STUDY, title: 'Payout: 20 USDC per tester' },
      { ...STUDY, objective: 'Testers receive $25 each for this checkout study.' },
      { ...STUDY, tasks: [{ instruction: 'Bonus: $20 for completing this flow' }] },
    ]) {
      const r = await t.req('POST', '/studies', b.token, body);
      expect(r.status, JSON.stringify(body).slice(0, 80)).toBe(400);
    }
  });
});

describe('P3 fixes', () => {
  it('accepts only real MP4 brands for ftyp files (HEIC/AVIF/MOV are not MP4)', async () => {
    const { tester, participationId } = await seeded(t);
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(64)]);
    expect((await t.upload(tester.token, participationId, heic, { kind: 'screen_recording', capturedOn: 'android', clientSegmentId: 'h1' })).status).toBe(400);
    expect((await t.upload(tester.token, participationId, MP4, { kind: 'screen_recording', capturedOn: 'android', clientSegmentId: 'h2' })).status).toBe(200);
  });

  it('hides studies of suspended builders from testers and refuses new work on them', async () => {
    const { builder, study } = await seeded(t);
    const admin = await t.admin();
    const t2 = await t.register('tester');
    await t.req('PUT', '/me/device', t2.token, DEVICE);
    expect((await t.req('GET', '/studies/eligible', t2.token)).body.items).toHaveLength(1);
    await t.req('POST', `/admin/moderation/users/${builder.id}`, admin.token, { action: 'suspend', reason: 'Abusive study content' });
    expect((await t.req('GET', '/studies/eligible', t2.token)).body.items).toHaveLength(0);
    expect((await t.req('POST', `/studies/${study.id}/consent`, t2.token, { consentVersion: 1, accepted: true })).status).toBe(404);
  });
});
