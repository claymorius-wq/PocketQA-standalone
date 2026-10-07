import { isDeepStrictEqual } from 'node:util';
import { DEMO_SHOWCASE_LABEL, DemoBuilder, DemoTester, type DemoShowcase } from '@pocket-qa/contracts';
import type { Repos } from '../repo';

/**
 * The demo showcase (POCKETQA_ENV=devnet with POCKETQA_DEMO_SHOWCASE=1): clearly labelled SYNTHETIC
 * sample profiles, stored as fixture documents in `demoProfiles` under the devnet namespace. They
 * are not accounts: no Firebase Auth user, no `users` row, no participation, ledger, points,
 * leaderboard profile or alias reservation, no payout. The real leaderboard never reads them.
 *
 * The fixture is the single source: deterministic (fixed ids and content, no clock, no randomness),
 * so the seed is idempotent. There is no deletion or reset path, here or in the store.
 */
export type DemoProfileDoc = (DemoTester & { kind: 'tester' }) | (DemoBuilder & { kind: 'builder' });

export class DemoSeedError extends Error {}

const tester = (n: number, alias: string, qualityScore: number, decided: number, badges: DemoTester['badges']): DemoProfileDoc => ({ id: `demo-${n}`, kind: 'tester', alias: `Demo ${alias}`, qualityScore, decided, badges, demo: true });
const builder = (n: number, alias: string, studiesPublished: number): DemoProfileDoc => ({ id: `demo-${n}`, kind: 'builder', alias: `Demo ${alias}`, studiesPublished, demo: true });

/**
 * Hamza (2026-10-07): the demo cohort is at most 10 profiles in total. The route never serves more,
 * and the fixture (what a seed writes in a fresh namespace) is exactly that many.
 */
export const MAX_DEMO_PROFILES = 10;

/**
 * 8 testers (demo-1 … demo-8) and 2 builders (demo-9, demo-10): modest, varied numbers. Live devnet
 * also stores demo-11 and demo-12 from before the cap; they are left as they are (never modified or
 * deleted) and never served.
 */
export function demoProfileFixtures(): DemoProfileDoc[] {
  return [
    tester(1, 'Maple', 78, 6, ['first_accepted', 'helpful_feedback']),
    tester(2, 'River', 64, 3, ['first_accepted']),
    tester(3, 'Pixel Pat', 85, 9, ['first_accepted', 'reliable_tester', 'device_specialist']),
    tester(4, 'Juniper', 52, 2, ['first_accepted']),
    tester(5, 'Orbit', 74, 5, ['first_accepted', 'helpful_feedback']),
    tester(6, 'Sage', 70, 4, ['first_accepted']),
    tester(7, 'Tidal', 68, 7, ['first_accepted', 'device_specialist']),
    tester(8, 'Clover', 60, 1, ['first_accepted']),
    builder(9, 'Lantern Labs', 3),
    builder(10, 'Birch Studio', 1),
  ];
}

/**
 * Look-alike letters for D, E, M and O that NFKC leaves alone (Cyrillic, Greek, Cherokee and other
 * scripts), folded to Latin before the "Demo" test.
 */
const DEMO_LOOKALIKES: Record<string, string> = { ԁ: 'd', Ꭰ: 'd', ᗞ: 'd', Ɗ: 'd', Е: 'e', е: 'e', Ε: 'e', ε: 'e', Ҽ: 'e', М: 'm', м: 'm', Μ: 'm', Ϻ: 'm', О: 'o', о: 'o', Ο: 'o', ο: 'o', Օ: 'o', օ: 'o' };

/**
 * pqa-qa B3 / P3-D2: does this alias read as "Demo…"? NFKC (full-width and compatibility forms),
 * zero-width and other format characters (Unicode Cf, e.g. U+200B, U+2060, U+FEFF, soft hyphen)
 * and leading spaces removed, look-alike letters folded, then /^demo/i. "Demo…" names only the
 * labelled examples: a real alias like this is refused, and the seed refuses while one exists.
 */
