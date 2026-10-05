import { planSettlePayout, planSettleRefund, transitionPayout } from '@pocket-qa/domain';
import type { Deps } from '../context';
import { audit, postEscrow, studyEscrowBooks, verifyFunding, type FundingRow, type SettlementRow } from '../escrow';
import type { DB } from '../db';
import { SettlementFailure, type SettlementProvider } from './types';

const RETRY_MS = 5 * 60_000;
const MAX_RETRY_MS = 3600_000;
/** After this many failed attempts a payment is escalated to the operator (it keeps retrying). */
export const ESCALATE_AFTER = 5;
const backoff = (attempt: number) => Math.min(MAX_RETRY_MS, RETRY_MS * 2 ** Math.max(0, attempt - 1));

/**
 * The durable settlement worker (run at startup and periodically, like the storage sweep):
 * 1. pending fundings are re-verified; unpaid requests past their expiry expire;
 * 2. pending payouts and refunds, and failed ones whose retry time came, are submitted. The
 *    attempt key is persisted BEFORE the provider call, so a crash re-sends the same key and the
 *    provider returns the same transfer (never a second one);
 * 3. submitted transfers are polled; only `finalized` settles them (once: unique postings), a
 *    network failure marks them failed for a later attempt, and `processing` waits;
 * 4. every touched study's books are reconciled; an imbalance is returned as an alert, as is a
 *    payment that has failed ESCALATE_AFTER times or more (it keeps retrying, with backoff);
 * 5. with a network provider (the Squads devnet pilot), every study vault's on-chain balance is
 *    compared with the books: unmatched deposits and shortfalls are alerts (`reconcileVaultOnChain`).
 * The server runs one pass at a time (a guard in server.ts); overlapping runs from other callers
 * would still be safe, because every send is idempotent per persisted attempt key.
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
      const { signature } = await provider.submit({
        key: key!,
        settlementId: s.id,
        kind: s.kind,
        studyId: s.study_id,
        vault: provider.vaultFor(s.study_id),
        destination: s.destination,
        amountUnits: s.amount_units,
        cosigner: s.cosigner,
      });
      db.prepare('UPDATE settlements SET signature = ? WHERE id = ?').run(signature, s.id);
    } catch (e) {
      if (!(e instanceof SettlementFailure)) throw e;
      // The simulation can prove nothing was sent; a network provider reports the chain state it read.
      const reason = e.chainState ? `${e.message} ${e.chainState}` : e.message;
      const after = provider.mode === 'simulated' ? 'Nothing was sent; it will be retried.' : 'It will be retried.';
      db.prepare(`UPDATE settlements SET status = 'failed', failure_reason = ?, next_attempt_at = ? WHERE id = ?`).run(reason, now + backoff(s.attempt + (s.status === 'submitted' ? 0 : 1)), s.id);
      audit(db, 'system', `escrow.${s.kind}_failed`, s.kind === 'payout' ? 'participation' : 'study', s.participation_id ?? s.study_id, `${reason} ${after}`, now);
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
        audit(db, 'system', `escrow.${s.kind}_settled`, s.kind === 'payout' ? 'participation' : 'study', s.participation_id ?? s.study_id, `${s.amount_units} units to ${s.destination} (${provider.mode === 'simulated' ? 'simulated settlement' : 'Squads devnet pilot, devnet test USDC, no value'})`, now);
      })();
    } else if (st === 'failed') {
      db.prepare(`UPDATE settlements SET status = 'failed', failure_reason = ?, next_attempt_at = ? WHERE id = ? AND status = 'submitted'`).run('The transfer failed on the settlement network; it will be retried.', now + backoff(s.attempt), s.id);
    }
    // 'processing' and 'not_found' wait: a transfer is never assumed lost or settled early.
  }

  const alerts: string[] = [];
  for (const f of db.prepare(`SELECT id, kind, attempt, failure_reason FROM settlements WHERE status = 'failed' AND attempt >= ?`).all(ESCALATE_AFTER) as { id: string; kind: string; attempt: number; failure_reason: string | null }[]) {
    alerts.push(`${f.kind} ${f.id}: ${ESCALATE_AFTER}+ failed attempts (${f.attempt} so far): ${f.failure_reason ?? 'unknown'}`);
  }
  for (const studyId of touched) {
    const books = studyEscrowBooks(db, studyId, now);
    if (!books.ok) alerts.push(`escrow books out of balance for study ${studyId}: ${JSON.stringify(books)}`);
  }
  if (provider.vaultBalance) {
    for (const { study_id } of db.prepare(`SELECT study_id FROM study_escrows WHERE settlement = ? AND multisig IS NOT NULL`).all(provider.mode) as { study_id: string }[]) {
      const alert = await reconcileVaultOnChain(db, provider, study_id, now);
      if (alert) alerts.push(alert);
    }
  }
  return { alerts };
}

/**
 * R7: a study vault's balance on the network against the books. On chain the vault holds what was
 * funded minus what was paid out and refunded; the platform fee stays in the vault (the pilot has
 * no fee sweep). More than that is an UNMATCHED deposit: alerted only, never credited to the study
 * or spendable by it (an operator returns it by hand). Less than that, beyond transfers that may
 * have landed but aren't confirmed in the books yet, is a shortfall.
 */
export async function reconcileVaultOnChain(db: DB, provider: SettlementProvider, studyId: string, now: number): Promise<string | null> {
  const onChain = await provider.vaultBalance!(studyId);
  if (onChain === null) return null;
  const books = studyEscrowBooks(db, studyId, now);
  const expected = books.fundedUnits - books.settledUnits - books.refundedUnits;
  const inFlight = (db.prepare(`SELECT COALESCE(SUM(amount_units),0) AS s FROM settlements WHERE study_id = ? AND status IN ('submitted','failed')`).get(studyId) as { s: number }).s;
  // A funding still being verified explains extra units until it resolves.
  const openFunding = db.prepare(`SELECT 1 FROM escrow_fundings WHERE study_id = ? AND status IN ('awaiting_payment','pending')`).get(studyId);
  if (onChain > expected && !openFunding) {
    return `unmatched deposit in the vault of study ${studyId}: ${onChain - expected} units on chain that no confirmed funding credited (not credited, not spendable; return it by hand)`;
  }
  if (onChain < expected - inFlight) return `vault shortfall for study ${studyId}: ${expected - inFlight - onChain} units fewer on chain than the books hold`;
  return null;
}
