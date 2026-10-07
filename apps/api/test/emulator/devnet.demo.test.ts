// The demo showcase on Firestore, in the devnet namespace (Hamza via the lead, 2026-10-07; pqa-qa
// acceptance bar r1): the seed writes ONLY pocketqaNamespaces/devnet/demoProfiles (+10, every other
// collection's count unchanged), run 2 changes nothing (updateTime), a partial state gets only the
// missing documents, a differing one is refused untouched; GET /demo/showcase serves the demo rows
// only with the flag; GET /leaderboard and GET /me/reputation are byte-identical with and without
// the seed and the flag. Pure and SQLite checks: test/demo-showcase.test.ts.
import type { Firestore } from 'firebase-admin/firestore';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_SHOWCASE_LABEL, DemoShowcase, Leaderboard } from '@pocket-qa/contracts';
import { demoProfileFixtures, MAX_DEMO_PROFILES, seedDemoShowcase } from '../../src/devnet/demoShowcase';
import { DEVNET_ROOT } from '../../src/firestore/namespace';
import { DEVICE, makeApp, STUDY, type TestApp } from '../helpers';
import { emulatorFirestore } from './fs';

process.env.PQA_TEST_BACKEND = 'firestore';
process.env.PQA_TEST_NAMESPACE = 'devnet';
const raw = emulatorFirestore();
const DEMO = `${DEVNET_ROOT}/demoProfiles`;
/** The two builder docs live devnet holds from before the 10-profile cap (exact stored content). */
const LEGACY_BUILDERS = [
  { id: 'demo-11', kind: 'builder', alias: 'Demo Fern Apps', studiesPublished: 2, demo: true },
  { id: 'demo-12', kind: 'builder', alias: 'Demo Quarry Games', studiesPublished: 1, demo: true },
];
let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** Document count of every root collection and every collection under the namespace (A2). */
async function counts(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const add = async (parent: Firestore | FirebaseFirestore.DocumentReference, prefix: string) => {
    for (const c of await parent.listCollections()) out[`${prefix}${c.id}`] = (await c.count().get()).data().count;
  };
  await add(raw, '/');
  await add(raw.doc(DEVNET_ROOT), 'devnet/');
  return out;
}
const updateTimes = async () => Object.fromEntries((await raw.collection(DEMO).get()).docs.map((d) => [d.id, d.updateTime.toMillis()]));

/** A real fixture: one builder, two opted-in testers with decided work (so the ranking isn't empty). */
async function realLeaderboard(app: TestApp) {
  const b = await app.register('builder');
  await app.req('POST', '/me/credits/test-topup', b.token, { amount: 5000 });
  const ids: string[] = [];
  for (let i = 0; i < 3; i++) {
    const s = (await app.req('POST', '/studies', b.token, { ...STUDY, slots: 10 })).body;
    await app.req('POST', `/studies/${s.id}/publish`, b.token);
    ids.push(s.id);
  }
  const testers = [];
  for (const alias of ['Careful Cat', 'Steady Sam']) {
    const u = await app.register('tester');
    await app.req('PUT', '/me/device', u.token, DEVICE);
    for (let i = 0; i < 3; i++) {
      const p = (await app.req('POST', `/studies/${ids[i]}/consent`, u.token, { consentVersion: 1, accepted: true })).body;
      await app.req('POST', `/participations/${p.id}/start`, u.token);
      await app.req('POST', `/participations/${p.id}/submit`, u.token);
      const reject = alias === 'Steady Sam' && i === 0;
      await app.req('POST', `/participations/${p.id}/${reject ? 'reject' : 'approve'}`, b.token, reject ? { reason: 'The recording stops early.' } : {});
    }
    expect((await app.req('PUT', '/me/leaderboard', u.token, { optIn: true, alias })).status).toBe(200);
    testers.push(u);
  }
  return { b, testers };
}
const rawBody = async (app: TestApp, url: string, token: string) => (await app.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })).body;

describe('the seed (A1–A3, D2, D3)', () => {
  it('the only delta is demoProfiles +10 (Hamza: at most 10); run 2 = 0 changes (updateTime unchanged)', async () => {
    t = await makeApp();
    await realLeaderboard(t);
    const before = await counts();
    expect(await seedDemoShowcase(t.deps.repo)).toEqual({ written: 10, unchanged: 0, total: 10, readBack: 10 });
    const after = await counts();
    expect(after).toEqual({ ...before, 'devnet/demoProfiles': 10 });
    expect(before['devnet/demoProfiles']).toBeUndefined();
    expect(Object.keys(after).filter((k) => k.startsWith('/'))).toEqual(['/pocketqaNamespaces']);
    expect((await raw.collection(DEMO).get()).docs.map((d) => d.id).sort()).toEqual(demoProfileFixtures().map((f) => f.id).sort());
    const times = await updateTimes();
    expect(await seedDemoShowcase(t.deps.repo)).toEqual({ written: 0, unchanged: 10, total: 10, readBack: 10 });
    expect(await updateTimes()).toEqual(times);
    expect(await counts()).toEqual(after);
  });

  it('a partial state (3 of 10) gets exactly the missing 7; the 3 are not rewritten', async () => {
    t = await makeApp();
    for (const f of demoProfileFixtures().slice(0, 3)) await raw.doc(`${DEMO}/${f.id}`).create(f);
    const times = await updateTimes();
    expect(await seedDemoShowcase(t.deps.repo)).toEqual({ written: 7, unchanged: 3, total: 10, readBack: 10 });
    const now = await updateTimes();
    for (const id of Object.keys(times)) expect(now[id]).toBe(times[id]);
  });

  it('a differing document is never overwritten: refused, nothing written', async () => {
    t = await makeApp();
    const f = demoProfileFixtures();
    await raw.doc(`${DEMO}/${f[2]!.id}`).create({ ...f[2], qualityScore: 1 });
    await raw.doc(`${DEMO}/${f[9]!.id}`).create({ ...f[9], note: 'hand-added' });
    const times = await updateTimes();
    await expect(seedDemoShowcase(t.deps.repo)).rejects.toThrow(/demo-3, demo-10.*Nothing is overwritten/);
    expect(await updateTimes()).toEqual(times);
    expect((await raw.collection(DEMO).count().get()).data().count).toBe(2);
  });
});

