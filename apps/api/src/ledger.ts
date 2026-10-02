import { balanceOf, type Account, type Posting } from '@pocket-qa/domain';
import type { DB } from './db';
import { iso, newId } from './util';

export function post(db: DB, postings: Posting[], nowMs: number): void {
  if (postings.length === 0) return;
  if (postings.reduce((s, p) => s + p.amount, 0) !== 0) throw new Error('unbalanced ledger transaction');
  const txId = newId();
  const ins = db.prepare(
    'INSERT INTO ledger (id, tx_id, account, amount, kind, study_id, participation_id, created_at) VALUES (?,?,?,?,?,?,?,?)',
  );
  for (const p of postings) ins.run(newId(), txId, p.account, p.amount, p.kind, p.studyId, p.participationId, iso(nowMs));
}

export function accountBalance(db: DB, account: Account): number {
  const rows = db.prepare('SELECT account, amount FROM ledger WHERE account = ?').all(account) as { account: Account; amount: number }[];
  return balanceOf(rows, account);
}
