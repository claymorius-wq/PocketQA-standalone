import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  mediaHasher,
  openSnapshot,
  plannedManifest,
  planMigration,
  realRun,
  Refused,
  s3ObjectStore,
  type ObjectStore,
  type Plan,
  type SeekerReceipt,
} from '../../scripts/migrate-to-firestore';
import { FakeS3 } from '../fakeS3';
import { clearEmulator, emulatorFirestore } from './fs';
import { buildSyntheticSnapshot } from './studies.migration-fixture';

// The REAL-RUN mode (plan §8.3–8.5) end to end, against the emulator (a demo- project) and FakeS3
// instead of hosted Firestore and R2. Synthetic snapshot only; no cloud call is possible here.
const fs = emulatorFirestore();
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');
const BUCKET = 'pocketqa-evidence';
const run = promisify(execFile);

let fx: ReturnType<typeof buildSyntheticSnapshot>;
let plan: Plan;
let approved: string;
let s3: FakeS3;
let store: ObjectStore;
let endpoint: string;
let archiveBytes: Buffer;

const obj = (key: string) => s3.objects.get(`${BUCKET}/${key}`);
const realOpts = (over: Partial<Parameters<typeof realRun>[0]> = {}) => ({
  fs,
  store,
  plan,
  snapshotSha256: fx.snapshotSha,
  seeker: fx.seeker,
  approvedSha256: approved,
  mediaDir: fx.media,
  ...over,
});

