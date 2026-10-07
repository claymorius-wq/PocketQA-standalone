import { describe, expect, it, vi } from 'vitest';

// pqa-qa P3-D1: the demo seed makes NO Firebase Auth call. Every firebase-admin/auth export is a
// stub that records and throws; the seed's whole module graph (the CLI's imports: config, the
// fixture, the repositories with the Firestore demo store) is loaded and the seed runs end to end.
const authCalls: string[] = [];
vi.mock('firebase-admin/auth', () =>
  new Proxy(
    {},
    {
      get: (_, k) => {
        if (k === '__esModule' || k === 'then' || typeof k === 'symbol') return undefined;
        return (..._args: unknown[]) => {
          authCalls.push(String(k));
          throw new Error(`Firebase Auth called: ${String(k)}`);
        };
      },
      has: () => true,
    },
  ),
);

describe('the demo seed and Firebase Auth', () => {
  it('loads the seed path and seeds without a single Auth call', async () => {
    await import('../src/config');
    await import('../src/repo');
    const { seedDemoShowcase } = await import('../src/devnet/demoShowcase');
    const docs = new Map<string, unknown>();
    const demo = {
      list: async () => [...docs.values()],
      realAliases: async () => [],
      seed: async (fixtures: { id: string }[]) => {
        for (const f of fixtures) docs.set(f.id, f);
        return { written: fixtures.length, unchanged: 0, differing: [] };
      },
    };
    const trap = new Proxy({}, { get: (_, k) => { throw new Error(`touched ${String(k)}`); } });
    const repos = { kind: 'firestore', namespace: 'devnet', core: trap, studies: trap, evidence: trap, escrow: { demo } } as never;
    expect(await seedDemoShowcase(repos)).toMatchObject({ written: 10, readBack: 10 });
    expect(authCalls).toEqual([]);
  });
});
