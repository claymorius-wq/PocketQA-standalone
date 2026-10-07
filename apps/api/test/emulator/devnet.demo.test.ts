// The demo showcase on Firestore, in the devnet namespace (Hamza via the lead, 2026-10-07): the seed
// is idempotent and writes only demoProfiles under pocketqaNamespaces/devnet; GET /demo/showcase
// serves the labelled fixtures only with the flag; the real GET /leaderboard is identical with and
// without the seed. Pure and SQLite checks: test/demo-showcase.test.ts.
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_PROFILE_LABEL, DEMO_SHOWCASE_LABEL, DemoShowcase, Leaderboard } from '@pocket-qa/contracts';
import { seedDemoShowcase } from '../../src/devnet/demoShowcase';
import { DEVNET_ROOT } from '../../src/firestore/namespace';
import { DEVICE, makeApp, STUDY, type TestApp } from '../helpers';
import { emulatorFirestore } from './fs';

process.env.PQA_TEST_BACKEND = 'firestore';
process.env.PQA_TEST_NAMESPACE = 'devnet';
const raw = emulatorFirestore();
let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const namespaceCollections = async () => (await raw.doc(DEVNET_ROOT).listCollections()).map((c) => c.id).sort();

describe('the seed (devnet namespace only, idempotent, no accounts)', () => {
  it('writes the 12 fixtures under the namespace; a second run changes nothing; drift is repaired', async () => {
    t = await makeApp();
    const before = await namespaceCollections();
    expect(await seedDemoShowcase(t.deps.repo)).toEqual({ written: 12, unchanged: 0, total: 12, readBack: 12 });
    expect(await seedDemoShowcase(t.deps.repo)).toEqual({ written: 0, unchanged: 12, total: 12, readBack: 12 });
    // Only demoProfiles appeared: no users, leaderboard profiles, participations, ledger, points or settlements.
    expect((await namespaceCollections()).filter((c) => !before.includes(c))).toEqual(['demoProfiles']);
    expect((await raw.collection(`${DEVNET_ROOT}/demoProfiles`).get()).docs.map((d) => d.id).sort()).toEqual(Array.from({ length: 12 }, (_, i) => `demo-${i + 1}`).sort());
    // Nothing outside the namespace.
    expect((await raw.listCollections()).map((c) => c.id)).toEqual(['pocketqaNamespaces']);
    // A hand-edited document is set back (merge, one write); the others stay unchanged.
    await raw.doc(`${DEVNET_ROOT}/demoProfiles/demo-3`).update({ qualityScore: 1 });
    expect(await seedDemoShowcase(t.deps.repo)).toMatchObject({ written: 1, unchanged: 11 });
    expect((await raw.doc(`${DEVNET_ROOT}/demoProfiles/demo-3`).get()).data()!.qualityScore).toBe(85);
  });
});

describe('GET /demo/showcase in the devnet namespace', () => {
  it('flag on: public, labelled, 8 testers and 4 builders in fixture order (empty before the seed)', async () => {
    t = await makeApp({ demoShowcase: true });
    expect((await t.req('GET', '/demo/showcase')).body).toEqual({ label: DEMO_SHOWCASE_LABEL, testers: [], builders: [] });
    await seedDemoShowcase(t.deps.repo);
    const r = await t.req('GET', '/demo/showcase');
    expect(r.status).toBe(200);
    const show = DemoShowcase.parse(r.body);
    expect(show.testers.map((p) => p.id)).toEqual(['demo-1', 'demo-2', 'demo-3', 'demo-4', 'demo-5', 'demo-6', 'demo-7', 'demo-8']);
    expect(show.builders.map((p) => p.id)).toEqual(['demo-9', 'demo-10', 'demo-11', 'demo-12']);
    for (const p of [...show.testers, ...show.builders]) expect(p).toMatchObject({ fixture: true, label: DEMO_PROFILE_LABEL, alias: expect.stringMatching(/^Demo /) });
  });

  it('flag off: 404 even with the fixtures seeded', async () => {
    t = await makeApp();
    await seedDemoShowcase(t.deps.repo);
    const r = await t.req('GET', '/demo/showcase');
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('NOT_FOUND');
  });
});

describe('the real leaderboard is unchanged by the seed', () => {
  it('the ranking is identical with and without the demo fixtures (and never shows a Demo alias)', async () => {
    t = await makeApp({ demoShowcase: true });
    const app = t;
    const b = await app.register('builder');
    await app.req('POST', '/me/credits/test-topup', b.token, { amount: 5000 });
    const study = async () => {
      const s = (await app.req('POST', '/studies', b.token, { ...STUDY, slots: 10 })).body;
      await app.req('POST', `/studies/${s.id}/publish`, b.token);
      return s.id as string;
    };
    const ids = [await study(), await study(), await study()];
    for (const [alias, approvals] of [['Careful Cat', 3], ['Steady Sam', 3]] as const) {
      const u = await app.register('tester');
      await app.req('PUT', '/me/device', u.token, DEVICE);
      for (let i = 0; i < approvals; i++) {
        const p = (await app.req('POST', `/studies/${ids[i]}/consent`, u.token, { consentVersion: 1, accepted: true })).body;
        await app.req('POST', `/participations/${p.id}/start`, u.token);
        await app.req('POST', `/participations/${p.id}/submit`, u.token);
        await app.req('POST', `/participations/${p.id}/${alias === 'Steady Sam' && i === 0 ? 'reject' : 'approve'}`, b.token, alias === 'Steady Sam' && i === 0 ? { reason: 'The recording stops early.' } : {});
      }
      expect((await app.req('PUT', '/me/leaderboard', u.token, { optIn: true, alias })).status).toBe(200);
    }
    const without = Leaderboard.parse((await app.req('GET', '/leaderboard', b.token)).body);
    expect(without.items.length).toBeGreaterThan(0);
    await seedDemoShowcase(app.deps.repo);
    const withSeed = Leaderboard.parse((await app.req('GET', '/leaderboard', b.token)).body);
    expect(withSeed).toEqual(without);
    expect(JSON.stringify(withSeed)).not.toMatch(/Demo |demo-/);
  });
});
