import {
  escrowAvailability,
  escrowInvariant,
  holdsBudget,
  planAuthorizePayout,
  planAuthorizeRefund,
  planFunding,
  quoteEscrow,
  verifyFundingTransfer,
  type EscrowPosting,
  type EscrowQuote,
} from '@pocket-qa/domain';
import type { DB } from './db';
import type { SettlementProvider } from './settlement/types';
import { fail, iso, newId } from './util';
import { participationStatuses, type ParticipationRow, type StudyRow } from './views';

/**
 * Wallet-funded escrow on the API side (ADR 0007): the money ledger, reservations, payout and
 * refund authorization, and funding verification. Only SIMULATED settlement exists; the provider
 * is injected (`deps.settlement`), and nothing here signs or sends.
 */
export type EscrowRow = { study_id: string; settlement: 'simulated'; network: string; mint: string; vault: string; fee_bps: number; funding_wallet: string | null; created_at: string };
export type FundingRow = {
  id: string;
  study_id: string;
  amount_units: number;
  reference: string;
  status: 'awaiting_payment' | 'pending' | 'confirmed' | 'failed' | 'expired';
  signature: string | null;
  source: string | null;
  failure_reason: string | null;
  created_at: number;
  expires_at: number;
  confirmed_at: number | null;
};
export type SettlementRow = {
  id: string;
  kind: 'payout' | 'refund';
  study_id: string;
  participation_id: string | null;
  tester_id: string | null;
  destination: string;
  amount_units: number;
  status: 'pending' | 'submitted' | 'confirmed' | 'failed';
  attempt: number;
  attempt_key: string | null;
  signature: string | null;
  failure_reason: string | null;
  next_attempt_at: number;
  created_at: number;
  settled_at: number | null;
};

export const FUNDING_TTL_MS = 30 * 60_000;

export const escrowOf = (db: DB, studyId: string) => db.prepare('SELECT * FROM study_escrows WHERE study_id = ?').get(studyId) as EscrowRow | undefined;

/** The study's quote; for escrow studies `reward_credits` holds the reward in token base units. */
export function studyQuote(s: Pick<StudyRow, 'reward_credits' | 'slots'>, esc: Pick<EscrowRow, 'fee_bps'>): EscrowQuote {
  return quoteEscrow({ rewardUnits: s.reward_credits, slots: s.slots, feeBps: esc.fee_bps });
}

export function postEscrow(db: DB, postings: EscrowPosting[], nowMs: number, ref: string | null = null) {
  if (postings.length === 0) return;
  if (postings.reduce((s, p) => s + p.amount, 0) !== 0) throw new Error('unbalanced escrow transaction');
  const txId = newId();
  const ins = db.prepare('INSERT INTO escrow_ledger (id, tx_id, account, amount, kind, study_id, participation_id, ref, created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  for (const p of postings) {
    if (!p.studyId) throw new Error('escrow posting without a study');
    ins.run(newId(), txId, p.account, p.amount, p.kind, p.studyId, p.participationId, ref, iso(nowMs));
  }
}

const postingsOf = (db: DB, studyId: string) =>
  (db.prepare('SELECT account, amount, kind, study_id AS studyId, participation_id AS participationId FROM escrow_ledger WHERE study_id = ?').all(studyId) as EscrowPosting[]);

export const vaultBalance = (db: DB, studyId: string) =>
  (db.prepare(`SELECT COALESCE(SUM(amount),0) AS s FROM escrow_ledger WHERE study_id = ? AND account = ?`).get(studyId, `vault:${studyId}`) as { s: number }).s;

/** Participations that hold one reward plus its fee (same rule as test-credit budgets). */
export const holdingCount = (db: DB, studyId: string, nowMs: number) => participationStatuses(db, studyId).filter((p) => holdsBudget(p, nowMs)).length;

/** The study's books and the invariant (ADR 0007 §5); used by views, the worker and tests. */
export function studyEscrowBooks(db: DB, studyId: string, nowMs: number) {
  const s = db.prepare('SELECT reward_credits, slots, status FROM studies WHERE id = ?').get(studyId) as Pick<StudyRow, 'reward_credits' | 'slots' | 'status'>;
  const esc = escrowOf(db, studyId)!;
  // After close no participation holds funds (closing requires every hold to have settled).
  const holding = s.status === 'closed' ? 0 : holdingCount(db, studyId, nowMs);
  return escrowInvariant({ studyId, postings: postingsOf(db, studyId), quote: studyQuote(s, esc), holdingCount: holding });
}

export function audit(db: DB, actorId: string, action: string, targetType: 'study' | 'participation', targetId: string, reason: string, nowMs: number) {
  db.prepare('INSERT INTO audit (id, actor_id, action, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?,?)').run(newId(), actorId, action, targetType, targetId, reason, iso(nowMs));
}