describe('QA P3-D2: the read-only pre-check on real aliases', () => {
  it('reads only the namespace; refuses (nothing written) while a real profile there has a Demo… alias', async () => {
    t = await makeApp();
    // A root (production-path) profile is never read: the seed proceeds.
    await raw.doc('leaderboardProfiles/u-root').create({ user_id: 'u-root', opted_in: 1, alias: 'Demo Root', updated_at: '2026-10-01T00:00:00.000Z' });
    expect(await seedDemoShowcase(t.deps.repo)).toMatchObject({ written: 10 });
    // Written directly into the namespace: the API now refuses such an alias, but one may predate the guard.
    await raw.doc(`${DEVNET_ROOT}/leaderboardProfiles/u-old`).create({ user_id: 'u-old', opted_in: 1, alias: 'DemoMaple', updated_at: '2026-10-01T00:00:00.000Z' });
    const times = await updateTimes();
    await expect(seedDemoShowcase(t.deps.repo)).rejects.toThrow(/1 real leaderboard alias starts with "Demo"/);
    expect(await updateTimes()).toEqual(times);
  });
});

describe('GET /demo/showcase in the devnet namespace (B4, C2)', () => {
  it('flag on: public, labelled, 8 testers and 2 builders (10 at most), every row demo: true (empty before the seed)', async () => {
    t = await makeApp({ demoShowcase: true });
    expect((await t.req('GET', '/demo/showcase')).body).toEqual({ label: DEMO_SHOWCASE_LABEL, testers: [], builders: [] });
    await seedDemoShowcase(t.deps.repo);
    const r = await t.req('GET', '/demo/showcase');
    expect(r.status).toBe(200);
    const show = DemoShowcase.parse(r.body);
    expect(show.testers.map((p) => p.id)).toEqual(['demo-1', 'demo-2', 'demo-3', 'demo-4', 'demo-5', 'demo-6', 'demo-7', 'demo-8']);
    expect(show.builders.map((p) => p.id)).toEqual(['demo-9', 'demo-10']);
    for (const p of [...show.testers, ...show.builders]) expect(p).toMatchObject({ demo: true, alias: expect.stringMatching(/^Demo /) });
  });

  it('Hamza cap: the live state (12 stored: demo-11/12 from before the cap) serves 10; the seed writes 0 and leaves all 12 as they are', async () => {
    t = await makeApp({ demoShowcase: true });
    for (const d of [...demoProfileFixtures(), ...LEGACY_BUILDERS]) await raw.doc(`${DEMO}/${d.id}`).create(d);
    const times = await updateTimes();
    const show = DemoShowcase.parse((await t.req('GET', '/demo/showcase')).body);
    expect(show.testers).toHaveLength(8);
    expect(show.builders.map((p) => p.id)).toEqual(['demo-9', 'demo-10']);
    expect(show.testers.length + show.builders.length).toBe(MAX_DEMO_PROFILES);
    expect(await seedDemoShowcase(t.deps.repo)).toEqual({ written: 0, unchanged: 10, total: 10, readBack: 10 });
    expect(await updateTimes()).toEqual(times);
    expect(Object.keys(times)).toHaveLength(12);
    expect((await raw.doc(`${DEMO}/demo-12`).get()).data()).toEqual(LEGACY_BUILDERS[1]);
  });

  it('flag off: 404 FEATURE_UNAVAILABLE even with the fixtures seeded', async () => {
    t = await makeApp();
    await seedDemoShowcase(t.deps.repo);
    const r = await t.req('GET', '/demo/showcase');
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('FEATURE_UNAVAILABLE');
  });
});

describe('the real ranking is unchanged (B1, B3)', () => {
  it('/leaderboard and /me/reputation are byte-identical with and without the seed, flag on and off', async () => {
    t = await makeApp();
    const { b, testers } = await realLeaderboard(t);
    const snapshot = async () => [await rawBody(t!, '/leaderboard', b.token), ...(await Promise.all(testers.map((u) => rawBody(t!, '/me/reputation', u.token))))];
    const setFlag = (on: boolean) => {
      t!.deps.config.devnet = on ? { platform: '', arbiter: '', feeWallet: '', allowedEmails: [], signer: { kind: 'env' }, limits: t!.deps.config.devnet?.limits ?? { global: { lamports: 0, usdcUnits: 0 }, perUser: { lamports: 0, usdcUnits: 0 } }, demoShowcase: true } : null;
    };
    const base = await snapshot();
    expect(Leaderboard.parse(JSON.parse(base[0]!)).items.length).toBeGreaterThan(0);
    setFlag(true);
    expect(await snapshot()).toEqual(base);
    await seedDemoShowcase(t.deps.repo);
    expect(await snapshot()).toEqual(base);
    setFlag(false);
    expect(await snapshot()).toEqual(base);
    expect(base.join('')).not.toMatch(/Demo |demo-/);
    // The demo aliases reserve nothing in leaderboardAliases (2 = the two real testers).
    expect((await t.fs!.collection('leaderboardAliases').count().get()).data().count).toBe(2);
  });
});
