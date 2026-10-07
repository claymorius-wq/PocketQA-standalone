import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_SHOWCASE_LABEL, DemoBuilder, DemoShowcase, DemoTester, routes } from '@pocket-qa/contracts';
import { demoProfileFixtures, DemoSeedError, isDemoAlias, sameDemoDoc, seedDemoShowcase, showcaseFrom, type DemoProfileDoc } from '../src/devnet/demoShowcase';
import type { Repos } from '../src/repo';
import type { DemoProfilesStore } from '../src/repo/escrow/types';
import { makeApp, type TestApp } from './helpers';

// The demo showcase (Hamza via the lead, 2026-10-07; pqa-qa acceptance bar r1 A–D): labelled
// SYNTHETIC fixtures in the devnet namespace only. These run on SQLite and pure code; the Firestore
// side (collection counts, idempotency, D3, the route, /leaderboard and /me/reputation unchanged) is
// test/emulator/devnet.demo.test.ts.

let t: TestApp | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe('the fixture (D1)', () => {
  const all = demoProfileFixtures();
  const testers = all.filter((p) => p.kind === 'tester');
  const builders = all.filter((p) => p.kind === 'builder');

  it('is 8 testers and 4 builders with fixed ids demo-1 … demo-12', () => {
    expect(testers).toHaveLength(8);
    expect(builders).toHaveLength(4);
    expect(all.map((p) => p.id)).toEqual(Array.from({ length: 12 }, (_, i) => `demo-${i + 1}`));
  });

  it('is deterministic (no clock, no randomness): two calls are byte-identical', () => {
    expect(JSON.stringify(demoProfileFixtures())).toBe(JSON.stringify(all));
  });

  it('every row is demo: true with a "Demo " alias and matches the strict contract', () => {
    for (const { kind, ...row } of all) {
      expect(row.alias.startsWith('Demo ')).toBe(true);
      expect(row.demo).toBe(true);
      expect((kind === 'tester' ? DemoTester : DemoBuilder).safeParse(row).success, row.id).toBe(true);
    }
    expect(new Set(all.map((p) => p.alias.toLowerCase())).size).toBe(12);
  });

  it('carries no account data and no earnings, credit or USDC number', () => {
    const raw = JSON.stringify(all);
    expect(raw).not.toMatch(/@|wallet|address|email|userId|user_id|uid|credit|usdc|earn|reward|payout|amount|units|lamport/i);
    expect(raw).not.toMatch(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
  });

  it('numbers are modest and varied', () => {
    for (const p of testers as Extract<DemoProfileDoc, { kind: 'tester' }>[]) {
      expect(p.decided).toBeGreaterThan(0);
      expect(p.decided).toBeLessThanOrEqual(12);
      expect(p.qualityScore).toBeGreaterThanOrEqual(50);
      expect(p.qualityScore).toBeLessThanOrEqual(90);
    }
    expect(new Set(testers.map((p) => (p as { qualityScore: number }).qualityScore)).size).toBe(8);
    for (const b of builders as Extract<DemoProfileDoc, { kind: 'builder' }>[]) expect(b.studiesPublished).toBeLessThanOrEqual(5);
  });
});

describe('showcaseFrom: only contract-exact demo rows are served (B4)', () => {
  it('drops anything not demo: true, non-"Demo ", with extra fields or an unknown kind; strips kind; sorts by fixture id', () => {
    const f = demoProfileFixtures();
    const a = f[0]!;
    const docs = [f[10], f[1], { ...a, id: 'demo-20', demo: false }, { ...a, id: 'demo-21', alias: 'Real Person' }, { ...a, id: 'demo-23', email: 'x@example.test' }, { ...a, id: 'user-1' }, { ...a, id: 'demo-24', kind: 'admin' }, null, a];
    const out = DemoShowcase.parse(showcaseFrom(docs));
    expect(out.label).toBe(DEMO_SHOWCASE_LABEL);
    expect(DEMO_SHOWCASE_LABEL).toBe('Demo examples (not real users)');
    expect(out.testers.map((p) => p.id)).toEqual(['demo-1', 'demo-2']);
    expect(out.builders.map((p) => p.id)).toEqual(['demo-11']);
    expect(JSON.stringify(out)).not.toContain('kind');
  });
});

describe('GET /demo/showcase off the devnet namespace (C2)', () => {
  it('is a public GET in the contract', () => {
    expect(routes.demoShowcase).toMatchObject({ method: 'GET', path: '/demo/showcase', auth: 'public' });
  });

  it('flag off: 404 FEATURE_UNAVAILABLE', async () => {
    t = await makeApp();
    const r = await t.req('GET', '/demo/showcase');
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('FEATURE_UNAVAILABLE');
  });

  it('flag on but not the devnet namespace (here SQLite): still 404 FEATURE_UNAVAILABLE', async () => {
    t = await makeApp({ demoShowcase: true });
    const r = await t.req('GET', '/demo/showcase');
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('FEATURE_UNAVAILABLE');
  });
});

/** Repos whose every member except `namespace` and `escrow.demo` throws when touched (A4: no Auth, no other data). */
function onlyDemo(demo: DemoProfilesStore, ns: 'devnet' | 'root' = 'devnet'): Repos {
  const namespace = ns === 'devnet' ? 'devnet' : undefined;
  const trap = (name: string) => new Proxy({}, { get: (_, k) => { throw new Error(`the seed touched ${name}.${String(k)}`); } });
  const escrow = new Proxy({}, { get: (_, k) => { if (k === 'demo') return demo; throw new Error(`the seed touched escrow.${String(k)}`); } });
  return { kind: 'firestore', namespace, core: trap('core'), studies: trap('studies'), evidence: trap('evidence'), escrow } as unknown as Repos;
}
/** An in-memory store with the Firestore store's rules (differing → nothing written; missing → created). */
function memoryStore(initial: Record<string, unknown> = {}, realAliases: string[] = []) {
  const docs = new Map(Object.entries(initial));
  let writes = 0;
  const store: DemoProfilesStore = {
    list: async () => [...docs.values()],
    realAliases: async () => realAliases,
    async seed(fixtures) {
      const differing = fixtures.filter((f) => docs.has(f.id) && !sameDemoDoc(docs.get(f.id), f)).map((f) => f.id);
      if (differing.length) return { written: 0, unchanged: 0, differing };
      const missing = fixtures.filter((f) => !docs.has(f.id));
      for (const f of missing) docs.set(f.id, structuredClone(f));
      writes += missing.length;
      return { written: missing.length, unchanged: fixtures.length - missing.length, differing: [] };
    },
  };
  return { store, docs, writes: () => writes };
}

describe('B3 / QA P3-D2: "Demo…" is reserved for the labelled examples', () => {
  it('isDemoAlias: NFKC, zero-width and format characters stripped, look-alike letters folded, then /^demo/i', () => {
    for (const a of ['Demo', 'DemoMaple', 'Demo Maple', 'demo maple', 'DEMO-Maple', 'Demonstrator', '  Demo', '\u200BDemo Maple', 'D\u200Bemo', 'De\u200Dmo\u2060X', '\uFEFFDemo', 'D\u00ADemo', 'Ｄｅｍｏ Maple', 'Dеmo', 'DЕMО', 'Dεmο', 'ԁemo', 'ᎠEMO', 'ⅮEMO']) {
      expect(isDemoAlias(a), JSON.stringify(a)).toBe(true);
    }
    for (const a of ['Careful Cat', 'Maple Demo', 'Dem0', 'Deme', 'D emo', 'Mode']) expect(isDemoAlias(a), JSON.stringify(a)).toBe(false);
  });

  it('a real tester cannot take a Demo alias through the API (any case, bare "Demo", no separator); other aliases still work', async () => {
    t = await makeApp();
    const u = await t.register('tester');
    for (const alias of ['Demo Maple', 'demo maple', 'DEMO-Maple', 'Demo_x', 'DemoMaple', 'Demo', 'Demonstrator']) {
      const r = await t.req('PUT', '/me/leaderboard', u.token, { optIn: true, alias });
      expect(r.status, alias).toBe(400);
      expect(r.body.message).toMatch(/reserved for the labelled demo examples/);
    }
    // Non-ASCII look-alikes never reach the guard: the alias contract is ASCII-only (400 VALIDATION).
    expect((await t.req('PUT', '/me/leaderboard', u.token, { optIn: true, alias: 'Dеmo Maple' })).status).toBe(400);
    expect((await t.req('PUT', '/me/leaderboard', u.token, { optIn: true, alias: 'Maple Demo' })).status).toBe(200);
  });
});

describe('the seed (A3, A4, D2, D3)', () => {
  it('refuses SQLite repositories and a non-namespaced Firestore repo, writing nothing', async () => {
    t = await makeApp();
    await expect(seedDemoShowcase(t.deps.repo)).rejects.toThrow(DemoSeedError);
    const m = memoryStore();
    await expect(seedDemoShowcase(onlyDemo(m.store, 'root'))).rejects.toThrow(/only to the Firestore devnet namespace/);
    expect(m.writes()).toBe(0);
  });

  it('touches nothing but the demo store (no core/identity, studies, evidence or other escrow call); run 2 = 0 changes', async () => {
    const m = memoryStore();
    expect(await seedDemoShowcase(onlyDemo(m.store))).toEqual({ written: 12, unchanged: 0, total: 12, readBack: 12 });
    expect(await seedDemoShowcase(onlyDemo(m.store))).toEqual({ written: 0, unchanged: 12, total: 12, readBack: 12 });
    expect(m.writes()).toBe(12);
  });

  it('a partial state (3 of 12) gets exactly the missing 9', async () => {
    const f = demoProfileFixtures();
    const m = memoryStore(Object.fromEntries(f.slice(0, 3).map((d) => [d.id, structuredClone(d)])));
    expect(await seedDemoShowcase(onlyDemo(m.store))).toEqual({ written: 9, unchanged: 3, total: 12, readBack: 12 });
  });

  it('QA P3-D2: refuses, writing nothing, while a REAL alias in the namespace starts with Demo (read-only pre-check)', async () => {
    const m = memoryStore({}, ['Careful Cat', 'D\u200Bemo Old']);
    await expect(seedDemoShowcase(onlyDemo(m.store))).rejects.toThrow(/Refused, nothing written: 1 real leaderboard alias starts with "Demo"/);
    expect(m.writes()).toBe(0);
    const ok = memoryStore({}, ['Careful Cat', 'Maple Demo']);
    expect(await seedDemoShowcase(onlyDemo(ok.store))).toMatchObject({ written: 12 });
  });

  it('a differing document (changed or extra field) is never overwritten: refused with the ids, nothing written', async () => {
    const f = demoProfileFixtures();
    const m = memoryStore({ 'demo-3': { ...f[2], qualityScore: 1 }, 'demo-9': { ...f[8], note: 'hand-added' } });
    await expect(seedDemoShowcase(onlyDemo(m.store))).rejects.toThrow(/demo-3, demo-9.*Nothing is overwritten/);
    expect(m.writes()).toBe(0);
    expect(m.docs.size).toBe(2);
  });
});

describe('no deletion path; no Auth; the CLI gate; the leaderboard code untouched (static)', () => {
  const src = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');
  const seedPath = ['scripts/devnet-seed-demo.ts', 'src/devnet/demoShowcase.ts', 'src/repo/escrow/demoProfiles.ts'];
  it('the seed script, the fixture module and the store never delete or reset', () => {
    for (const f of seedPath) expect(src(f), f).not.toMatch(/\.delete\(|recursiveDelete|deleteDoc|reset\w*\(|\.update\(/);
  });
  it('nothing on the seed path imports Firebase Auth or identity', () => {
    for (const f of seedPath) expect(src(f), f).not.toMatch(/firebase-admin\/auth|identity/);
  });
  it('the seed CLI refuses unless POCKETQA_ENV=devnet AND POCKETQA_DEMO_SHOWCASE=1 (C4)', () => {
    const s = src('scripts/devnet-seed-demo.ts');
    expect(s).toMatch(/loadConfig\(process\.env\)/);
    expect(s).toMatch(/if \(!config\.devnet\) throw/);
    expect(s).toMatch(/if \(!config\.devnet\.demoShowcase\) throw/);
    expect(s).toMatch(/namespace: 'devnet'/);
  });
  it('the leaderboard and reputation code never read demoProfiles (B2)', () => {
    expect(src('src/repo/escrow/firestore.ts')).not.toMatch(/collection\(['"]demoProfiles/);
    expect(src('src/reputation.ts')).not.toMatch(/demo/i);
  });
});
