import { afterEach, describe, expect, it } from 'vitest';
import { Leaderboard, Reputation } from '@pocket-qa/contracts';
import { DEVICE, makeApp, STUDY, type TestApp } from './helpers';

// Reputation: points, badges and the opt-in leaderboard (pqa-qa local-slice matrix H1–H6).
let t: TestApp;
afterEach(async () => t?.close());

async function study(slots = 10) {
  const b = await t.register('builder');
  await t.req('POST', '/me/credits/test-topup', b.token, { amount: 5000 });
  const s = (await t.req('POST', '/studies', b.token, { ...STUDY, slots })).body;
  await t.req('POST', `/studies/${s.id}/publish`, b.token);
  return { b, s };
}
async function tester() {
  const u = await t.register('tester');
  await t.req('PUT', '/me/device', u.token, DEVICE);
  return u;
}
async function submit(u: { token: string }, studyId: string) {
  const p = (await t.req('POST', `/studies/${studyId}/consent`, u.token, { consentVersion: 1, accepted: true })).body;
  await t.req('POST', `/participations/${p.id}/start`, u.token);
  await t.req('POST', `/participations/${p.id}/submit`, u.token);
  return p.id as string;
}
const rep = async (u: { token: string }) => Reputation.parse((await t.req('GET', '/me/reputation', u.token)).body);

describe('H1/H5/H6: points only for accepted work, once, with no cash value', () => {
  it('approval earns 10 (+5 helpful); uploading, submitting, rejection and disputing earn or cost nothing', async () => {
    t = await makeApp();
    const { b, s } = await study();
    const u = await tester();
    const p1 = await submit(u, s.id);
    expect((await rep(u)).points).toBe(0);
    await t.req('POST', `/participations/${p1}/approve`, b.token, { helpful: true });
    await t.req('POST', `/participations/${p1}/approve`, b.token, { helpful: true }); // second approval refused
    const r = await rep(u);
    expect(r).toMatchObject({ points: 15, noCashValue: true });
    expect(r.events.map((e) => e.kind).sort()).toEqual(['accepted', 'helpful']);
    expect(r.badges.map((x) => x.id)).toContain('first_accepted');
    // Every badge with the count toward it, earned exactly when it is listed (the app's badge shelf).
    expect(r.progress.map((x) => x.id)).toEqual(['first_accepted', 'reliable_tester', 'helpful_feedback', 'device_specialist']);
    expect(r.progress[0]).toEqual({ id: 'first_accepted', earned: true, current: 1, target: 1 });
    expect(r.progress.find((x) => x.id === 'helpful_feedback')).toEqual({ id: 'helpful_feedback', earned: false, current: 1, target: 3 });
    // A rejection and a dispute: no points lost, no penalty.
    const { b: b2, s: s2 } = await study();
    const p2 = await submit(u, s2.id);
    await t.req('POST', `/participations/${p2}/reject`, b2.token, { reason: 'The recording stops early.' });
    await t.req('POST', '/disputes', u.token, { participationId: p2, reason: 'The last task was recorded too.' });
    expect((await rep(u)).points).toBe(15);
  });

  it('an overturned dispute earns the accepted points (but not the builder-only helpful mark)', async () => {
    t = await makeApp();
    const { b, s } = await study();
    const u = await tester();
    const p = await submit(u, s.id);
    await t.req('POST', `/participations/${p}/reject`, b.token, { reason: 'The recording stops early.' });
    const d = (await t.req('POST', '/disputes', u.token, { participationId: p, reason: 'The last task was recorded too.' })).body;
    const a = await t.admin();
    await t.req('POST', `/admin/disputes/${d.id}/resolve`, a.token, { outcome: 'overturned', note: 'It was recorded.' });
    expect((await rep(u)).points).toBe(10);
  });

  it('only the study owner can mark feedback helpful (approve is owner-scoped); duplicate awards are ignored by the database', async () => {
    t = await makeApp();
    const { b, s } = await study();
    const u = await tester();
    const p = await submit(u, s.id);
    await t.req('POST', `/participations/${p}/approve`, b.token, {});
    if (t.db) {
      expect(() =>
        t.db!.prepare(`INSERT INTO points_events (id, user_id, participation_id, kind, points, platform, created_at) VALUES ('dup', ?, ?, 'accepted', 10, 'web', '2026-10-05T00:00:00Z')`).run(u.id, p),
      ).toThrow(/UNIQUE/);
    } else {
      // Firestore: the award guard (plan r2 §R2 row 30) holds the slot, so a second award can't be created.
      await expect(t.fs!.collection('pointsAwards').doc(`${p}:accepted`).create({ event_id: 'dup' })).rejects.toThrow(/ALREADY_EXISTS|already exists/i);
    }
    expect((await rep(u)).points).toBe(10);
  });
});