/** Can a new tester reserve a slot? Checked inside the consent write transaction. */
export function canReserve(db: DB, s: StudyRow, nowMs: number) {
  const esc = escrowOf(db, s.id)!;
  return escrowAvailability({ vaultBalanceUnits: vaultBalance(db, s.id), quote: studyQuote(s, esc), holdingCount: holdingCount(db, s.id, nowMs) }).canReserve;
}

/**
 * Approval (builder, admin stuck-work decision, or overturned dispute) authorizes exactly one
 * payout: the frozen reward to the wallet frozen at consent. Nothing in a request can change
 * either. Called inside the caller's write transaction, while `p` still holds its funds.
 */
export function authorizePayout(db: DB, s: StudyRow, p: ParticipationRow, nowMs: number, actorId: string, why: string) {
  const esc = escrowOf(db, s.id)!;
  const quote = studyQuote(s, esc);
  if (!p.payout_address) throw fail('INTERNAL', 'Escrow participation without a frozen payout wallet.');
  const othersHolding = holdingCount(db, s.id, nowMs) - 1;
  postEscrow(db, planAuthorizePayout({ studyId: s.id, participationId: p.id, quote, vaultAvailableIncludingThis: vaultBalance(db, s.id) - quote.perTestTotalUnits * othersHolding }), nowMs);
  db.prepare(
    `INSERT INTO settlements (id, kind, study_id, participation_id, tester_id, destination, amount_units, status, next_attempt_at, created_at) VALUES (?, 'payout', ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).run(newId(), s.id, p.id, p.tester_id, p.payout_address, quote.rewardUnits, nowMs, nowMs);
  audit(db, actorId, 'escrow.payout_authorized', 'participation', p.id, `${quote.rewardUnits} units to the frozen payout wallet (simulated settlement) · ${why}`, nowMs);
}

/**
 * The money part of the user's own data export (ADR 0007), least data and own data only:
 * a tester's rewards (to their own frozen wallet); a builder's fundings, refunds and per-test
 * payments of their own studies, with no tester identity, participation or wallet. Amounts are
 * exact decimal strings of base units. Provider-internal fields (attempt keys) never appear.
 */
export function paymentsExport(db: DB, userId: string) {
  const units = (n: number) => String(n);
  const asset = { asset: 'USDC' as const, decimals: 6 as const, settlement: 'simulated' as const };
  const isoOrNull = (ms: number | null) => (ms === null ? null : iso(ms));
  const received = (
    db
      .prepare(`SELECT x.*, s.title FROM settlements x JOIN studies s ON s.id = x.study_id WHERE x.kind = 'payout' AND x.tester_id = ? ORDER BY x.created_at`)
      .all(userId) as (SettlementRow & { title: string })[]
  ).map((x) => ({
    participationId: x.participation_id!,
    studyId: x.study_id,
    studyTitle: x.title,
    amountUnits: units(x.amount_units),
    ...asset,
    destination: x.destination,
    status: x.status,
    signature: x.signature,
    authorizedAt: iso(x.created_at),
    settledAt: isoOrNull(x.settled_at),
  }));
  const fundings = (db.prepare(`SELECT f.* FROM escrow_fundings f JOIN studies s ON s.id = f.study_id WHERE s.builder_id = ? ORDER BY f.created_at`).all(userId) as FundingRow[]).map((f) => ({
    id: f.id,
    studyId: f.study_id,
    amountUnits: units(f.amount_units),
    ...asset,
    source: f.source,
    status: f.status,
    signature: f.signature,
    createdAt: iso(f.created_at),
    confirmedAt: isoOrNull(f.confirmed_at),
  }));
  const refunds = (db.prepare(`SELECT x.* FROM settlements x JOIN studies s ON s.id = x.study_id WHERE x.kind = 'refund' AND s.builder_id = ? ORDER BY x.created_at`).all(userId) as SettlementRow[]).map((x) => ({
    studyId: x.study_id,
    amountUnits: units(x.amount_units),
    ...asset,
    destination: x.destination,
    status: x.status,
    signature: x.signature,
    settledAt: isoOrNull(x.settled_at),
  }));
  const studyPayments = (
    db
      .prepare(
        `SELECT x.study_id, x.amount_units, x.status, x.created_at, x.settled_at, e.fee_bps, s.reward_credits, s.slots
         FROM settlements x JOIN studies s ON s.id = x.study_id JOIN study_escrows e ON e.study_id = s.id
         WHERE x.kind = 'payout' AND s.builder_id = ? ORDER BY x.created_at`,
      )
      .all(userId) as { study_id: string; amount_units: number; status: SettlementRow['status']; created_at: number; settled_at: number | null; fee_bps: number; reward_credits: number; slots: number }[]
  ).map((x) => ({
    studyId: x.study_id,
    amountUnits: units(x.amount_units),
    feeUnits: units(studyQuote({ reward_credits: x.reward_credits, slots: x.slots }, { fee_bps: x.fee_bps }).perTestFeeUnits),
    status: x.status,
    authorizedAt: iso(x.created_at),
    settledAt: isoOrNull(x.settled_at),
  }));
  return { received, fundings, refunds, studyPayments };
}

/** On close: everything left in the vault is set aside for refund to the funding wallet. */
export function authorizeRefund(db: DB, s: StudyRow, nowMs: number, actorId: string) {
  const esc = escrowOf(db, s.id)!;
  const amount = vaultBalance(db, s.id);
  if (amount === 0) return;
  if (!esc.funding_wallet) throw fail('INTERNAL', 'Funded escrow without a funding wallet.');
  postEscrow(db, planAuthorizeRefund({ studyId: s.id, vaultBalanceUnits: amount }), nowMs);
  db.prepare(`INSERT INTO settlements (id, kind, study_id, destination, amount_units, status, next_attempt_at, created_at) VALUES (?, 'refund', ?, ?, ?, 'pending', ?, ?)`).run(
    newId(),
    s.id,
    esc.funding_wallet,
    amount,
    nowMs,
    nowMs,
  );
  audit(db, actorId, 'escrow.refund_authorized', 'study', s.id, `${amount} units to the funding wallet (simulated settlement)`, nowMs);
}

/**
 * Verifies a funding signature against the server-owned expectation and records the outcome.
 * `confirmed` credits the vault once (unique signature and unique funding posting).
 */
export async function verifyFunding(db: DB, provider: SettlementProvider, f: FundingRow, signature: string, nowMs: number, actorId: string): Promise<FundingRow> {
  const esc = escrowOf(db, f.study_id)!;
  const seen = await provider.getTransfer(signature);
  const verdict = verifyFundingTransfer(
    { network: provider.network, mint: provider.mint, vault: esc.vault, amountUnits: f.amount_units, reference: f.reference, notBeforeMs: f.created_at },
    seen,
  );
  db.transaction(() => {
    const cur = db.prepare('SELECT * FROM escrow_fundings WHERE id = ?').get(f.id) as FundingRow;
    if (cur.status === 'confirmed' || cur.status === 'failed' || cur.status === 'expired') return;
    if (cur.signature && cur.signature !== signature) throw fail('CONFLICT_STATE', 'This funding request already has a different transfer.');
    const usedElsewhere = db.prepare('SELECT 1 FROM escrow_fundings WHERE signature = ? AND id != ?').get(signature, f.id);
    if (usedElsewhere) throw fail('CONFLICT_STATE', 'This transfer already funded another request.');
    // A refund needs somewhere to go: never confirm a transfer whose funding wallet is unknown.
    if (verdict.status === 'confirmed' && !seen?.source) {
      verdict.status = 'failed';
      verdict.reason = 'The transfer has no identifiable funding wallet, so a refund would have nowhere to go.';
    }
    if (verdict.status === 'pending') {
      db.prepare(`UPDATE escrow_fundings SET status = 'pending', signature = ? WHERE id = ?`).run(signature, f.id);
    } else if (verdict.status === 'failed') {
      db.prepare(`UPDATE escrow_fundings SET status = 'failed', signature = ?, failure_reason = ? WHERE id = ?`).run(signature, verdict.reason, f.id);
    } else {
      db.prepare(`UPDATE escrow_fundings SET status = 'confirmed', signature = ?, source = ?, confirmed_at = ? WHERE id = ?`).run(signature, seen!.source, nowMs, f.id);
      db.prepare('UPDATE study_escrows SET funding_wallet = ? WHERE study_id = ?').run(seen!.source, f.study_id);
      postEscrow(db, planFunding({ studyId: f.study_id, fundingId: f.id, amountUnits: f.amount_units }), nowMs, f.id);
      audit(db, actorId, 'escrow.funding_confirmed', 'study', f.study_id, `${f.amount_units} units from ${seen!.source} (simulated settlement)`, nowMs);
      // A funding that lands after its study closed (its builder deleted the account while the
      // transfer was in flight) is refunded at once to the wallet it came from.
      const study = db.prepare('SELECT * FROM studies WHERE id = ?').get(f.study_id) as StudyRow;
      if (study.status === 'closed') authorizeRefund(db, study, nowMs, actorId);
    }
  })();
  return db.prepare('SELECT * FROM escrow_fundings WHERE id = ?').get(f.id) as FundingRow;
}
