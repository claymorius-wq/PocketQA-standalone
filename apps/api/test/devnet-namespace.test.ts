import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { r2Store } from '../src/storage/r2';
import { FakeS3 } from './fakeS3';

// CH-D2: ONE namespace function, and nothing that can step around it.
const API = join(__dirname, '..');
const files = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? files(join(d, n)) : n.endsWith('.ts') ? [join(d, n)] : []));
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
const src = files(join(API, 'src')).map((f) => ({ f: relative(API, f), text: strip(readFileSync(f, 'utf8')) }));
const where = (re: RegExp) => src.filter((x) => re.test(x.text)).map((x) => x.f).sort();

describe('the devnet namespace has one entrance', () => {
  it('only src/firestore/namespace.ts defines it, and only makeRepos applies it', () => {
    expect(where(/export function devnetFirestore\b/)).toEqual(['src/firestore/namespace.ts']);
    expect(where(/\bdevnetFirestore\(/)).toEqual(['src/firestore/namespace.ts', 'src/repo/index.ts']);
  });

  it('no raw Firestore is opened anywhere else (the repos only ever get the one makeRepos passes)', () => {
    expect(where(/\bgetFirestore\(|new Firestore\(/)).toEqual(['src/firestore/admin.ts']);
    expect(where(/\bopenFirestore\(/).filter((f) => f !== 'src/firestore/admin.ts')).toEqual(['src/hosted/app.ts']);
  });

  it('no collection-group query and no escape through a reference back to the raw instance', () => {
    expect(where(/\.collectionGroup\(/)).toEqual([]);
    expect(where(/\.firestore\s*\./)).toEqual([]);
    expect(where(/\.listCollections\(|\.recursiveDelete\(/)).toEqual([]);
  });

  it('the repositories are built only by makeRepos (and the escrow repo’s own reads of the same instance)', () => {
    for (const ctor of ['firestoreCoreRepo', 'firestoreStudiesRepo', 'firestoreEvidenceRepo', 'firestoreEscrowRepo']) {
      const callers = where(new RegExp(`\\b${ctor}\\(`)).filter((f) => !f.endsWith(`/${ctor.replace('firestore', '').replace('Repo', '').toLowerCase()}/firestore.ts`));
      expect(callers.every((f) => f === 'src/repo/index.ts' || f === 'src/repo/escrow/firestore.ts'), `${ctor}: ${callers}`).toBe(true);
    }
  });

  it('the production scripts (migration, integrity check) stay on the root collections', () => {
    for (const s of ['scripts/migrate-to-firestore.ts', 'scripts/qa-integrity-check.ts']) expect(readFileSync(join(API, s), 'utf8')).not.toMatch(/devnetFirestore|namespace/);
  });
});

describe('R2 keyPrefix devnet/ (CH-D2): the devnet store never addresses evidence/ or retained-local-submissions/', () => {
  const s3 = new FakeS3();
  let store: ReturnType<typeof r2Store>;
  beforeAll(async () => {
    const endpoint = await s3.start();
    store = r2Store({ accountId: '0'.repeat(32), bucket: 'pqa-test', endpoint, accessKeyId: 'test-key-id', secretAccessKey: 'test-secret-key', allowDelete: true }, { keyPrefix: 'devnet/' }); // check-secrets: allow (fake S3 test credentials)
  });
  afterAll(async () => s3.stop());

  it('reads, deletes and signs only under devnet/, leaving production objects untouched', async () => {
    s3.objects.set('pqa-test/evidence/prodobject1', { body: Buffer.from('prod'), contentType: 'video/mp4' });
    s3.objects.set('pqa-test/devnet/evidence/prodobject1', { body: Buffer.from('dev!'), contentType: 'video/mp4' });
    expect(await store.head('evidence/prodobject1')).toMatchObject({ size: 4 });
    await store.delete('evidence/prodobject1');
    expect(s3.objects.has('pqa-test/devnet/evidence/prodobject1')).toBe(false);
    expect(s3.objects.has('pqa-test/evidence/prodobject1')).toBe(true);
    const put = await store.presignPut('evidence/newobject12', { contentType: 'video/mp4', contentLength: 3, expiresInSeconds: 60 });
    expect(new URL(put.url).pathname).toBe('/pqa-test/devnet/evidence/newobject12');
    const get = await store.presignGet('evidence/prodobject1', { contentType: 'video/mp4', expiresInSeconds: 60, signingDate: new Date() });
    expect(new URL(get.url).pathname).toBe('/pqa-test/devnet/evidence/prodobject1');
  });

  it('keys outside the app shapes are still refused before any request (retained-local-submissions/, devnet/ itself)', async () => {
    for (const key of ['retained-local-submissions/seeker0001', 'devnet/evidence/prodobject1', '../evidence/prodobject1']) {
      await expect(store.delete(key)).rejects.toThrow(/unsafe storage key/);
    }
    expect(s3.objects.has('pqa-test/evidence/prodobject1')).toBe(true);
  });
});