describe('H2: an upheld fraud finding reverses points, append-only', () => {
  it('reverses once, keeps the history, and only admins can do it', async () => {
    t = await makeApp();
    const { b, s } = await study();
    const u = await tester();
    const p = await submit(u, s.id);
    await t.req('POST', `/participations/${p}/approve`, b.token, { helpful: true });
    expect((await t.req('POST', `/admin/participations/${p}/fraud`, b.token, { reason: 'Duplicate clip from another tester.' })).status).toBe(403);
    const a = await t.admin();
    expect((await t.req('POST', `/admin/participations/${p}/fraud`, a.token, { reason: 'Duplicate clip from another tester.' })).status).toBe(200);
    expect((await t.req('POST', `/admin/participations/${p}/fraud`, a.token, { reason: 'Duplicate clip from another tester.' })).status).toBe(409);
    const r = await rep(u);
    expect(r.points).toBe(0);
    expect(r.events.map((e) => e.kind).sort()).toEqual(['accepted', 'helpful', 'reversal', 'reversal']);
    expect(r.badges.map((x) => x.id)).not.toContain('first_accepted');
    // SQLite enforces append-only with a trigger; on Firestore the repository has no update or delete.
    if (t.db) expect(() => t.db!.prepare('DELETE FROM points_events').run()).toThrow(/append-only/);
    expect((await t.deps.repo.core.listAudit()).filter((x) => x.action === 'reputation.fraud_upheld')).toHaveLength(1);
  });

  it('only accepted work can be marked fraudulent', async () => {
    t = await makeApp();
    const { s } = await study();
    const u = await tester();
    const p = await submit(u, s.id);
    const a = await t.admin();
    expect((await t.req('POST', `/admin/participations/${p}/fraud`, a.token, { reason: 'Duplicate clip from another tester.' })).status).toBe(409);
  });
});

describe('H3: self-dealing withholds points and flags the work', () => {
  it('a tester paid from a wallet that funded one of the same builder’s studies earns no points', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const b = await t.register('builder');
    const w = await t.linkWallet(b.token);
    const { rewardCredits: _, ...rest } = STUDY;
    const s = (await t.req('POST', '/studies', b.token, { ...rest, slots: 2, payment: { mode: 'escrow', rewardUnits: 1_000_000 } })).body;
    const f = (await t.req('POST', `/studies/${s.id}/escrow/fundings`, b.token)).body;
    const pay = (await t.req('POST', `/escrow/fundings/${f.id}/simulated-wallet-payment`, b.token)).body;
    await t.req('POST', `/escrow/fundings/${f.id}/signature`, b.token, { signature: pay.signature });
    await t.req('POST', `/studies/${s.id}/publish`, b.token);
    // The builder's funding wallet moves to an "alt" tester account after consent-time checks.
    const alt = await tester();
    const altWallet = await t.linkWallet(alt.token);
    const p = (await t.req('POST', `/studies/${s.id}/consent`, alt.token, { consentVersion: 1, accepted: true, payoutAddress: altWallet.address })).body;
    // Simulate the shared wallet (Firestore also keeps the builder-funding-wallet index the check reads).
    if (t.db) t.db.prepare('UPDATE study_escrows SET funding_wallet = ? WHERE study_id = ?').run(altWallet.address, s.id);
    else {
      await t.fs!.collection('studyEscrows').doc(s.id).update({ funding_wallet: altWallet.address });
      await t.fs!.collection('builderFundingWallets').doc(`${b.id}:${altWallet.address}`).set({ builder_id: b.id, wallet: altWallet.address });
    }
    await t.req('POST', `/participations/${p.id}/start`, alt.token);
    await t.req('POST', `/participations/${p.id}/submit`, alt.token);
    await t.req('POST', `/participations/${p.id}/approve`, b.token, { helpful: true });
    expect((await rep(alt)).points).toBe(0);
    const flag = t.db ? t.db.prepare('SELECT reason FROM points_flags WHERE participation_id = ?').get(p.id) : (await t.fs!.collection('pointsFlags').doc(p.id).get()).data();
    expect(flag).toMatchObject({ reason: expect.stringMatching(/wallet/) });
    void w;
  });
});

