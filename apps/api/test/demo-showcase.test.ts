import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_PROFILE_LABEL, DemoBuilderProfile, DemoShowcase, DemoTesterProfile, routes } from '@pocket-qa/contracts';
import { DEMO_SHOWCASE_LABEL } from '@pocket-qa/contracts';
import { demoProfileFixtures, DemoSeedError, seedDemoShowcase, showcaseFrom } from '../src/devnet/demoShowcase';
import { makeApp, type TestApp } from './helpers';

// The demo showcase (Hamza via the lead, 2026-10-07): labelled SYNTHETIC fixtures in the devnet
// namespace only. These run on SQLite and pure code; the Firestore side (seed idempotency, the route
// in the namespace, the leaderboard left unchanged) is test/emulator/devnet.demo.test.ts.

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('the fixture', () => {
  const all = demoProfileFixtures();
  const testers = all.filter((p) => p.kind === 'tester');
  const builders = all.filter((p) => p.kind === 'builder');

  it('is 8 testers and 4 builders with fixed ids demo-1 … demo-12', () => {
    expect(testers).toHaveLength(8);
    expect(builders).toHaveLength(4);
    expect(all.map((p) => p.id)).toEqual(Array.from({ length: 12 }, (_, i) => `demo-${i + 1}`));
  });

  it('is deterministic (no clock, no randomness): two calls are identical', () => {
    expect(demoProfileFixtures()).toEqual(all);
    expect(JSON.stringify(demoProfileFixtures())).toBe(JSON.stringify(all));
  });

  it('every profile is a labelled fixture that matches the strict contract', () => {
    for (const p of all) {
      expect(p.alias.startsWith('Demo ')).toBe(true);
      expect(p).toMatchObject({ fixture: true, label: DEMO_PROFILE_LABEL });
      expect((p.kind === 'tester' ? DemoTesterProfile : DemoBuilderProfile).safeParse(p).success, p.id).toBe(true);
    }
    expect(DEMO_PROFILE_LABEL).toBe('Demo example (not a real user)');
  });

  it('carries no account data: no user id, email, wallet or uid-like field or value', () => {
    const raw = JSON.stringify(all);
    expect(raw).not.toMatch(/@|wallet|address|email|userId|user_id|uid/i);
    expect(raw).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  });

  it('numbers are modest, varied and consistent (acceptedRate is a whole percent of decided)', () => {
    for (const p of all) {
      expect(p.decided).toBeGreaterThan(0);
      expect(p.decided).toBeLessThanOrEqual(12);
      expect(p.qualityScore).toBeGreaterThanOrEqual(50);
      expect(p.qualityScore).toBeLessThanOrEqual(90);
      const accepted = Math.round((p.acceptedRate * p.decided) / 100);
      expect(Math.round((100 * accepted) / p.decided), p.id).toBe(p.acceptedRate);
    }
    expect(new Set(testers.map((p) => p.qualityScore)).size).toBe(8);
    expect(new Set(testers.map((p) => p.decided)).size).toBeGreaterThan(5);
    for (const b of builders) expect(b).toMatchObject({ badges: [], studiesPublished: expect.any(Number) });
  });
});

describe('showcaseFrom: only contract-exact labelled fixtures are served', () => {
  it('drops anything unlabelled, non-Demo, with extra fields, or not a fixture; sorts by fixture id', () => {
    const [a, b] = demoProfileFixtures();
    const docs = [
      demoProfileFixtures()[10],
      b,
      { ...a!, id: 'demo-20', fixture: false },
      { ...a!, id: 'demo-21', alias: 'Real Person' },
      { ...a!, id: 'demo-22', label: 'A user' },
      { ...a!, id: 'demo-23', email: 'x@example.test' },
      { ...a!, id: 'user-1' },
      a,
    ];
    const out = DemoShowcase.parse(showcaseFrom(docs, DEMO_SHOWCASE_LABEL));
    expect(out.testers.map((p) => p.id)).toEqual(['demo-1', 'demo-2']);
    expect(out.builders.map((p) => p.id)).toEqual(['demo-11']);
    expect(out.label).toBe(DEMO_SHOWCASE_LABEL);
  });
});

describe('GET /demo/showcase off the devnet namespace', () => {
  it('is a public GET in the contract, not a user route', () => {
    expect(routes.demoShowcase).toMatchObject({ method: 'GET', path: '/demo/showcase', auth: 'public' });
  });

  it('flag off: 404 like an unknown route', async () => {
    t = await makeApp();
    const r = await t.req('GET', '/demo/showcase');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ code: 'NOT_FOUND', message: 'Route not found.' });
  });

  it('flag on but not the devnet namespace (here SQLite): still 404', async () => {
    t = await makeApp({ demoShowcase: true });
    const r = await t.req('GET', '/demo/showcase');
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('NOT_FOUND');
  });
});

describe('the seed refuses anything but the devnet namespace', () => {
  it('refuses SQLite repositories, writing nothing', async () => {
    t = await makeApp();
    await expect(seedDemoShowcase(t.deps.repo)).rejects.toThrow(DemoSeedError);
  });
});

describe('no deletion path, and the leaderboard code untouched (static)', () => {
  const src = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');
  it('the seed script, the fixture module and the store never delete', () => {
    for (const f of ['scripts/devnet-seed-demo.ts', 'src/devnet/demoShowcase.ts', 'src/repo/escrow/demoProfiles.ts']) {
      expect(src(f), f).not.toMatch(/\.delete\(|recursiveDelete|deleteDoc|\bdelete\b\s*\w/);
    }
  });
  it('the seed creates no sign-in: nothing on the seed path imports Firebase Auth', () => {
    for (const f of ['scripts/devnet-seed-demo.ts', 'src/devnet/demoShowcase.ts', 'src/repo/escrow/demoProfiles.ts']) expect(src(f), f).not.toMatch(/firebase-admin\/auth|identity/);
  });
  it('the seed script loads the devnet config and refuses outside POCKETQA_ENV=devnet', () => {
    const s = src('scripts/devnet-seed-demo.ts');
    expect(s).toMatch(/loadConfig\(process\.env\)/);
    expect(s).toMatch(/if \(!config\.devnet\) throw/);
    expect(s).toMatch(/namespace: 'devnet'/);
  });
  it('the leaderboard reads only leaderboardProfiles (never demoProfiles)', () => {
    expect(src('src/repo/escrow/firestore.ts')).not.toMatch(/collection\(['"]demoProfiles/);
    expect(src('src/reputation.ts')).not.toMatch(/demo/i);
  });
});
