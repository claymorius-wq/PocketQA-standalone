import type { Firestore } from 'firebase-admin/firestore';
import {
  escrowAvailability,
  escrowInvariant,
  planApprovalPoints,
  planAuthorizePayout,
  planAuthorizeRefund,
  quoteEscrow,
  type EscrowPosting,
  type EscrowQuote,
  type NewPointsEvent,
} from '@pocket-qa/domain';
import type { TxCtx } from '../../firestore/tx';
import { fail, iso, newId } from '../../util';
import type { ParticipationRow, StudyRow } from '../../views/studies';
import { auditInTx, userInTx } from '../core/firestore';
import type { EscrowRepo, EscrowRow, SettlementRow, WalletLink } from './types';

/**
 * Escrow domain on Firestore (plan §2.1, r2 §R2 rows 12–33, R9 composition).
 *
 * Documents keep today's SQLite row shapes (snake_case), like the core repo's users.
 *  walletLinks/{userId}                       wallet_links row (PK user_id)
 *  walletAddresses/{address}                  UNIQUE(wallet_links.address) → { user_id }
 *  studyEscrows/{studyId}                     study_escrows row + builder_id (self-dealing lookups)
 *  escrowVaults/{vault}                       UNIQUE(study_escrows.vault)
 *  escrowFundings/{id}                        escrow_fundings row
 *  escrowLedger/{guardKey}:{i}                escrow_ledger postings, APPEND-ONLY (no update or delete
 *                                             anywhere in this repo); ids derive from the guard of the
 *                                             money event they belong to, so a rerun writes the same ids
 *  escrowBooks/{studyId}                      { accounts: {account: total} }: running totals, updated
 *                                             in the same transaction as every posting
 *  escrowGuards/{kind}:{ref}                  rows 20–25 (only for postings with amount > 0)
 *  settlements/{id}, settlementGuards/{payout:pid | refund:study}
 *  builderFundingWallets/{builderId}:{wallet} "this wallet funded one of this builder's studies"
 *  pointsEvents/{pid}:{kind} | {reversedId}:reversal   points_events, APPEND-ONLY
 *  pointsAwards/{pid}:{kind}                  row 30 (accepted, helpful only)
 *  pointsReversals/{reversedId}               row 31
 *  pointsFlags/{pid}, fraudFindings/{pid}     PK participation_id
 */
export const C = {
  walletLinks: 'walletLinks',
  walletAddresses: 'walletAddresses',
  studyEscrows: 'studyEscrows',
  escrowVaults: 'escrowVaults',
  escrowFundings: 'escrowFundings',
  escrowLedger: 'escrowLedger',
  escrowBooks: 'escrowBooks',
  escrowGuards: 'escrowGuards',
  settlements: 'settlements',
  settlementGuards: 'settlementGuards',
  builderFundingWallets: 'builderFundingWallets',
  pointsEvents: 'pointsEvents',
  pointsAwards: 'pointsAwards',
  pointsReversals: 'pointsReversals',
  pointsFlags: 'pointsFlags',
  fraudFindings: 'fraudFindings',
} as const;

export type StudyEscrowDoc = EscrowRow & { builder_id: string };
type Books = { accounts: Record<string, number> };

const ref = (fs: Firestore, c: keyof typeof C, id: string) => fs.collection(C[c]).doc(id);
const quoteOf = (s: Pick<StudyRow, 'reward_credits' | 'slots'>, esc: Pick<EscrowRow, 'fee_bps'>): EscrowQuote =>
  quoteEscrow({ rewardUnits: s.reward_credits, slots: s.slots, feeBps: esc.fee_bps });

// ── In-transaction reads (TxCtx: reads pass through; never read a doc written in the same tx) ──

/** 1. The study's escrow, or undefined for a test-credit study. */
export async function escrowOfInTx(t: TxCtx, fs: Firestore, studyId: string): Promise<EscrowRow | undefined> {
  const snap = await t.get(ref(fs, 'studyEscrows', studyId));
  if (!snap.exists) return undefined;
  const { builder_id: _b, ...row } = snap.data() as StudyEscrowDoc;
  return row;
}

/** 2. A confirmed funding exists (guard `escrowGuards/confirmedFunding:{study}`, created on confirm). */
export async function isFundedInTx(t: TxCtx, fs: Firestore, studyId: string): Promise<boolean> {
  return (await t.get(ref(fs, 'escrowGuards', `confirmedFunding:${studyId}`))).exists;
}