describe('H4: the leaderboard is opt-in, pseudonymous and quality-ranked', () => {
  it('lists only opted-in testers with enough decided work, by alias, with no ids, wallets or emails', async () => {
    t = await makeApp();
    const { b, s } = await study(20);
    const careful = await tester();
    const hidden = await tester();
    for (const u of [careful, hidden]) {
      for (let i = 0; i < 3; i++) {
        const { b: bi, s: si } = i === 0 ? { b, s } : await study();
        const p = await submit(u, si.id);
        await t.req('POST', `/participations/${p}/approve`, bi.token, {});
      }
    }
    expect((await t.req('PUT', '/me/leaderboard', careful.token, { optIn: true, alias: 'Careful Cat' })).status).toBe(200);
    // An alias may not look like an email or a wallet, and must be unique.
    expect((await t.req('PUT', '/me/leaderboard', hidden.token, { optIn: true, alias: 'someone@example.test' })).status).toBe(400);
    expect((await t.req('PUT', '/me/leaderboard', hidden.token, { optIn: true, alias: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV' })).status).toBe(400);
    expect((await t.req('PUT', '/me/leaderboard', hidden.token, { optIn: true, alias: 'careful cat' })).status).toBe(409);
    const board = Leaderboard.parse((await t.req('GET', '/leaderboard', b.token)).body);
    expect(board.items.map((r) => r.alias)).toEqual(['Careful Cat']);
    const raw = JSON.stringify((await t.req('GET', '/leaderboard', b.token)).body);
    expect(raw).not.toContain(careful.id);
    expect(raw).not.toContain(careful.email);
    expect(raw).not.toMatch(/@|wallet|address/i);
    // Opting out removes the tester at once.
    await t.req('PUT', '/me/leaderboard', careful.token, { optIn: false });
    expect(Leaderboard.parse((await t.req('GET', '/leaderboard', b.token)).body).items).toEqual([]);
  });

  it('deleting the account removes the leaderboard pseudonym at once', async () => {
    t = await makeApp();
    const u = await tester();
    await t.req('PUT', '/me/leaderboard', u.token, { optIn: true, alias: 'Gone Soon' });
    expect((await t.req('DELETE', '/me', u.token, { confirm: 'DELETE MY ACCOUNT' })).status).toBe(200);
    expect(t.db ? (t.db.prepare('SELECT COUNT(*) AS n FROM leaderboard_profiles').get() as { n: number }).n : (await t.fs!.collection('leaderboardProfiles').get()).size).toBe(0);
  });

  it('builders and admins have no leaderboard profile', async () => {
    t = await makeApp();
    const b = await t.register('builder');
    expect((await t.req('PUT', '/me/leaderboard', b.token, { optIn: true, alias: 'Builder Bob' })).status).toBe(403);
  });
});