beforeAll(async () => {
  fx = buildSyntheticSnapshot();
  const db = openSnapshot(fx.snapshot, fx.snapshotSha);
  plan = planMigration(db, { mediaSha256: mediaHasher(fx.media), seeker: fx.seeker });
  db.close();
  approved = plannedManifest(plan, fx.snapshotSha, fx.seeker).manifestSha256!;
  archiveBytes = readFileSync(join(fx.media, 'm2'));
  s3 = new FakeS3();
  endpoint = await s3.start();
  store = s3ObjectStore({ endpoint, bucket: BUCKET, accessKeyId: 'test-key-id', secretAccessKey: 'test-secret-key' }); // check-secrets: allow (fake S3 test credentials)
});
afterAll(async () => {
  await s3.stop();
  rmSync(fx.dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await clearEmulator();
  // R2 before the run: only the Seeker archive exists.
  s3.objects.clear();
  s3.puts.length = 0;
  s3.objects.set(`${BUCKET}/${fx.seeker.key}`, { body: Buffer.from(archiveBytes), contentType: 'video/mp4' });
});

/** The archive is never written, re-registered or removed. */
async function expectArchiveUntouched() {
  expect(obj(fx.seeker.key)?.body.equals(archiveBytes)).toBe(true);
  expect(s3.puts.map((p) => p.key)).not.toContain(fx.seeker.key);
  expect((await fs.doc(`storageObjects/${sha(fx.seeker.key)}`).get()).exists).toBe(false);
}

describe('real run (plan §8.3–8.5) on the emulator + FakeS3', () => {
  it('uploads, server-copies, verifies, registers, writes the documents; the post-run manifest equals the approved one', async () => {
    const { report, manifest } = await realRun(realOpts());
    expect(report.preCheck).toEqual({ plannedDocs: plan.writes.length, existingIdentical: 0, existingConflicting: 0, unplannedUsers: 0 });
    expect(report.objects).toEqual({ alreadyPresent: 0, uploaded: 1, serverCopied: 1, registered: 2, failed: null });
    expect(report.postMatchesApproved).toBe(true);
    expect(manifest?.manifestSha256).toBe(approved);
    // Objects at the app keys, byte for byte; the upload went through a presigned PUT.
    expect(obj('evidence/ev-000001')?.body.equals(readFileSync(join(fx.media, 'm1')))).toBe(true);
    expect(obj('evidence/ev-000002')?.body.equals(archiveBytes)).toBe(true);
    expect(s3.puts.map((p) => p.key)).toEqual(['evidence/ev-000001']);
    for (const k of ['evidence/ev-000001', 'evidence/ev-000002']) expect((await fs.doc(`storageObjects/${sha(k)}`).get()).data()?.object_key).toBe(k);
    expect((await fs.doc('evidence/ev-000002').get()).data()?.storage_key).toBe('evidence/ev-000002');
    await expectArchiveUntouched();
  });

  it('a rerun is idempotent: no new upload or copy, identical documents, the same manifest', async () => {
    await realRun(realOpts());
    const puts = s3.puts.length;
    const { report } = await realRun(realOpts());
    expect(report.preCheck.existingIdentical).toBe(plan.writes.length);
    expect(report.objects).toEqual({ alreadyPresent: 2, uploaded: 0, serverCopied: 0, registered: 2, failed: null });
    expect(s3.puts.length).toBe(puts);
    expect(report.postManifest).toBe(approved);
    await expectArchiveUntouched();
  });

  it('refuses a manifest other than the approved one, before any write', async () => {
    await expect(realRun(realOpts({ approvedSha256: 'f'.repeat(64) }))).rejects.toBeInstanceOf(Refused);
    expect((await fs.collection('users').get()).size).toBe(0);
    expect(s3.keys()).toEqual([`${BUCKET}/${fx.seeker.key}`]);
  });

  it('refuses a target holding an unplanned user, or a planned document with different content', async () => {
    await fs.doc('users/someone-else').set({ id: 'someone-else' });
    await expect(realRun(realOpts())).rejects.toThrow(/1 user\(s\) this migration doesn't plan/);
    await clearEmulator();
    await fs.doc('users/b1').set({ id: 'b1', display_name: 'Changed since the snapshot' });
    await expect(realRun(realOpts())).rejects.toThrow(/1 planned document\(s\) exist with different content \(users\)/);
    // Nothing was written by either refused run.
    expect((await fs.collection('studies').get()).size).toBe(0);
    expect(s3.keys()).toEqual([`${BUCKET}/${fx.seeker.key}`]);
  });

  it('a failed sha256 verify stops the run with that object unregistered and no documents written', async () => {
    // The archive differs from its receipt (same size): the copy cannot verify.
    const tampered = Buffer.from(archiveBytes.map((b) => b ^ 1));
    s3.objects.set(`${BUCKET}/${fx.seeker.key}`, { body: tampered, contentType: 'video/mp4' });
    const err = await realRun(realOpts()).catch((e: Error & { report?: { objects: { failed: unknown; registered: number } } }) => e);
    expect(String(err)).toMatch(/evidence ev-000002: sha256 verification failed \(left unregistered\)/);
    expect((err as { report: { objects: { failed: unknown; registered: number } } }).report.objects).toMatchObject({ failed: { evidenceId: 'ev-000002', reason: 'sha256 verification failed' }, registered: 1 });
    expect((await fs.doc(`storageObjects/${sha('evidence/ev-000002')}`).get()).exists).toBe(false);
    expect((await fs.collection('users').get()).size).toBe(0);
    // Still never written to, registered or removed.
    expect(obj(fx.seeker.key)?.body.equals(tampered)).toBe(true);
    expect((await fs.doc(`storageObjects/${sha(fx.seeker.key)}`).get()).exists).toBe(false);
  });

  it('refuses when the target already holds different content at an evidence key', async () => {
    s3.objects.set(`${BUCKET}/evidence/ev-000001`, { body: Buffer.from('something else'), contentType: 'video/mp4' });
    await expect(realRun(realOpts())).rejects.toThrow(/evidence ev-000001: the target already holds different content/);
    expect(obj('evidence/ev-000001')?.body.toString()).toBe('something else');
  });

  it('the object helper cannot write outside evidence/{id} or copy from a non-archive key', async () => {
    await expect(store.put(fx.seeker.key, Buffer.from('x'), 'video/mp4')).rejects.toThrow(/outside evidence/);
    await expect(store.copy('evidence/ev-000001', fx.seeker.key)).rejects.toThrow(/outside evidence/);
    await expect(store.copy('evidence/ev-000001', 'evidence/ev-000009')).rejects.toThrow(/not a retained archive/);
    expect('delete' in store).toBe(false);
  });

  it('the CLI: a full real run on a demo- project, and its refusals', async () => {
    const cwd = join(__dirname, '..', '..');
    const receipt = join(fx.dir, 'receipt.json');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(receipt, JSON.stringify({ ...fx.seeker, bucket: BUCKET } satisfies SeekerReceipt));
    const base = ['--import', 'tsx', 'scripts/migrate-to-firestore.ts', '--snapshot', fx.snapshot, '--expect-sha256', fx.snapshotSha, '--media-dir', fx.media, '--receipt', receipt, '--out', join(fx.dir, 'post.json')];
    const env = { ...process.env, POCKETQA_R2_ACCOUNT_ID: '0'.repeat(32), POCKETQA_R2_BUCKET: BUCKET, POCKETQA_R2_ACCESS_KEY_ID: 'test-key-id', POCKETQA_R2_SECRET_ACCESS_KEY: 'test-secret-key', POCKETQA_R2_ENDPOINT: endpoint }; // check-secrets: allow (fake S3 test credentials)
    const cli = async (args: string[], e: NodeJS.ProcessEnv = env) => {
      try {
        const r = await run(process.execPath, [...base, ...args], { cwd, env: e });
        return r.stdout;
      } catch (x) {
        return `FAILED ${(x as { stderr: string }).stderr}`;
      }
    };
    const ok = await cli(['--real', '--approved-manifest', approved, '--project', 'demo-pocketqa']);
    expect(ok).toMatch(/objects: 1 uploaded, 1 server-copied, 0 already present, 2 verified and registered/);
    expect(ok).toMatch(new RegExp(`post-run manifest ${approved} MATCHES`));
    expect(ok).not.toMatch(/@example\.test|test-secret-key/); // counts only, never content or credentials
    expect(JSON.parse(readFileSync(join(fx.dir, 'post.json'), 'utf8')).manifestSha256).toBe(approved);
    await expectArchiveUntouched();

    expect(await cli(['--real', '--approved-manifest', 'f'.repeat(64), '--project', 'demo-pocketqa'])).toMatch(/FAILED .*is not the approved/);
    expect(await cli(['--real', '--approved-manifest', approved, '--project', 'some-other-project'])).toMatch(/FAILED .*targets pocketqa-optijara/);
    // The real project: only the approved snapshot, never the emulator, never a test endpoint.
    expect(await cli(['--real', '--approved-manifest', approved])).toMatch(/FAILED .*accepts only the approved snapshot/);
    expect(await cli(['--real', '--approved-manifest', approved, '--project', 'demo-pocketqa'], { ...env, POCKETQA_R2_BUCKET: 'another-bucket' })).toMatch(/FAILED .*not the bucket of the Seeker archive/);
  }, 120_000);
});
