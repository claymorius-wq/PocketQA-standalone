import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ClientConfig, DEMO_SHOWCASE_LABEL, DemoBuilder, DemoShowcase, DemoTester, Leaderboard, routes } from '@pocket-qa/contracts';
import { reputationHandlers } from '../src/handlers/reputation';
import { hostedConfig } from '../src/hosted/app';
import { demoProfileFixtures, DemoSeedError, isDemoAlias, MAX_DEMO_PROFILES, sameDemoDoc, seedDemoShowcase, showcaseFrom, type DemoProfileDoc } from '../src/devnet/demoShowcase';
import type { Repos } from '../src/repo';
import type { DemoProfilesStore } from '../src/repo/escrow/types';
import { DEVICE, makeApp, STUDY, type TestApp } from './helpers';

// The demo showcase (Hamza via the lead, 2026-10-07; pqa-qa acceptance bar r1 A–D): labelled
// SYNTHETIC fixtures in the devnet namespace only. These run on SQLite and pure code; the Firestore
// side (collection counts, idempotency, D3, the route, /leaderboard and /me/reputation unchanged) is
// test/emulator/devnet.demo.test.ts.

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

describe('the fixture (D1)', () => {
  const all = demoProfileFixtures();
  const testers = all.filter((p) => p.kind === 'tester');
  const builders = all.filter((p) => p.kind === 'builder');

  it('Hamza: at most 10 demo profiles in total: 8 testers and 2 builders with fixed ids demo-1 … demo-10', () => {
    expect(MAX_DEMO_PROFILES).toBe(10);
    expect(all).toHaveLength(MAX_DEMO_PROFILES);
    expect(testers).toHaveLength(8);
    expect(builders).toHaveLength(2);
    expect(all.map((p) => p.id)).toEqual(Array.from({ length: 10 }, (_, i) => `demo-${i + 1}`));
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
    expect(new Set(all.map((p) => p.alias.toLowerCase())).size).toBe(10);
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
    const docs = [f[9], f[1], { ...a, id: 'demo-20', demo: false }, { ...a, id: 'demo-21', alias: 'Real Person' }, { ...a, id: 'demo-23', email: 'x@example.test' }, { ...a, id: 'user-1' }, { ...a, id: 'demo-24', kind: 'admin' }, null, a];
    const out = DemoShowcase.parse(showcaseFrom(docs));
    expect(out.label).toBe(DEMO_SHOWCASE_LABEL);
    expect(DEMO_SHOWCASE_LABEL).toBe('Demo examples (not real users)');
    expect(out.testers.map((p) => p.id)).toEqual(['demo-1', 'demo-2']);
    expect(out.builders.map((p) => p.id)).toEqual(['demo-10']);
    expect(JSON.stringify(out)).not.toContain('kind');
  });

  it('Hamza cap: the 12 docs stored before the cap (demo-11/12 included) serve exactly 10: the 8 testers + demo-9, demo-10', () => {
    const out = DemoShowcase.parse(showcaseFrom([...LEGACY_BUILDERS, ...demoProfileFixtures()].reverse()));
    expect(out.testers.map((p) => p.id)).toEqual(['demo-1', 'demo-2', 'demo-3', 'demo-4', 'demo-5', 'demo-6', 'demo-7', 'demo-8']);
    expect(out.builders.map((p) => p.id)).toEqual(['demo-9', 'demo-10']);
    expect(out.testers.length + out.builders.length).toBe(MAX_DEMO_PROFILES);
  });

  it('never serves more than MAX_DEMO_PROFILES, whatever is stored (ids outside the fixture are not served)', () => {
    const f = demoProfileFixtures();
    const extra = Array.from({ length: 30 }, (_, i) => ({ ...f[0]!, id: `demo-${20 + i}` }));
    const out = showcaseFrom([...extra, ...f, ...LEGACY_BUILDERS]);
    expect(out.testers.length + out.builders.length).toBe(MAX_DEMO_PROFILES);
    expect([...out.testers, ...out.builders].map((p) => p.id)).toEqual(f.map((p) => p.id));
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

  it('store mode but not the devnet namespace (here SQLite): still 404 FEATURE_UNAVAILABLE', async () => {
    t = await makeApp({ demoShowcase: 'store' });
    const r = await t.req('GET', '/demo/showcase');
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('FEATURE_UNAVAILABLE');
  });
});

describe('the hosted staging cohort (fixtures mode, Hamza 2026-10-07): served from code, never from data', () => {
  it('serves exactly 10: the 8 testers + demo-9, demo-10 (never demo-11/12), "Demo " aliases, demo: true; /config says on', async () => {
    t = await makeApp({ demoShowcase: 'fixtures' });
    const r = await t.req('GET', '/demo/showcase');
    expect(r.status).toBe(200);
    const show = DemoShowcase.parse(r.body);
    expect(show.label).toBe('Demo examples (not real users)');
    expect(show.testers.map((p) => p.id)).toEqual(['demo-1', 'demo-2', 'demo-3', 'demo-4', 'demo-5', 'demo-6', 'demo-7', 'demo-8']);
    expect(show.builders.map((p) => p.id)).toEqual(['demo-9', 'demo-10']);
    expect(show.testers.length + show.builders.length).toBe(MAX_DEMO_PROFILES);
    expect(JSON.stringify(show)).not.toMatch(/demo-1[12]/);
    for (const p of [...show.testers, ...show.builders]) expect(p).toMatchObject({ demo: true, alias: expect.stringMatching(/^Demo /) });
    expect(ClientConfig.parse((await t.req('GET', '/config')).body).features.demoShowcase).toBe(true);
  });

  it('the real staging config, end to end through the handler: 10 served with every repository trapped (no Firestore read, no write)', async () => {
    const { config } = hostedConfig({ ...STAGING_ENV, CRON_SECRET: 'c'.repeat(40) } as NodeJS.ProcessEnv);
    const trap = new Proxy({}, { get: (_, k) => { throw new Error(`the showcase touched the repository (${String(k)})`); } });
    const out = DemoShowcase.parse(await reputationHandlers.demoShowcase({ deps: { config, repo: trap } } as never));
    expect(out.testers.length + out.builders.length).toBe(10);
  });

  it('the production env serves nothing: /config off and 404', async () => {
    const prod = hostedConfig({ ...STAGING_ENV, POCKETQA_ENV: 'production', POCKETQA_SETTLEMENT: 'off', CRON_SECRET: 'c'.repeat(40) } as NodeJS.ProcessEnv).config;
    expect(prod.demoShowcase).toBe('off');
    await expect(reputationHandlers.demoShowcase({ deps: { config: prod, repo: {} } } as never)).rejects.toMatchObject({ code: 'FEATURE_UNAVAILABLE', status: 404 });
    t = await makeApp({ production: true });
    expect((await t.req('GET', '/demo/showcase')).status).toBe(404);
    expect(ClientConfig.parse((await t.req('GET', '/config')).body).features.demoShowcase).toBe(false);
  });

  it('the real /leaderboard and /me/reputation are byte-identical with the showcase on and off', async () => {
    t = await makeApp();
    const app = t;
    const b = await app.register('builder');
    await app.req('POST', '/me/credits/test-topup', b.token, { amount: 5000 });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const s = (await app.req('POST', '/studies', b.token, { ...STUDY, slots: 10 })).body;
      await app.req('POST', `/studies/${s.id}/publish`, b.token);
      ids.push(s.id);
    }
    const u = await app.register('tester');
    await app.req('PUT', '/me/device', u.token, DEVICE);
    for (const id of ids) {
      const p = (await app.req('POST', `/studies/${id}/consent`, u.token, { consentVersion: 1, accepted: true })).body;
      await app.req('POST', `/participations/${p.id}/start`, u.token);
      await app.req('POST', `/participations/${p.id}/submit`, u.token);
      await app.req('POST', `/participations/${p.id}/approve`, b.token, {});
    }
    expect((await app.req('PUT', '/me/leaderboard', u.token, { optIn: true, alias: 'Careful Cat' })).status).toBe(200);
    const raw = async (url: string, token: string) => (await app.app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${token}` } })).body;
    const snap = async () => [await raw('/leaderboard', b.token), await raw('/me/reputation', u.token)];
    const off = await snap();
    expect(Leaderboard.parse(JSON.parse(off[0]!)).items.map((r) => r.alias)).toEqual(['Careful Cat']);
    app.deps.config.demoShowcase = 'fixtures';
    expect((await app.req('GET', '/demo/showcase')).status).toBe(200);
    expect(await snap()).toEqual(off);
    expect(off.join('')).not.toMatch(/Demo |demo-/);
  });
});

/** The staging env the hosted app runs with (placeholders; settlement simulated). */
const STAGING_ENV = {
  POCKETQA_ENV: 'staging',
  POCKETQA_DATA_BACKEND: 'firestore',
  POCKETQA_AUTH_MODE: 'firebase',
  POCKETQA_FIREBASE_PROJECT_ID: 'pocketqa-optijara',
  POCKETQA_FIREBASE_WEB_API_KEY: 'public-web-key', // check-secrets: allow (placeholder public Firebase web config in tests)
  POCKETQA_PUBLIC_ORIGIN: 'https://pocketqa.example',
  POCKETQA_STORAGE: 'r2',
  POCKETQA_R2_ACCOUNT_ID: 'a'.repeat(32),
  POCKETQA_R2_BUCKET: 'pocketqa-evidence',
  POCKETQA_R2_ACCESS_KEY_ID: 'key-id',
  POCKETQA_R2_SECRET_ACCESS_KEY: 'not-a-real-secret', // check-secrets: allow (placeholder test value)
  POCKETQA_R2_ALLOW_DELETE: '1',
  POCKETQA_SETTLEMENT: 'simulated',
};

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
    expect(await seedDemoShowcase(onlyDemo(m.store))).toEqual({ written: 10, unchanged: 0, total: 10, readBack: 10 });
    expect(await seedDemoShowcase(onlyDemo(m.store))).toEqual({ written: 0, unchanged: 10, total: 10, readBack: 10 });
    expect(m.writes()).toBe(10);
  });

  it('a partial state (3 of 10) gets exactly the missing 7', async () => {
    const f = demoProfileFixtures();
    const m = memoryStore(Object.fromEntries(f.slice(0, 3).map((d) => [d.id, structuredClone(d)])));
    expect(await seedDemoShowcase(onlyDemo(m.store))).toEqual({ written: 7, unchanged: 3, total: 10, readBack: 10 });
  });

  it('Hamza cap: the 12 docs stored before the cap: writes 0, refuses nothing, leaves demo-11/12 stored as they are', async () => {
    const stored = Object.fromEntries([...demoProfileFixtures(), ...LEGACY_BUILDERS].map((d) => [d.id, structuredClone(d)]));
    const m = memoryStore(stored);
    expect(await seedDemoShowcase(onlyDemo(m.store))).toEqual({ written: 0, unchanged: 10, total: 10, readBack: 10 });
    expect(m.writes()).toBe(0);
    expect(m.docs.size).toBe(12);
    expect(m.docs.get('demo-11')).toEqual(LEGACY_BUILDERS[0]);
    expect(m.docs.get('demo-12')).toEqual(LEGACY_BUILDERS[1]);
  });

  it('QA P3-D2: refuses, writing nothing, while a REAL alias in the namespace starts with Demo (read-only pre-check)', async () => {
    const m = memoryStore({}, ['Careful Cat', 'D\u200Bemo Old']);
    await expect(seedDemoShowcase(onlyDemo(m.store))).rejects.toThrow(/Refused, nothing written: 1 real leaderboard alias starts with "Demo"/);
    expect(m.writes()).toBe(0);
    const ok = memoryStore({}, ['Careful Cat', 'Maple Demo']);
    expect(await seedDemoShowcase(onlyDemo(ok.store))).toMatchObject({ written: 10 });
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
    expect(s).toMatch(/if \(config\.demoShowcase !== 'store'\) throw/);
    expect(s).toMatch(/namespace: 'devnet'/);
  });
  it('the leaderboard and reputation code never read demoProfiles (B2)', () => {
    expect(src('src/repo/escrow/firestore.ts')).not.toMatch(/collection\(['"]demoProfiles/);
    expect(src('src/reputation.ts')).not.toMatch(/demo/i);
  });
});