/** 3. A funding in awaiting_payment, pending or confirmed exists (locks the draft's reward and slots). */
export async function fundingStartedInTx(t: TxCtx, fs: Firestore, studyId: string): Promise<boolean> {
  // Single-field equality query; the few fundings of one study are filtered here (no composite index).
  const snap = await t.query(fs.collection(C.escrowFundings).where('study_id', '==', studyId));
  return snap.docs.some((d) => ['awaiting_payment', 'pending', 'confirmed'].includes(d.get('status') as string));
}

async function booksInTx(t: TxCtx, fs: Firestore, studyId: string): Promise<Books> {
  const snap = await t.get(ref(fs, 'escrowBooks', studyId));
  return snap.exists ? (snap.data() as Books) : { accounts: {} };
}

/** 4. The study vault's balance (`vault:{study}` running total). */
export async function vaultBalanceInTx(t: TxCtx, fs: Firestore, studyId: string): Promise<number> {
  return (await booksInTx(t, fs, studyId)).accounts[`vault:${studyId}`] ?? 0;
}

/** 5. Can a new tester reserve a slot? `holdingCount`: participations holding budget (from studies). */
export async function canReserveInTx(t: TxCtx, fs: Firestore, s: StudyRow, holdingCount: number, _nowMs: number): Promise<boolean> {
  const esc = (await escrowOfInTx(t, fs, s.id))!;
  return escrowAvailability({ vaultBalanceUnits: await vaultBalanceInTx(t, fs, s.id), quote: quoteOf(s, esc), holdingCount }).canReserve;
}

/** 6. The user's linked wallet address, or null. */
export async function walletAddressOfInTx(t: TxCtx, fs: Firestore, userId: string): Promise<string | null> {
  const snap = await t.get(ref(fs, 'walletLinks', userId));
  return snap.exists ? (snap.data() as { address: string }).address : null;
}

/** 7. Self-dealing: did `wallet` fund any study of this builder? */
export async function walletFundedBuilderInTx(t: TxCtx, fs: Firestore, builderId: string, wallet: string): Promise<boolean> {
  return (await t.get(ref(fs, 'builderFundingWallets', `${builderId}:${wallet}`))).exists;
}

/** The escrow books of a study from its running totals (same result as summing every posting). */
export function booksFromTotals(studyId: string, books: Books, quote: EscrowQuote, holdingCount: number) {
  const postings: EscrowPosting[] = Object.entries(books.accounts).map(([account, amount]) => ({ account, amount, kind: 'funding', studyId, participationId: null }));
  return escrowInvariant({ studyId, postings, quote, holdingCount });
}

// ── In-transaction writes ──────────────────────────────────────────────────────────────────

/**
 * Buffers balanced postings and the study's new running totals. `books` must be the totals READ in
 * this transaction (callers read once, then post once per study per transaction).
 */
function postInTx(t: TxCtx, fs: Firestore, studyId: string, books: Books, postings: EscrowPosting[], idPrefix: string, ref_: string | null, nowMs: number) {
  if (postings.length === 0) return;
  if (postings.reduce((s, p) => s + p.amount, 0) !== 0) throw new Error('unbalanced escrow transaction');
  const accounts = { ...books.accounts };
  postings.forEach((p, i) => {
    if (!p.studyId) throw new Error('escrow posting without a study');
    t.create(ref(fs, 'escrowLedger', `${idPrefix}:${i}`), {
      id: `${idPrefix}:${i}`,
      tx_id: idPrefix,
      account: p.account,
      amount: p.amount,
      kind: p.kind,
      study_id: p.studyId,
      participation_id: p.participationId,
      ref: ref_,
      created_at: iso(nowMs),
    });
    accounts[p.account] = (accounts[p.account] ?? 0) + p.amount;
  });
  t.set(ref(fs, 'escrowBooks', studyId), { accounts });
}

