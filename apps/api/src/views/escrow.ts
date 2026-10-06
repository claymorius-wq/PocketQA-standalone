import type { EscrowFunding, Payout, StudyPayment } from '@pocket-qa/contracts';

import { holdsBudget, studyAccount, studyBudget, type Kind } from '@pocket-qa/domain';
import type { DB } from '../db';
import { iso } from '../util';
import { participationStatuses, type StudyRow } from './studies';
import { escrowOf, studyEscrowBooks, studyQuote, type FundingRow, type SettlementRow } from '../escrow';

export function budgetOf(db: DB, row: StudyRow, nowMs: number) {
  // Escrow studies never use test credits; their books are in `payment.balances`.
  if (row.payment_mode === 'escrow') return { reserved: 0, awarded: 0, committed: 0, available: 0 };
  const sums = db
    .prepare(
      `SELECT kind, COALESCE(SUM(amount),0) AS s FROM ledger WHERE account = ? GROUP BY kind`,
    )
    .all(studyAccount(row.id)) as { kind: Kind; s: number }[];
  const by = (k: Kind) => sums.find((x) => x.kind === k)?.s ?? 0;
  const committingCount = participationStatuses(db, row.id).filter((p) => holdsBudget(p, nowMs)).length;
  return studyBudget({
    reserved: by('study_reserve'),
    awarded: -(by('reward_credit') + by('dispute_credit')),
    released: -by('study_release'),
    rewardCredits: row.reward_credits,
    committingCount,
    closed: row.status === 'closed',
  });
}

/** Builder view of how a study is paid for; escrow books only for the owner (views are owner-scoped). */
export function paymentView(db: DB, row: StudyRow, nowMs: number): StudyPayment {
  if (row.payment_mode !== 'escrow') return { mode: 'test_credits' };
  const esc = escrowOf(db, row.id)!;
  const funded = db.prepare(`SELECT 1 FROM escrow_fundings WHERE study_id = ? AND status = 'confirmed'`).get(row.id) !== undefined;
  const { ok: _ok, ...balances } = studyEscrowBooks(db, row.id, nowMs);
  const refund = db.prepare(`SELECT status, amount_units FROM settlements WHERE kind = 'refund' AND study_id = ?`).get(row.id) as { status: SettlementRow['status']; amount_units: number } | undefined;
  return {
    mode: 'escrow',
    settlement: esc.settlement,
    asset: 'USDC',
    decimals: 6,
    network: esc.network,
    mint: esc.mint,
    quote: studyQuote(row, esc),
    funded,
    balances,
    fundingWallet: esc.funding_wallet,
    refund: refund ? { status: refund.status, amountUnits: refund.amount_units } : null,
  };
}

export function payoutView(db: DB, s: SettlementRow): Payout {
  const title = (db.prepare('SELECT title FROM studies WHERE id = ?').get(s.study_id) as { title: string }).title;
  return {
    id: s.id,
    participationId: s.participation_id!,
    studyId: s.study_id,
    studyTitle: title,
    amountUnits: s.amount_units,
    asset: 'USDC',
    decimals: 6,
    destination: s.destination,
    settlement: escrowOf(db, s.study_id)?.settlement ?? 'simulated',
    status: s.status,
    signature: s.signature,
    failureReason: s.failure_reason,
    attempts: s.attempt,
    authorizedAt: iso(s.created_at),
    settledAt: s.settled_at ? iso(s.settled_at) : null,
  };
}

export function fundingView(db: DB, f: FundingRow): EscrowFunding {
  const esc = escrowOf(db, f.study_id)!;
  return {
    id: f.id,
    studyId: f.study_id,
    amountUnits: f.amount_units,
    asset: 'USDC',
    decimals: 6,
    network: esc.network,
    mint: esc.mint,
    vault: esc.vault,
    reference: f.reference,
    settlement: esc.settlement,
    status: f.status,
    signature: f.signature,
    source: f.source,
    failureReason: f.failure_reason,
    createdAt: iso(f.created_at),
    expiresAt: iso(f.expires_at),
    confirmedAt: f.confirmed_at ? iso(f.confirmed_at) : null,
  };
}