export function isDemoAlias(alias: string): boolean {
  const plain = [...alias.normalize('NFKC').replace(/\p{Cf}/gu, '').trimStart()].map((c) => DEMO_LOOKALIKES[c] ?? c).join('');
  return /^demo/i.test(plain);
}

/** A stored document is the fixture exactly: same fields, same values, nothing added. */
export const sameDemoDoc = (stored: unknown, fixture: DemoProfileDoc) => isDeepStrictEqual(stored, fixture);

const idNumber = (id: string) => Number(id.slice('demo-'.length));

/**
 * The response from stored documents. Each must still match the strict contract (`demo: true`, a
 * `Demo ` alias, no extra field); anything else is left out, so a stray or hand-edited document can
 * never appear as a real-looking profile. Only the fixture's ids are served (stored documents outside
 * it, such as the pre-cap demo-11/12, stay stored but unserved), and never more than MAX_DEMO_PROFILES.
 */
export function showcaseFrom(docs: unknown[]): DemoShowcase {
  const served = new Set(demoProfileFixtures().map((f) => f.id));
  const testers: DemoTester[] = [];
  const builders: DemoBuilder[] = [];
  for (const d of docs) {
    if (!d || typeof d !== 'object') continue;
    const { kind, ...row } = d as { kind?: unknown; id?: unknown };
    if (typeof row.id !== 'string' || !served.has(row.id)) continue;
    if (kind === 'tester') {
      const t = DemoTester.safeParse(row);
      if (t.success) testers.push(t.data);
    } else if (kind === 'builder') {
      const b = DemoBuilder.safeParse(row);
      if (b.success) builders.push(b.data);
    }
  }
  const byId = (a: { id: string }, b: { id: string }) => idNumber(a.id) - idNumber(b.id);
  // Testers first, then builders, up to the cap in total (a fixture-only id set already keeps it to 10).
  const shownTesters = testers.sort(byId).slice(0, MAX_DEMO_PROFILES);
  return { label: DEMO_SHOWCASE_LABEL, testers: shownTesters, builders: builders.sort(byId).slice(0, MAX_DEMO_PROFILES - shownTesters.length) };
}

/**
 * Writes the missing fixtures into the devnet namespace (fixed ids), in one transaction, then reads
 * the collection back as the route serves it. A document already equal to its fixture is left alone
 * (so a second run writes 0). A document that DIFFERS is never overwritten: the seed refuses, naming
 * the ids, and writes nothing (pqa-qa D3); changing stored demo data is a separate reviewed step.
 * Refuses any repositories but the devnet namespace's, and while a real alias reads as "Demo…"
 * (P3-D2). Touches nothing but `escrow.demo`.
 */
export async function seedDemoShowcase(repos: Repos): Promise<{ written: number; unchanged: number; total: number; readBack: number }> {
  if (repos.namespace !== 'devnet' || !repos.escrow.demo) throw new DemoSeedError('The demo seed writes only to the Firestore devnet namespace (never the production collections).');
  // pqa-qa P3-D2, read-only: never seed beside a REAL alias that reads as "Demo…" (it predates the guard).
  const clashing = (await repos.escrow.demo.realAliases()).filter(isDemoAlias).length;
  if (clashing) throw new DemoSeedError(`Refused, nothing written: ${clashing} real leaderboard alias starts with "Demo" in the devnet namespace; rename it first (the examples own that prefix).`);
  const fixtures = demoProfileFixtures();
  const result = await repos.escrow.demo.seed(fixtures);
  if (result.differing.length) throw new DemoSeedError(`Refused, nothing written: stored demo profiles differ from the fixture (${result.differing.join(', ')}). Nothing is overwritten; review them first.`);
  const served = showcaseFrom(await repos.escrow.demo.list());
  const ours = new Set(fixtures.map((f) => f.id));
  return { written: result.written, unchanged: result.unchanged, total: fixtures.length, readBack: [...served.testers, ...served.builders].filter((d) => ours.has(d.id)).length };
}