/** 8. A wallet-funded study's escrow (createStudy), with its vault guard (row 16). */
export async function createEscrowInTx(t: TxCtx, fs: Firestore, row: Omit<EscrowRow, 'funding_wallet' | 'multisig' | 'vault_authority'> & { builder_id: string }): Promise<void> {
  const g = await t.claimGuard(ref(fs, 'escrowVaults', row.vault), { study_id: row.study_id });
  if (!g.created) throw fail('CONFLICT_STATE', 'This escrow vault already belongs to another study.');
  t.create(ref(fs, 'studyEscrows', row.study_id), { ...row, funding_wallet: null, multisig: null, vault_authority: null } satisfies StudyEscrowDoc);
}

/**
 * 9. Approval authorizes exactly one payout: the frozen reward to the wallet frozen at consent.
 * `othersHolding`: participations other than `p` that hold budget (from studies).
 */
export async function authorizePayoutInTx(
  t: TxCtx,
  fs: Firestore,
  s: StudyRow,
  p: ParticipationRow,
  othersHolding: number,
  nowMs: number,
  actorId: string,
  why: string,
  cosigner: 'builder' | 'arbiter',
): Promise<void> {
  const esc = (await escrowOfInTx(t, fs, s.id))!;
  const books = await booksInTx(t, fs, s.id);
  const quote = quoteOf(s, esc);
  if (!p.payout_address) throw fail('INTERNAL', 'Escrow participation without a frozen payout wallet.');
  // Rows 22 and 26: one authorization, one payout settlement per participation.
  const auth = await t.claimGuard(ref(fs, 'escrowGuards', `payoutAuthorized:${p.id}`), { participation_id: p.id });
  const settlementId = newId();
  const one = await t.claimGuard(ref(fs, 'settlementGuards', `payout:${p.id}`), { settlement_id: settlementId });
  if (!auth.created || !one.created) throw fail('CONFLICT_STATE', 'This payout is already authorized.');
  const vault = books.accounts[`vault:${s.id}`] ?? 0;
  const postings = planAuthorizePayout({ studyId: s.id, participationId: p.id, quote, vaultAvailableIncludingThis: vault - quote.perTestTotalUnits * othersHolding });
  postInTx(t, fs, s.id, books, postings, `payoutAuthorized:${p.id}`, null, nowMs);
  t.create(ref(fs, 'settlements', settlementId), {
    id: settlementId,
    kind: 'payout',
    study_id: s.id,
    participation_id: p.id,
    tester_id: p.tester_id,
    destination: p.payout_address,
    amount_units: quote.rewardUnits,
    status: 'pending',
    attempt: 0,
    attempt_key: null,
    signature: null,
    failure_reason: null,
    next_attempt_at: nowMs,
    created_at: nowMs,
    settled_at: null,
    cosigner,
  } satisfies SettlementRow);
  auditInTx(t, fs, {
    id: newId(),
    actor_id: actorId,
    action: 'escrow.payout_authorized',
    target_type: 'participation',
    target_id: p.id,
    reason: `${quote.rewardUnits} units to the frozen payout wallet (simulated settlement) · ${why}`,
    created_at: iso(nowMs),
  });
}

/**
 * 10. On close: everything left in the vault is set aside for refund to the funding wallet.
 * `cosigner`: the builder normally; the arbiter when the builder can no longer sign.
 * `prior`: totals/escrow already read in this transaction by the caller (internal use).
 */
export async function authorizeRefundInTx(
  t: TxCtx,
  fs: Firestore,
  s: StudyRow,
  nowMs: number,
  actorId: string,
  cosigner: 'builder' | 'arbiter',
  prior?: { esc: EscrowRow; books: Books },
): Promise<void> {
  const esc = prior?.esc ?? (await escrowOfInTx(t, fs, s.id))!;
  const books = prior?.books ?? (await booksInTx(t, fs, s.id));
  const amount = books.accounts[`vault:${s.id}`] ?? 0;
  if (amount === 0) return;
  if (!esc.funding_wallet) throw fail('INTERNAL', 'Funded escrow without a funding wallet.');
  // Rows 24 and 27 (amount > 0 here).
  const auth = await t.claimGuard(ref(fs, 'escrowGuards', `refundAuthorized:${s.id}`), { study_id: s.id });
  const settlementId = newId();
  const one = await t.claimGuard(ref(fs, 'settlementGuards', `refund:${s.id}`), { settlement_id: settlementId });
  if (!auth.created || !one.created) throw fail('CONFLICT_STATE', 'This study’s refund is already authorized.');
  postInTx(t, fs, s.id, books, planAuthorizeRefund({ studyId: s.id, vaultBalanceUnits: amount }), `refundAuthorized:${s.id}`, null, nowMs);
  t.create(ref(fs, 'settlements', settlementId), {
    id: settlementId,
    kind: 'refund',
    study_id: s.id,
    participation_id: null,
    tester_id: null,
    destination: esc.funding_wallet,
    amount_units: amount,
    status: 'pending',
    attempt: 0,
    attempt_key: null,
    signature: null,
    failure_reason: null,
    next_attempt_at: nowMs,
    created_at: nowMs,
    settled_at: null,
    cosigner,
  } satisfies SettlementRow);
  auditInTx(t, fs, {
    id: newId(),
    actor_id: actorId,
    action: 'escrow.refund_authorized',
    target_type: 'study',
    target_id: s.id,
    reason: `${amount} units to the funding wallet (simulated settlement)`,
    created_at: iso(nowMs),
  });
}

