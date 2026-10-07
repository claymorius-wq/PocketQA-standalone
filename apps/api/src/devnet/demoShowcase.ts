import { DEMO_PROFILE_LABEL, DemoBuilderProfile, DemoTesterProfile, type DemoShowcase } from '@pocket-qa/contracts';
import type { Repos } from '../repo';

/**
 * The demo showcase (POCKETQA_ENV=devnet with POCKETQA_DEMO_SHOWCASE=1): clearly labelled SYNTHETIC
 * sample profiles, stored as fixture documents in `demoProfiles` under the devnet namespace. They
 * are not accounts: no Firebase Auth user, no `users` row, no participations, ledger, points,
 * leaderboard profile or payouts exist for them, and the real leaderboard never reads them.
 *
 * The fixture is the single source: deterministic (fixed ids, no clock, no randomness), so the seed
 * is idempotent. There is no deletion path, here or in the store.
 */
export type DemoProfileDoc = DemoTesterProfile | DemoBuilderProfile;

export class DemoSeedError extends Error {}

const tester = (n: number, alias: string, decided: number, accepted: number, qualityScore: number, badges: DemoTesterProfile['badges']): DemoTesterProfile => ({
  id: `demo-${n}`,
  kind: 'tester',
  alias: `Demo ${alias}`,
  fixture: true,
  label: DEMO_PROFILE_LABEL,
  decided,
  acceptedRate: Math.round((100 * accepted) / decided),
  qualityScore,
  badges,
});
const builder = (n: number, alias: string, studiesPublished: number, decided: number, accepted: number, qualityScore: number): DemoBuilderProfile => ({
  id: `demo-${n}`,
  kind: 'builder',
  alias: `Demo ${alias}`,
  fixture: true,
  label: DEMO_PROFILE_LABEL,
  decided,
  acceptedRate: Math.round((100 * accepted) / decided),
  qualityScore,
  // Badges are earned by testers' work; a builder fixture has none.
  badges: [],
  studiesPublished,
});

/** 8 testers (demo-1 … demo-8) and 4 builders (demo-9 … demo-12): modest, varied numbers. */
export function demoProfileFixtures(): DemoProfileDoc[] {
  return [
    tester(1, 'Maple', 6, 5, 78, ['first_accepted', 'helpful_feedback']),
    tester(2, 'River', 3, 2, 64, ['first_accepted']),
    tester(3, 'Pixel Pat', 9, 8, 85, ['first_accepted', 'reliable_tester', 'device_specialist']),
    tester(4, 'Juniper', 2, 1, 52, ['first_accepted']),
    tester(5, 'Orbit', 5, 4, 74, ['first_accepted', 'helpful_feedback']),
    tester(6, 'Sage', 4, 3, 70, ['first_accepted']),
    tester(7, 'Tidal', 7, 5, 68, ['first_accepted', 'device_specialist']),
    tester(8, 'Clover', 1, 1, 60, ['first_accepted']),
    builder(9, 'Lantern Labs', 3, 12, 9, 80),
    builder(10, 'Birch Studio', 1, 4, 3, 72),
    builder(11, 'Fern Apps', 2, 8, 7, 84),
    builder(12, 'Quarry Games', 1, 5, 3, 66),
  ];
}

const idNumber = (id: string) => Number(id.slice('demo-'.length));

/**
 * The response from stored documents. Each document must still be a labelled fixture that matches the
 * contract exactly (`fixture: true`, the label, a `Demo ` alias, no extra field); anything else is
 * left out, so a stray or hand-edited document can never appear as a real-looking profile.
 */
export function showcaseFrom(docs: unknown[], label: DemoShowcase['label']): DemoShowcase {
  const testers: DemoTesterProfile[] = [];
  const builders: DemoBuilderProfile[] = [];
  for (const d of docs) {
    const t = DemoTesterProfile.safeParse(d);
    if (t.success) testers.push(t.data);
    const b = DemoBuilderProfile.safeParse(d);
    if (b.success) builders.push(b.data);
  }
  const byId = (a: { id: string }, b: { id: string }) => idNumber(a.id) - idNumber(b.id);
  return { label, testers: testers.sort(byId), builders: builders.sort(byId) };
}

/**
 * Writes the fixture into the devnet namespace (fixed ids, set with merge; a document already equal
 * on every fixture field is left alone), then reads the collection back. Refuses any repositories
 * but the devnet namespace's: never the production collections.
 */
export async function seedDemoShowcase(repos: Repos): Promise<{ written: number; unchanged: number; total: number; readBack: number }> {
  if (repos.namespace !== 'devnet' || !repos.escrow.demo) throw new DemoSeedError('The demo seed writes only to the Firestore devnet namespace (never the production collections).');
  const fixtures = demoProfileFixtures();
  const { written, unchanged } = await repos.escrow.demo.seed(fixtures);
  const stored = await repos.escrow.demo.list();
  const ours = new Set(fixtures.map((f) => f.id));
  return { written, unchanged, total: fixtures.length, readBack: stored.filter((d) => ours.has((d as { id?: string }).id ?? '')).length };
}
