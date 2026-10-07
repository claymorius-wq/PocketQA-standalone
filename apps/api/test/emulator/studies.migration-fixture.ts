import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SeekerReceipt } from '../../scripts/migrate-to-firestore';
import { openDb } from '../../src/db';

const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex');

/**
 * A SYNTHETIC snapshot for the migration tests (never real data): users of every role, a study
 * with tasks, an approved and a disputed participation, notes, a finding, ledger postings, two
 * evidence items (an app recording and one standing in for the archived Seeker recording), an
 * audit row, a wallet link and a session. Built with the real schema (openDb), then closed.
 */
export function buildSyntheticSnapshot(): { dir: string; snapshot: string; snapshotSha: string; media: string; seeker: SeekerReceipt } {

  const dir = mkdtempSync(join(tmpdir(), 'pqa-migrate-'));
  const media = join(dir, 'media');
  mkdirSync(media);
  const snapshot = join(dir, 'snapshot.sqlite');
  const db = openDb(snapshot);
  const at = '2026-10-05T10:00:00.000Z';
  const ins = (sql: string, ...v: unknown[]) => db.prepare(sql).run(...v);
  for (const [id, role, status] of [['b1', 'builder', 'active'], ['t1', 'tester', 'active'], ['t2', 'tester', 'active'], ['a1', 'admin', 'active'], ['gone', 'tester', 'deleted']] as const) {
    ins('INSERT INTO users (id, email, password_hash, display_name, role, status, device_json, created_at) VALUES (?,?,?,?,?,?,?,?)', id, `${id}@example.test`, 'scrypt$hash', `User ${id}`, role, status, null, at);
  }
  ins(`INSERT INTO identities (provider, subject, user_id, has_recovery, valid_after_ms, created_at) VALUES ('firebase','uid-t1','t1',1,0,?)`, at);
  ins(`INSERT INTO studies (id, builder_id, title, objective, build_under_test, device_criteria_json, reward_credits, slots, consent_text, consent_version, status, moderation, created_at, published_at, closed_at, payment_mode)
       VALUES ('s1','b1','Checkout','Find friction',NULL,'{"platforms":["web"],"minAndroidApi":null,"languages":["en"]}',10,3,'I agree.',1,'published','ok',?,?,NULL,'test_credits')`, at, at);
  ins(`INSERT INTO tasks (id, study_id, ord, instruction, success_criteria) VALUES ('k1','s1',0,'Open the app',NULL), ('k2','s1',1,'Buy','Order placed')`);
  ins(`INSERT INTO participations (id, study_id, tester_id, status, consent_version, consented_at, started_at, submitted_at, decided_at, decided_by, decision_reason, reward_credits, payout_address)
       VALUES ('p1','s1','t1','approved',1,?,?,?,?,'b1',NULL,10,NULL), ('p2','s1','t2','resolved',1,?,?,?,?,'b1','Not the checkout.',10,NULL)`, at, at, at, at, at, at, at, at);
  ins(`INSERT INTO task_notes (participation_id, task_id, note) VALUES ('p1','k1','Found the cart')`);
  // Ledger: top-up, reserve, one reward (rowid order = insertion order).
  const post = (id: string, tx: string, account: string, amount: number, kind: string, sid: string | null, pid: string | null) =>
    ins('INSERT INTO ledger (id, tx_id, account, amount, kind, study_id, participation_id, created_at) VALUES (?,?,?,?,?,?,?,?)', id, tx, account, amount, kind, sid, pid, at);
  post('l1', 'x1', 'system:test-faucet', -30, 'test_topup', null, null);
  post('l2', 'x1', 'user:b1', 30, 'test_topup', null, null);
  post('l3', 'x2', 'user:b1', -30, 'study_reserve', 's1', null);
  post('l4', 'x2', 'study:s1', 30, 'study_reserve', 's1', null);
  post('l5', 'x3', 'study:s1', -10, 'reward_credit', 's1', 'p1');
  post('l6', 'x3', 'user:t1', 10, 'reward_credit', 's1', 'p1');
  // Evidence: one app recording and one standing in for the archived Seeker recording.
  writeFileSync(join(media, 'm1'), Buffer.from('app recording bytes'));
  writeFileSync(join(media, 'm2'), Buffer.from('archived recording bytes'));
  ins(`INSERT INTO evidence (id, participation_id, kind, mime_type, size_bytes, duration_ms, task_id, captured_on, client_segment_id, storage_key, created_at)
       VALUES ('ev-000001','p1','screen_recording','video/mp4',19,1000,'k1','web','seg/1','m1',?), ('ev-000002','p2','screen_recording','video/mp4',24,2000,NULL,'android','seg-2','m2',?)`, at, at);
  ins(`INSERT INTO findings (id, participation_id, title, severity, description, evidence_id, timestamp_ms, created_by, created_at) VALUES ('f1','p1','Cart hidden','major','Below the fold','ev-000001',500,'b1',?)`, at);
  ins(`INSERT INTO disputes (id, participation_id, opened_by, reason, status, outcome, resolution_note, resolved_by, created_at, resolved_at) VALUES ('d1','p2','t2','I did it','resolved','upheld','Confirmed','a1',?,?)`, at, at);
  ins(`INSERT INTO audit (id, actor_id, action, target_type, target_id, reason, created_at) VALUES ('au1','a1','dispute.upheld','dispute','d1','Confirmed',?)`, at);
  ins(`INSERT INTO wallet_links (user_id, address, linked_at) VALUES ('t1','9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',?)`, at);
  ins(`INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('h1','t1',?,0)`, at);
  db.pragma('wal_checkpoint(TRUNCATE)');
  db.close();
  const snapshotSha = sha(readFileSync(snapshot));
  const m2 = sha(readFileSync(join(media, 'm2')));
  const seeker: SeekerReceipt = { evidenceId: 'ev-000002', key: `retained-local-submissions/ev-000002/${m2}.mp4`, sha256: m2, bytes: 24 };
  return { dir, snapshot, snapshotSha, media, seeker };
}
