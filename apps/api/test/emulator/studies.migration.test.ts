import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyPlan, buildManifest, mediaHasher, openSnapshot, planMigration, type SeekerReceipt } from '../../scripts/migrate-to-firestore';
import { firestoreStudiesRepo } from '../../src/repo/studies/firestore';
import { clearEmulator, emulatorFirestore } from './fs';
import { buildSyntheticSnapshot } from './studies.migration-fixture';

// Migration dry run (plan §8 steps 1–3) against a SYNTHETIC snapshot built here: the tests never
// read real data. The real snapshot is migrated only by the CLI, into a throwaway emulator.
const fs = emulatorFirestore();
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
let dir: string;
let snapshot: string;
let snapshotSha: string;
let media: string;
let seeker: SeekerReceipt;

beforeAll(() => {
  ({ dir, snapshot, snapshotSha, media, seeker } = buildSyntheticSnapshot());
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(clearEmulator);

async function dryRun() {
  const db = openSnapshot(snapshot, snapshotSha);
  const plan = planMigration(db, { mediaSha256: mediaHasher(media), seeker });
  db.close();
  await applyPlan(fs, plan);
  return { plan, manifest: await buildManifest(fs, plan, snapshotSha, seeker) };
}

describe('migration dry run (plan §8)', () => {
  it('maps every row to the repositories’ documents and guards; all checks pass', async () => {
    const { manifest } = await dryRun();
    expect(manifest.ok).toBe(true);
    const c = manifest.target.collections;
    expect(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.found]))).toEqual({
      accounts: 3, // user:b1, study:s1, user:t1 (the faucet has no totals doc)
      audit: 1,
      disputeByParticipation: 1,
      disputes: 1,
      evidence: 2,
      evidenceSegments: 2,
      evidenceUsage: 2,
      findings: 1,
      identities: 1,
      ledger: 6,
      ledgerRewards: 1,
      participationPairs: 2,
      participations: 2,
      'participations/*/notes': 1,
      storageObjects: 2, // both evidence/{id} targets; never the archived key
      studies: 1,
      'studies/*/tasks': 2,
      userEmails: 5,
      userProviders: 1,
      users: 5,
      walletAddresses: 1,
      walletLinks: 1,
    });
    expect(Object.values(c).every((v) => v.matchesPlan)).toBe(true);
    expect(manifest.relations.every((r) => r.unresolved === 0)).toBe(true);
    expect(manifest.ledger).toEqual({ accounts: 3, mismatches: 0, totalSum: 0, faucet: -30, matchesSource: true });
    expect(manifest.source.passwordHashesDropped).toBe(5);
    expect(manifest.source.skipped.sessions?.rows).toBe(1);
    // Admins are never claimable by email (plan §7(b): the audited admin-link script only).
    expect(manifest.users).toEqual({ migratedLinkPlanned: 4, migratedLinkFound: 4, adminsExcluded: 1 });
    expect((await fs.doc('users/a1').get()).data()).not.toHaveProperty('migrated_link');
    expect((await fs.doc('users/b1').get()).data()).toMatchObject({ migrated_link: 'verified_email' });
    expect(manifest.evidence.objects.find((e) => e.evidenceId === 'ev-000001')).toMatchObject({ action: 'upload-copy', sourceKey: 'm1', targetKey: 'evidence/ev-000001' });
    // The archived recording: a planned server-side copy to the app key, verified against the receipt.
    expect(manifest.seeker).toEqual({
      evidenceId: 'ev-000002',
      action: 'server-copy',
      sourceKey: seeker.key,
      targetKey: 'evidence/ev-000002',
      expectedSha256: seeker.sha256,
      participationFound: true,
      testerFound: true,
      evidenceDocPointsAtTarget: true,
      targetRegistered: true,
      archiveRegistered: false,
      playbackPrefixAllowed: true,
    });
    expect((await fs.doc('users/t1').get()).data()).toMatchObject({ migrated_link: 'verified_email', password_hash: null });
  });

  it('the migrated documents are what the studies repository reads (same shapes)', async () => {
    await dryRun();
    const repo = firestoreStudiesRepo(fs);
    expect((await repo.findParticipation('s1', 't1'))?.id).toBe('p1');
    expect((await repo.tasksOf('s1')).map((t) => t.id)).toEqual(['k1', 'k2']);
    expect(await repo.accountBalance('user:t1')).toBe(10);
    expect(await repo.accountBalance('system:test-faucet')).toBe(-30);
    expect((await repo.ledgerEntries('user:b1')).map((e) => e.kind)).toEqual(['study_reserve', 'test_topup']);
    expect(await repo.slotsFilled('s1')).toBe(2);
    expect((await repo.listDisputesByStudy('s1')).map((d) => d.id)).toEqual(['d1']);
    // The guard blocks a second reward exactly as for repo-written data.
    expect((await fs.doc('ledgerRewards/p1:reward_credit').get()).exists).toBe(true);
  });

  it('a rerun is idempotent: identical documents and an identical manifest', async () => {
    const first = (await dryRun()).manifest;
    const second = (await dryRun()).manifest;
    expect(second.manifestSha256).toBe(first.manifestSha256);
    expect(second).toEqual(first);
  });

  it('the snapshot copy is opened immutable: unchanged, no side files', async () => {
    await dryRun();
    expect(sha(readFileSync(snapshot))).toBe(snapshotSha);
    expect(readdirSync(dir).filter((f) => f.startsWith('snapshot.sqlite-'))).toEqual([]);
  });

  it('refuses a snapshot whose sha256 differs, and a Seeker receipt that does not match the media', async () => {
    expect(() => openSnapshot(snapshot, '0'.repeat(64))).toThrow(/sha256 mismatch/);
    const db = openSnapshot(snapshot, snapshotSha);
    expect(() => planMigration(db, { mediaSha256: mediaHasher(media), seeker: { ...seeker, sha256: 'f'.repeat(64) } })).toThrow(/receipt does not match/);
    db.close();
  });

  it('the CLI refuses --real without an approved manifest, a dry run without the emulator, and .preview', () => {
    const run = (args: string[], env: NodeJS.ProcessEnv) => {
      try {
        execFileSync(process.execPath, ['--import', 'tsx', 'scripts/migrate-to-firestore.ts', ...args], { cwd: join(__dirname, '..', '..'), env, stdio: 'pipe' });
        return 'exit 0';
      } catch (e) {
        return String((e as { stderr: Buffer }).stderr);
      }
    };
    const noEmu = { ...process.env, FIRESTORE_EMULATOR_HOST: '' };
    expect(run(['--real'], process.env)).toMatch(/--real needs --approved-manifest/);
    expect(run(['--snapshot', snapshot, '--expect-sha256', snapshotSha, '--media-dir', media, '--out', join(dir, 'm.json')], noEmu)).toMatch(/only to the Firestore emulator/);
    expect(run(['--snapshot', snapshot, '--expect-sha256', snapshotSha, '--media-dir', media, '--receipt', '/x/.preview/handoff/r.json', '--out', join(dir, 'm.json')], process.env)).toMatch(/must not be read from \.preview/);
  }, 60_000);
});
