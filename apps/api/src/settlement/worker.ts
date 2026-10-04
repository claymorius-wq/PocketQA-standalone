import { planSettlePayout, planSettleRefund, transitionPayout } from '@pocket-qa/domain';
import type { Deps } from '../context';
import { audit, postEscrow, studyEscrowBooks, verifyFunding, type FundingRow, type SettlementRow } from '../escrow';
import { SettlementFailure } from './types';

const RETRY_MS = 5 * 60_000;

/**
 * The durable settlement worker (run at startup and periodically, like the storage sweep):
 * 1. pending fundings are re-verified; unpaid requests past their expiry expire;
 * 2. pending payouts and refunds, and failed ones whose retry time came, are submitted. The
 *    attempt key is persisted BEFORE the provider call, so a crash re-sends the same key and the
 *    provider returns the same transfer (never a second one);
 * 3. submitted transfers are polled; only `finalized` settles them (once: unique postings), a
 *    network failure marks them failed for a later attempt, and `processing` waits;
 * 4. every touched study's books are reconciled; an imbalance is returned as an alert.
 * Unknown errors propagate: they leave the outcome unknown, and the next run resolves it.
 */
export async function runSettlement(deps: Pick<Deps, 'db' | 'now' | 'settlement'>): Promise<{ alerts: string[] }> {
  const { db, settlement: provider } = deps;
  if (!provider) return { alerts: [] };
  const now = deps.now();
  const touched = new Set<string>();

  db.prepare(`UPDATE escrow_fundings SET status = 'expired' WHERE status = 'awaiting_payment' AND expires_at <= ?`).run(now);
  for (const f of db.prepare(`SELECT * FROM escrow_fundings WHERE status = 'pending'`).all() as FundingRow[]) {
    await verifyFunding(db, provider, f, f.signature!, now, 'system');
    touched.add(f.study_id);
  }

  const due = db
    .prepare(`SELECT * FROM settlements WHERE status = 'pending' OR (status = 'failed' AND next_attempt_at <= ?) OR (status = 'submitted' AND signature IS NULL) ORDER BY created_at`)
    .all(now) as SettlementRow[];
  for (const s of due) {
    touched.add(s.study_id);
    let key = s.attempt_key;
    if (s.status !== 'submitted') {
      // A new attempt: persist its key and the submitted state before sending anything.
      key = `${s.id}:${s.attempt + 1}`;
      transitionPayout(s.status, 'submit');
      db.prepare(`UPDATE settlements SET status = 'submitted', attempt = attempt + 1, attempt_key = ?, signature = NULL, failure_reason = NULL WHERE id = ?`).run(key, s.id);
    }
    try {
      const { signature } = await provider.submit({ key: key!, kind: s.kind, vault: provider.vaultFor(s.study_id), destination: s.destination, amountUnits: s.amount_units });
      db.prepare('UPDATE settlements SET signature = ? WHERE id = ?').run(signature, s.id);
    } catch (e) {
      if (!(e instanceof SettlementFailure)) throw e;
      db.prepare(`UPDATE settlements SET status = 'failed', failure_reason = ?, next_attempt_at = ? WHERE id = ?`).run(e.message, now + RETRY_MS, s.id);
      audit(db, 'system', `escrow.${s.kind}_failed`, s.kind === 'payout' ? 'participation' : 'study', s.participation_id ?? s.study_id, `${e.message} Nothing was sent; it will be retried.`, now);
    }
  }

  for (const s of db.prepare(`SELECT * FROM settlements WHERE status = 'submitted' AND signature IS NOT NULL`).all() as SettlementRow[]) {
    touched.add(s.study_id);
    const st = await provider.status(s.signature!);
    if (st === 'finalized') {
      db.transaction(() => {
        const cur = db.prepare('SELECT status FROM settlements WHERE id = ?').get(s.id) as { status: SettlementRow['status'] };
        if (cur.status !== 'submitted') return;
        transitionPayout('submitted', 'confirm');
        db.prepare(`UPDATE settlements SET status = 'confirmed', settled_at = ? WHERE id = ?`).run(now, s.id);
        if (s.kind === 'payout') {
          postEscrow(db, planSettlePayout({ studyId: s.study_id, participationId: s.participation_id!, testerId: s.tester_id!, amountUnits: s.amount_units }), now, s.signature);
        } else {
          postEscrow(db, planSettleRefund({ studyId: s.study_id, funder: s.destination, amountUnits: s.amount_units }), now, s.signature);
        }
        audit(db, 'system', `escrow.${s.kind}_settled`, s.kind === 'payout' ? 'participation' : 'study', s.participation_id ?? s.study_id, `${s.amount_units} units to ${s.destination} (simulated settlement)`, now);
      })();
    } else if (st === 'failed') {
      db.prepare(`UPDATE settlements SET status = 'failed', failure_reason = ?, next_attempt_at = ? WHERE id = ? AND status = 'submitted'`).run('The transfer failed on the settlement network; it will be retried.', now + RETRY_MS, s.id);
    }
    // 'processing' and 'not_found' wait: a transfer is never assumed lost or settled early.
  }

  const alerts: string[] = [];
  for (const studyId of touched) {
    const books = studyEscrowBooks(db, studyId, now);
    if (!books.ok) alerts.push(`escrow books out of balance for study ${studyId}: ${JSON.stringify(books)}`);
  }
  return { alerts };
}
