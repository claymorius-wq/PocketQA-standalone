import {
  escrowAvailability,
  escrowInvariant,
  holdsBudget,
  planAuthorizePayout,
  planAuthorizeRefund,
  quoteEscrow,
  verifyFundingTransfer,
  type EscrowPosting,
  type EscrowQuote,
} from '@pocket-qa/domain';
import type { DB } from './db';
import type { Repos } from './repo';
import type { EscrowRepo, EscrowRow, FundingRow, SettlementRow } from './repo/escrow/types';
import type { SettlementProvider } from './settlement/types';
import { fail, iso, newId } from './util';
import { participationStatuses, type ParticipationRow, type StudyRow } from './views';

/**
 * Wallet-funded escrow on the API side (ADR 0007): the money ledger, reservations, payout and
 * refund authorization, and funding verification. Only SIMULATED settlement exists; the provider
 * is injected (`deps.settlement`), and nothing here signs or sends.
 */
export type { EscrowRow, FundingRow, SettlementRow } from './repo/escrow/types';

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
export function authorizePayout(db: DB, s: StudyRow, p: ParticipationRow, nowMs: number, actorId: string, why: string, cosigner: 'builder' | 'arbiter' = 'builder') {
  const esc = escrowOf(db, s.id)!;
  const quote = studyQuote(s, esc);
  if (!p.payout_address) throw fail('INTERNAL', 'Escrow participation without a frozen payout wallet.');
  const othersHolding = holdingCount(db, s.id, nowMs) - 1;
  postEscrow(db, planAuthorizePayout({ studyId: s.id, participationId: p.id, quote, vaultAvailableIncludingThis: vaultBalance(db, s.id) - quote.perTestTotalUnits * othersHolding }), nowMs);
  db.prepare(
    `INSERT INTO settlements (id, kind, study_id, participation_id, tester_id, destination, amount_units, status, next_attempt_at, created_at, cosigner) VALUES (?, 'payout', ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  ).run(newId(), s.id, p.id, p.tester_id, p.payout_address, quote.rewardUnits, nowMs, nowMs, cosigner);
  audit(db, actorId, 'escrow.payout_authorized', 'participation', p.id, `${quote.rewardUnits} units to the frozen payout wallet (simulated settlement) · ${why}`, nowMs);
}

/** What the payments export reads, per backend (rows ordered by created_at ascending). */
export type PaymentsExportInput = {
  /** The user's received payouts, with their study titles. */
  received: (SettlementRow & { title: string })[];
  /** Funding requests of the user's own studies. */
  fundings: FundingRow[];
  /** Refunds of the user's own studies. */
  refunds: SettlementRow[];
  /** Payouts of the user's own studies, with the study terms that fix the fee. */
  studyPayments: { study_id: string; amount_units: number; status: SettlementRow['status']; created_at: number; settled_at: number | null; fee_bps: number; reward_credits: number; slots: number }[];
  /** The settlement kind of a study's escrow ('simulated' when none). */
  settlementOf: (studyId: string) => EscrowRow['settlement'];
};

/**
 * The money part of the user's own data export (ADR 0007), least data and own data only:
 * a tester's rewards (to their own frozen wallet); a builder's fundings, refunds and per-test
 * payments of their own studies, with no tester identity, participation or wallet. Amounts are
 * exact decimal strings of base units. Provider-internal fields (attempt keys) never appear.
 * Pure: both backends feed it.
 */
export function paymentsExportFrom(input: PaymentsExportInput) {
  const units = (n: number) => String(n);
  const asset = (studyId: string) => ({ asset: 'USDC' as const, decimals: 6 as const, settlement: input.settlementOf(studyId) });
  const isoOrNull = (ms: number | null) => (ms === null ? null : iso(ms));
  return {
    received: input.received.map((x) => ({
      participationId: x.participation_id!,
      studyId: x.study_id,
      studyTitle: x.title,
      amountUnits: units(x.amount_units),
      ...asset(x.study_id),
      destination: x.destination,
      status: x.status,
      signature: x.signature,
      authorizedAt: iso(x.created_at),
      settledAt: isoOrNull(x.settled_at),
    })),
    fundings: input.fundings.map((f) => ({
      id: f.id,
      studyId: f.study_id,
      amountUnits: units(f.amount_units),
      ...asset(f.study_id),
      source: f.source,
      status: f.status,
      signature: f.signature,
      createdAt: iso(f.created_at),
      confirmedAt: isoOrNull(f.confirmed_at),
    })),
    refunds: input.refunds.map((x) => ({
      studyId: x.study_id,
      amountUnits: units(x.amount_units),
      ...asset(x.study_id),
      destination: x.destination,
      status: x.status,
      signature: x.signature,
      settledAt: isoOrNull(x.settled_at),
    })),
    studyPayments: input.studyPayments.map((x) => ({
      studyId: x.study_id,
      amountUnits: units(x.amount_units),
      feeUnits: units(studyQuote({ reward_credits: x.reward_credits, slots: x.slots }, { fee_bps: x.fee_bps }).perTestFeeUnits),
      status: x.status,
      authorizedAt: iso(x.created_at),
      settledAt: isoOrNull(x.settled_at),
    })),
  };
}

export function paymentsExport(db: DB, userId: string) {
  return paymentsExportFrom({
    received: db.prepare(`SELECT x.*, s.title FROM settlements x JOIN studies s ON s.id = x.study_id WHERE x.kind = 'payout' AND x.tester_id = ? ORDER BY x.created_at`).all(userId) as (SettlementRow & { title: string })[],
    fundings: db.prepare(`SELECT f.* FROM escrow_fundings f JOIN studies s ON s.id = f.study_id WHERE s.builder_id = ? ORDER BY f.created_at`).all(userId) as FundingRow[],
    refunds: db.prepare(`SELECT x.* FROM settlements x JOIN studies s ON s.id = x.study_id WHERE x.kind = 'refund' AND s.builder_id = ? ORDER BY x.created_at`).all(userId) as SettlementRow[],
    studyPayments: db
      .prepare(
        `SELECT x.study_id, x.amount_units, x.status, x.created_at, x.settled_at, e.fee_bps, s.reward_credits, s.slots
         FROM settlements x JOIN studies s ON s.id = x.study_id JOIN study_escrows e ON e.study_id = s.id
         WHERE x.kind = 'payout' AND s.builder_id = ? ORDER BY x.created_at`,
      )
      .all(userId) as PaymentsExportInput['studyPayments'],
    settlementOf: (studyId) => escrowOf(db, studyId)?.settlement ?? 'simulated',
  });
}

/** On close: everything left in the vault is set aside for refund to the funding wallet. */
/** `cosigner`: the builder normally; the arbiter when the builder can no longer sign (account deleted). */
export function authorizeRefund(db: DB, s: StudyRow, nowMs: number, actorId: string, cosigner: 'builder' | 'arbiter' = 'builder') {
  const esc = escrowOf(db, s.id)!;
  const amount = vaultBalance(db, s.id);
  if (amount === 0) return;
  if (!esc.funding_wallet) throw fail('INTERNAL', 'Funded escrow without a funding wallet.');
  postEscrow(db, planAuthorizeRefund({ studyId: s.id, vaultBalanceUnits: amount }), nowMs);
  db.prepare(`INSERT INTO settlements (id, kind, study_id, destination, amount_units, status, next_attempt_at, created_at, cosigner) VALUES (?, 'refund', ?, ?, ?, 'pending', ?, ?, ?)`).run(
    newId(),
    s.id,
    esc.funding_wallet,
    amount,
    nowMs,
    nowMs,
    cosigner,
  );
  audit(db, actorId, 'escrow.refund_authorized', 'study', s.id, `${amount} units to the funding wallet (simulated settlement)`, nowMs);
}

/**
 * Verifies a funding signature against the server-owned expectation and records the outcome.
 * The provider is read first (network, outside any transaction); the repository then records the
 * verdict in one transaction, where `confirmed` credits the vault once (unique signature and
 * unique funding posting).
 */
export async function verifyFunding(repo: EscrowRepo, provider: SettlementProvider, f: FundingRow, signature: string, nowMs: number, actorId: string): Promise<FundingRow> {
  const esc = (await repo.escrowOf(f.study_id))!;
  const seen = await provider.getTransfer(signature, { vault: esc.vault, reference: f.reference });
  const verdict = verifyFundingTransfer(
    { network: provider.network, mint: provider.mint, vault: esc.vault, amountUnits: f.amount_units, reference: f.reference, notBeforeMs: f.created_at },
    seen,
  );
  return repo.recordFundingVerdict({ fundingId: f.id, signature, verdict, source: seen?.source ?? null, nowMs, actorId, label: settlementLabel(provider) });
}

/** How audit copy names the settlement a provider performs. */
export const settlementLabel = (provider: Pick<SettlementProvider, 'mode'>) =>
  provider.mode === 'simulated' ? 'simulated settlement' : 'Squads devnet pilot, devnet test USDC, no value';

/** The study's whole quote in token units (reward pool plus disclosed fee), through the repository. */
export async function escrowQuoteOf(repo: Repos, s: StudyRow): Promise<number> {
  const esc = await repo.escrow.escrowOf(s.id);
  if (!esc) throw fail('CONFLICT_STATE', 'This study is paid with test credits, not a wallet.');
  return studyQuote(s, esc).totalUnits;
}