/** Buffers points events (append-only) with their guards (rows 30, 31). Ids are deterministic. */
function appendPointsInTx(t: TxCtx, fs: Firestore, userId: string, events: NewPointsEvent[], nowMs: number) {
  for (const e of events) {
    const id = e.reversesId ? `${e.reversesId}:reversal` : `${e.participationId}:${e.kind}`;
    if (e.kind === 'accepted' || e.kind === 'helpful') t.create(ref(fs, 'pointsAwards', `${e.participationId}:${e.kind}`), { event_id: id });
    if (e.reversesId) t.create(ref(fs, 'pointsReversals', e.reversesId), { event_id: id });
    t.create(ref(fs, 'pointsEvents', id), {
      id,
      user_id: userId,
      participation_id: e.participationId,
      kind: e.kind,
      points: e.points,
      reverses_id: e.reversesId ?? null,
      platform: e.platform,
      created_at: iso(nowMs),
    });
  }
}

/**
 * 11. Points for accepted work (inside the caller's decide/overturn transaction). `helpful` comes
 * only from the study owner's approval. Already awarded: nothing happens. Self-dealing (the payout
 * or linked wallet funded one of this builder's studies): no points, a flag for review instead.
 */
export async function awardApprovalInTx(t: TxCtx, fs: Firestore, s: StudyRow, p: ParticipationRow, helpful: boolean, nowMs: number): Promise<void> {
  if ((await t.get(ref(fs, 'pointsAwards', `${p.id}:accepted`))).exists) return;
  const linked = await walletAddressOfInTx(t, fs, p.tester_id);
  let why: string | null = null;
  for (const w of [p.payout_address, linked]) {
    if (!w) continue;
    if (await walletFundedBuilderInTx(t, fs, s.builder_id, w)) {
      why = 'The tester’s wallet funded a study by the same builder (possible self-dealing); points withheld for review.';
      break;
    }
  }
  if (why) {
    // INSERT OR IGNORE
    const flag = ref(fs, 'pointsFlags', p.id);
    if (!(await t.get(flag)).exists) t.create(flag, { participation_id: p.id, reason: why, created_at: iso(nowMs) });
    return;
  }
  const tester = await userInTx(t, fs, p.tester_id);
  const platform = tester?.device_json ? ((JSON.parse(tester.device_json) as { platform?: string }).platform ?? null) : null;
  appendPointsInTx(t, fs, p.tester_id, planApprovalPoints({ participationId: p.id, helpful, platform }), nowMs);
}

// ── Repository (outside composite transactions) ────────────────────────────────────────────

export function firestoreEscrowRepo(fs: Firestore): EscrowRepo {
  const done: Pick<EscrowRepo, 'walletLinkOf'> = {
    async walletLinkOf(userId) {
      const snap = await fs.collection(C.walletLinks).doc(userId).get();
      if (!snap.exists) return null;
      const d = snap.data() as { address: string; linked_at: string };
      return { address: d.address, linkedAt: d.linked_at } satisfies WalletLink;
    },
  };
  // The remaining operations land next (pqa-be3 step B); until then they fail loudly, never silently.
  return new Proxy(done as EscrowRepo, {
    get(target, prop: string) {
      if (prop in target) return target[prop as keyof EscrowRepo];
      return async () => {
        throw new Error(`firestore escrow repo: ${prop} is not implemented yet`);
      };
    },
  });
}
