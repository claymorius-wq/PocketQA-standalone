import { afterEach, describe, expect, it } from 'vitest';
import { deleteOrQueue, sweepStorage } from '../src/storage/sweep';
import { sha256 } from '../src/util';
import { makeApp, type TestApp } from './helpers';

// Plan r2 §R4 on SQLite (the Firestore path is covered in test/emulator/evidence.repo.test.ts):
// only registered app keys under evidence/ or quarantine/ are ever deleted; anything else,
// in particular the retained Seeker archive, is refused and audited by key hash.
let t: TestApp;
afterEach(async () => t.close());

const SEEKER = 'retained-local-submissions/4aef8a84-4439-4001-89fc-2389a89924a7.mp4';

function plant(key: string) {
  t.s3.objects.set(`pqa-test/${key}`, { body: Buffer.from(`fixture ${key}`), contentType: 'video/mp4' });
}
function register(key: string) {
  t.db.prepare('INSERT INTO storage_objects (object_key, created_at) VALUES (?, 0)').run(key);
}
const refusals = () =>
  t.db.prepare(`SELECT actor_id, target_type, target_id, reason FROM audit WHERE action = 'storage.delete_refused' ORDER BY created_at`).all() as {
    actor_id: string;
    target_type: string;
    target_id: string;
    reason: string;
  }[];
const outbox = () => (t.db.prepare('SELECT COUNT(*) AS n FROM storage_deletions').get() as { n: number }).n;

describe('R4: the deletion gate (SQLite)', () => {
  it('the Seeker archive key is refused and audited by hash only, even when registered', async () => {
    t = await makeApp({ storage: 'r2' });
    plant(SEEKER);
    register(SEEKER);
    expect(await deleteOrQueue(t.deps, SEEKER, 'account_deletion', 'user-1')).toBe(false);
    expect(t.s3.keys()).toEqual([`pqa-test/${SEEKER}`]);
    expect(outbox()).toBe(0);
    expect(refusals()).toEqual([{ actor_id: 'user-1', target_type: 'storage_object', target_id: sha256(SEEKER), reason: 'account_deletion: outside evidence/|quarantine/' }]);
    const raw = JSON.stringify(t.db.prepare('SELECT * FROM audit').all());
    expect(raw).not.toContain('retained-local-submissions');
  });

  it('an unregistered evidence/ key is refused and audited; a registered one is deleted', async () => {
    t = await makeApp({ storage: 'r2' });
    plant('evidence/notmine-0001');
    plant('evidence/mine-000001');
    register('evidence/mine-000001');
    expect(await deleteOrQueue(t.deps, 'evidence/notmine-0001', 'failed_upload', 'user-1')).toBe(false);
    expect(refusals()).toEqual([{ actor_id: 'user-1', target_type: 'storage_object', target_id: sha256('evidence/notmine-0001'), reason: 'failed_upload: not registered' }]);
    expect(await deleteOrQueue(t.deps, 'evidence/mine-000001', 'failed_upload', 'user-1')).toBe(true);
    expect(t.s3.keys()).toEqual(['pqa-test/evidence/notmine-0001']);
  });

  it('the sweep drops an outbox entry outside the prefixes without deleting it, audited as system', async () => {
    t = await makeApp({ storage: 'r2' });
    plant(SEEKER);
    register(SEEKER);
    t.db.prepare(`INSERT INTO storage_deletions (object_key, attempts, next_attempt_at, created_at, purpose) VALUES (?, 1, 0, 0, 'account_deletion')`).run(SEEKER);
    await sweepStorage(t.deps);
    expect(t.s3.keys()).toEqual([`pqa-test/${SEEKER}`]);
    expect(outbox()).toBe(0);
    expect(refusals()).toEqual([{ actor_id: 'system', target_type: 'storage_object', target_id: sha256(SEEKER), reason: 'account_deletion: outside evidence/|quarantine/' }]);
  });

  it('a caller without an actor is recorded as system', async () => {
    t = await makeApp({ storage: 'r2' });
    expect(await deleteOrQueue(t.deps, SEEKER, 'failed_upload')).toBe(false);
    expect(refusals()[0]!.actor_id).toBe('system');
  });
});
