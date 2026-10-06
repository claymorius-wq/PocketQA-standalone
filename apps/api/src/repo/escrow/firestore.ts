import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import {
  assertCleanCopy,
  holdsBudget,
  planFunding,
  planReversal,
  planSettlePayout,
  planSettleRefund,
  transitionPayout,
  type DomainError,
  type NonceRecord,
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
import { paymentsExportFrom } from '../../escrow';
import { runTxCtx, type TxCtx, type TxHooks } from '../../firestore/tx';
import { decidedWorkFrom, leaderboardFrom, reputationExportFrom, reputationFrom, toEvent, type DecidedRow, type EventRow, type OwnFinding, type ProfileRow } from '../../reputation';
import { fail, iso, newId, notFound, sha256 } from '../../util';
import type { UserRow } from '../../views/core';
import type { DisputeRow, ParticipationRow, StudyRow } from '../../views/studies';
import { auditInTx, firestoreCoreRepo, userInTx } from '../core/firestore';
import { firestoreStudiesRepo } from '../studies/firestore';
import { firestoreDevnetStore } from './devnetStore';
import type { EscrowRepo, EscrowRow, FundingRow, SettlementRow, SimTransferRow, TransferRow, WalletLink } from './types';

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
 *  walletNonces/{nonce}, walletChallenges/{nonce}   single use: used_at set once, in a transaction
 *  devnetTransfers/{id}; openTransfers/{pid} (row 15: deleted when the transfer fails or expires);
 *  transferSignatures/{sig} (row 14)
 *  openFundings/{studyId}                     one open funding request per study (rule G, replaced
 *                                             when the open one is no longer open); fundingRefs/{ref}
 *                                             (row 18); fundingSignatures/{sig} (row 19)
 *  settlementSignatures/{sig} (row 28); simChainTransfers/{sig}, simIdempotency/{key} (row 29)
 *  leaderboardProfiles/{userId}; leaderboardAliases/{sha256(lower(alias))} (row 32: held while the
 *                                             profile's alias is that alias, opted in or not, as SQLite)
 *
 * Cross-domain reads inside transactions read the studies domain's documents (`studies/{id}`,
 * `participations/{id}`, `disputeByParticipation/{pid}` → `disputes/{id}`) in their documented
 * StudyRow/ParticipationRow/DisputeRow shapes, until pqa-be1 exports in-tx readers for them.
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
  walletNonces: 'walletNonces',
  walletChallenges: 'walletChallenges',
  devnetTransfers: 'devnetTransfers',
  openTransfers: 'openTransfers',
  transferSignatures: 'transferSignatures',
  openFundings: 'openFundings',
  fundingRefs: 'fundingRefs',
  fundingSignatures: 'fundingSignatures',
  settlementSignatures: 'settlementSignatures',
  simChainTransfers: 'simChainTransfers',
  simIdempotency: 'simIdempotency',
  leaderboardProfiles: 'leaderboardProfiles',
  leaderboardAliases: 'leaderboardAliases',
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
function postInTx(t: TxCtx, fs: Firestore, studyId: string, books: Books, postings: EscrowPosting[], idPrefix: string, ref_: string | null, nowMs: number): Books {
  if (postings.length === 0) return books;
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
  return { accounts };
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
  for (const [ord, e] of events.entries()) {
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
      // Order within one append (SQLite: rowid), after created_at.
      ord,
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


// ── Cross-domain reads inside transactions (studies domain documents, see the header) ──────

async function studyInTx(t: TxCtx, fs: Firestore, id: string): Promise<StudyRow | undefined> {
  const snap = await t.get(fs.collection('studies').doc(id));
  return snap.exists ? (snap.data() as StudyRow) : undefined;
}
async function participationInTx(t: TxCtx, fs: Firestore, id: string): Promise<ParticipationRow | undefined> {
  const snap = await t.get(fs.collection('participations').doc(id));
  return snap.exists ? (snap.data() as ParticipationRow) : undefined;
}
async function disputeOfInTx(t: TxCtx, fs: Firestore, participationId: string): Promise<DisputeRow | undefined> {
  const g = await t.get(fs.collection('disputeByParticipation').doc(participationId));
  if (!g.exists) return undefined;
  const d = await t.get(fs.collection('disputes').doc(g.data()!.dispute_id as string));
  return d.exists ? (d.data() as DisputeRow) : undefined;
}

// ── Repository (outside composite transactions) ────────────────────────────────────────────

type NonceDoc = { nonce: string; user_id: string; address: string; input_json: string; expires_at: number; used_at: number | null };
type ChallengeDoc = { nonce: string; address: string; input_json: string; expires_at: number; used_at: number | null; created_at: number };
type ProfileDoc = { user_id: string; opted_in: 0 | 1; alias: string | null; updated_at: string };
type PointsDoc = EventRow & { ord: number };

const data = <T>(snap: DocumentSnapshot): T | undefined => (snap.exists ? (snap.data() as T) : undefined);
const all = <T>(docs: { data(): unknown }[]) => docs.map((d) => d.data() as T);
const byCreatedAsc = <T extends { created_at: number | string }>(a: T, b: T) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0);
const aliasKey = (alias: string) => sha256(alias.toLowerCase());
const OPEN_FUNDING: FundingRow['status'][] = ['awaiting_payment', 'pending'];
/** Firestore's transaction limit is 500 writes; purge batches stay well below it. */
const PURGE_BATCH = 100;

export function firestoreEscrowRepo(fs: Firestore, hooks: TxHooks = {}): EscrowRepo {
  const tx = <T>(fn: (t: TxCtx) => Promise<T>) => runTxCtx(fs, fn, hooks);
  const r = (c: keyof typeof C, id: string) => ref(fs, c, id);
  const studies = firestoreStudiesRepo(fs);
  const core = firestoreCoreRepo(fs);

  const escrowDoc = async (studyId: string) => data<StudyEscrowDoc>(await r('studyEscrows', studyId).get());
  const settlementOf = async (id: string) => data<SettlementRow>(await r('settlements', id).get());
  const viaGuard = async (c: 'settlementGuards', key: string) => {
    const g = data<{ settlement_id: string }>(await r(c, key).get());
    return g ? settlementOf(g.settlement_id) : undefined;
  };
  const booksOf = async (studyId: string) => data<Books>(await r('escrowBooks', studyId).get()) ?? { accounts: {} };
  const eventsOf = async (userId: string): Promise<EventRow[]> =>
    all<PointsDoc>((await fs.collection(C.pointsEvents).where('user_id', '==', userId).get()).docs)
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.ord - b.ord))
      .map(({ ord: _o, ...e }) => e);
  const profileOf = async (userId: string): Promise<ProfileRow | undefined> => {
    const p = data<ProfileDoc>(await r('leaderboardProfiles', userId).get());
    return p ? { opted_in: p.opted_in, alias: p.alias } : undefined;
  };

  /** Reputation's decided work for a tester (participations, disputes, fraud findings, platforms). */
  const decidedWork = async (userId: string) => {
    const parts = (await studies.listParticipationsByTester(userId)).filter((p) => ['approved', 'rejected', 'resolved'].includes(p.status));
    if (parts.length === 0) return [];
    const disputes = new Map((await studies.listDisputesByOpener(userId)).map((d) => [d.participation_id, d]));
    const fraud = await fs.getAll(...parts.map((p) => r('fraudFindings', p.id)));
    const accepted = await fs.getAll(...parts.map((p) => r('pointsEvents', `${p.id}:accepted`)));
    const rows: DecidedRow[] = parts.map((p, i) => {
      const d = disputes.get(p.id);
      return {
        id: p.id,
        status: p.status,
        decided_at: p.decided_at,
        outcome: d?.outcome ?? null,
        resolved_at: d?.resolved_at ?? null,
        fraud: fraud[i]!.exists ? p.id : null,
        platform: accepted[i]!.exists ? ((accepted[i]!.data() as EventRow).platform ?? null) : null,
      };
    });
    return decidedWorkFrom(rows);
  };

  const leaderboard = async (nowMs: number) => {
    const profiles = all<ProfileDoc>((await fs.collection(C.leaderboardProfiles).where('opted_in', '==', 1).get()).docs).filter((p) => p.alias !== null);
    if (profiles.length === 0) return leaderboardFrom([], nowMs);
    const users = await fs.getAll(...profiles.map((p) => fs.collection('users').doc(p.user_id)));
    const live = profiles.filter((_, i) => users[i]!.exists && (users[i]!.data() as UserRow).status === 'active');
    const entries = await Promise.all(live.map(async (p) => ({ userId: p.user_id, alias: p.alias!, work: await decidedWork(p.user_id), events: await eventsOf(p.user_id) })));
    return leaderboardFrom(entries, nowMs);
  };

  /** A transfer leaves the open statuses: its open-transfer guard is released (row 15). */
  const releaseOpenTransfer = (t: TxCtx, row: TransferRow, guard: { transfer_id: string } | undefined) => {
    if (guard?.transfer_id === row.id) t.delete(r('openTransfers', row.participation_id));
  };

  return {
    devnet: firestoreDevnetStore(fs, hooks),

    // ── Wallet links ──
    async walletLinkOf(userId) {
      const d = data<{ address: string; linked_at: string }>(await r('walletLinks', userId).get());
      return d ? ({ address: d.address, linkedAt: d.linked_at } satisfies WalletLink) : null;
    },

    async createLinkNonce(n) {
      await r('walletNonces', n.nonce).create({ nonce: n.nonce, user_id: n.userId, address: n.address, input_json: n.inputJson, expires_at: n.expiresAtMs, used_at: null } satisfies NonceDoc);
    },

    async linkWallet({ userId, address, nonce, nowMs, verify }) {
      return tx(async (t): Promise<DomainError | null> => {
        const row = data<NonceDoc>(await t.get(r('walletNonces', nonce)));
        const current = data<{ address: string }>(await t.get(r('walletLinks', userId)));
        const owner = data<{ user_id: string }>(await t.get(r('walletAddresses', address)));
        const record: NonceRecord | null = row
          ? { userId: row.user_id, address: row.address, nonce: row.nonce, input: JSON.parse(row.input_json), expiresAtMs: row.expires_at, usedAtMs: row.used_at }
          : null;
        // Burn the nonce on any attempt by its owner, successful or not (single use); a refusal is
        // returned, not thrown, so the burn commits.
        if (row && row.user_id === userId && row.used_at === null) t.update(r('walletNonces', nonce), { used_at: nowMs });
        try {
          verify(record);
        } catch (e) {
          return e as DomainError;
        }
        if (owner && owner.user_id !== userId) return fail('CONFLICT_STATE', 'This wallet is already linked to another account.');
        // Relinking moves the address guard (row 13).
        if (current && current.address !== address) t.delete(r('walletAddresses', current.address));
        if (!owner) t.create(r('walletAddresses', address), { user_id: userId });
        t.set(r('walletLinks', userId), { user_id: userId, address, linked_at: iso(nowMs) });
        return null;
      });
    },

    async unlinkWallet(user) {
      if (!user.hasPassword && !(await core.hasRecoverableIdentity(user.id))) return false;
      await tx(async (t) => {
        const cur = data<{ address: string }>(await t.get(r('walletLinks', user.id)));
        if (!cur) return;
        const g = data<{ user_id: string }>(await t.get(r('walletAddresses', cur.address)));
        t.delete(r('walletLinks', user.id));
        if (g?.user_id === user.id) t.delete(r('walletAddresses', cur.address));
      });
      return true;
    },

    // ── Wallet login ──
    async createLoginChallenge(c) {
      const stale = await fs.collection(C.walletChallenges).where('expires_at', '<', c.nowMs - 3600_000).limit(PURGE_BATCH).get();
      if (!stale.empty) {
        const b = fs.batch();
        for (const d of stale.docs) b.delete(d.ref);
        await b.commit();
      }
      await r('walletChallenges', c.nonce).create({ nonce: c.nonce, address: c.address, input_json: c.inputJson, expires_at: c.expiresAtMs, used_at: null, created_at: c.nowMs } satisfies ChallengeDoc);
    },

    async walletLogin() {
      // Creating a wallet-only account needs the core domain's in-transaction user and identity
      // writes (users + userEmails + identities + userProviders); until those exist, Firestore
      // deployments refuse wallet sign-in (it is off by default).
      throw fail('FEATURE_UNAVAILABLE', 'Wallet sign-in isn’t available on this deployment yet.');
    },

    // ── Devnet demo transfers ──
    async createTransfer(row) {
      return tx(async (t) => {
        // Rule D: the same (deterministic) id again is the same transfer, returned as it is.
        const existing = data<TransferRow>(await t.get(r('devnetTransfers', row.id)));
        if (existing) return existing;
        const g = await t.claimGuard(r('openTransfers', row.participation_id), { transfer_id: row.id });
        if (!g.created) return null;
        const full: TransferRow = { ...row, signature: null, status: 'awaiting_signature', failure_reason: null, verified_at: null };
        t.create(r('devnetTransfers', row.id), full);
        return full;
      });
    },

    async transferById(id) {
      return data<TransferRow>(await r('devnetTransfers', id).get()) ?? null;
    },

    async builderTransfer(id, builderId) {
      const row = data<TransferRow>(await r('devnetTransfers', id).get());
      return row && row.builder_id === builderId ? row : null;
    },

    async transfersOf(participationId) {
      return all<TransferRow>((await fs.collection(C.devnetTransfers).where('participation_id', '==', participationId).get()).docs).sort((a, b) => byCreatedAsc(b, a));
    },

    async expireTransfer(id, reason) {
      return tx(async (t) => {
        const row = data<TransferRow>(await t.get(r('devnetTransfers', id)))!;
        const g = data<{ transfer_id: string }>(await t.get(r('openTransfers', row.participation_id)));
        if (row.status !== 'awaiting_signature') return row;
        const next: TransferRow = { ...row, status: 'expired', failure_reason: reason };
        t.update(r('devnetTransfers', id), { status: next.status, failure_reason: reason });
        releaseOpenTransfer(t, row, g);
        return next;
      });
    },

    async recordTransferVerdict(id, v) {
      return tx(async (t) => {
        const row = data<TransferRow>(await t.get(r('devnetTransfers', id)))!;
        const g = data<{ transfer_id: string }>(await t.get(r('openTransfers', row.participation_id)));
        if (row.status !== 'pending') return row;
        const next: TransferRow = { ...row, status: v.status, failure_reason: v.reason, verified_at: v.verifiedAt };
        t.update(r('devnetTransfers', id), { status: v.status, failure_reason: v.reason, verified_at: v.verifiedAt });
        if (v.status === 'failed' || v.status === 'expired') releaseOpenTransfer(t, row, g);
        return next;
      });
    },

    async attachTransferSignature(id, signature, expiresAt) {
      return tx(async (t) => {
        const row = data<TransferRow>(await t.get(r('devnetTransfers', id)))!;
        if (row.status !== 'awaiting_signature') return row;
        const g = await t.claimGuard(r('transferSignatures', signature), { transfer_id: id });
        if (!g.created && g.existing.transfer_id !== id) return null;
        t.update(r('devnetTransfers', id), { signature, status: 'pending', expires_at: expiresAt });
        return { ...row, signature, status: 'pending', expires_at: expiresAt };
      });
    },

    // ── Escrow ──
    async escrowOf(studyId) {
      const d = await escrowDoc(studyId);
      if (!d) return undefined;
      const { builder_id: _b, ...row } = d;
      return row;
    },

    async settlementById(id) {
      return (await settlementOf(id)) ?? null;
    },

    async payoutSettlementOf(participationId) {
      return viaGuard('settlementGuards', `payout:${participationId}`);
    },

    async setEscrowAccounts(studyId, multisig, vaultAuthority) {
      await r('studyEscrows', studyId).update({ multisig, vault_authority: vaultAuthority });
    },

    async openFunding({ studyId, user, nowMs, reference, ttlMs }) {
      return tx(async (t) => {
        const s = await studyInTx(t, fs, studyId);
        if (!s || s.builder_id !== user.id) throw notFound('Study');
        const esc = await escrowOfInTx(t, fs, s.id);
        if (s.payment_mode !== 'escrow' || !esc) throw fail('CONFLICT_STATE', 'This study is paid with test credits, not a wallet.');
        if (s.status !== 'draft') throw fail('CONFLICT_STATE', 'Fund a study before publishing it.');
        if (!(await walletAddressOfInTx(t, fs, user.id))) throw fail('CONFLICT_STATE', 'Link the wallet you’ll fund this study from first.');
        if (await isFundedInTx(t, fs, s.id)) throw fail('CONFLICT_STATE', 'This study is already funded.');
        // Rule G: one open request per study. The guard names the open request; it is replaced
        // (in this transaction) only once that request is no longer open.
        const guard = data<{ funding_id: string }>(await t.get(r('openFundings', s.id)));
        const open = guard ? data<FundingRow>(await t.get(r('escrowFundings', guard.funding_id))) : undefined;
        if (open && OPEN_FUNDING.includes(open.status) && open.expires_at > nowMs) return open;
        const refGuard = await t.claimGuard(r('fundingRefs', reference), { study_id: s.id });
        if (!refGuard.created) throw fail('CONFLICT_STATE', 'This funding reference is already used.');
        const f: FundingRow = {
          id: newId(),
          study_id: s.id,
          amount_units: quoteOf(s, esc).totalUnits,
          reference,
          status: 'awaiting_payment',
          signature: null,
          source: null,
          failure_reason: null,
          created_at: nowMs,
          expires_at: nowMs + ttlMs,
          confirmed_at: null,
        };
        t.create(r('escrowFundings', f.id), f);
        t.set(r('openFundings', s.id), { funding_id: f.id });
        return f;
      });
    },

    async fundingById(id) {
      return data<FundingRow>(await r('escrowFundings', id).get()) ?? null;
    },

    async fundingSignatureUsedElsewhere(signature, fundingId) {
      const g = data<{ funding_id: string }>(await r('fundingSignatures', signature).get());
      return !!g && g.funding_id !== fundingId;
    },

    async recordFundingVerdict({ fundingId, signature, verdict: v, source, nowMs, actorId, label }) {
      return tx(async (t) => {
        const cur = data<FundingRow>(await t.get(r('escrowFundings', fundingId)))!;
        if (cur.status === 'confirmed' || cur.status === 'failed' || cur.status === 'expired') return cur;
        if (cur.signature && cur.signature !== signature) throw fail('CONFLICT_STATE', 'This funding request already has a different transfer.');
        const sigGuard = data<{ funding_id: string }>(await t.get(r('fundingSignatures', signature)));
        if (sigGuard && sigGuard.funding_id !== fundingId) throw fail('CONFLICT_STATE', 'This transfer already funded another request.');
        const verdict = { ...v };
        // A refund needs somewhere to go: never confirm a transfer whose funding wallet is unknown.
        if (verdict.status === 'confirmed' && !source) {
          verdict.status = 'failed';
          verdict.reason = 'The transfer has no identifiable funding wallet, so a refund would have nowhere to go.';
        }
        const claimSignature = () => {
          if (!sigGuard) t.create(r('fundingSignatures', signature), { funding_id: fundingId }); // row 19
        };
        if (verdict.status === 'pending') {
          claimSignature();
          t.update(r('escrowFundings', fundingId), { status: 'pending', signature });
          return { ...cur, status: 'pending', signature };
        }
        if (verdict.status === 'failed') {
          claimSignature();
          t.update(r('escrowFundings', fundingId), { status: 'failed', signature, failure_reason: verdict.reason });
          return { ...cur, status: 'failed', signature, failure_reason: verdict.reason };
        }
        // Confirmed: credit the vault exactly once (rows 20, 21).
        const esc = (await escrowOfInTx(t, fs, cur.study_id))!;
        const books = await booksInTx(t, fs, cur.study_id);
        const study = (await studyInTx(t, fs, cur.study_id))!;
        if ((await t.get(r('escrowGuards', `confirmedFunding:${cur.study_id}`))).exists) throw fail('CONFLICT_STATE', 'This study is already funded.');
        const credited = await t.claimGuard(r('escrowGuards', `funding:${fundingId}`), { study_id: cur.study_id });
        if (!credited.created) throw fail('CONFLICT_STATE', 'This funding was already credited.');
        t.create(r('escrowGuards', `confirmedFunding:${cur.study_id}`), { funding_id: fundingId });
        claimSignature();
        t.update(r('escrowFundings', fundingId), { status: 'confirmed', signature, source, confirmed_at: nowMs });
        t.update(r('studyEscrows', cur.study_id), { funding_wallet: source });
        t.set(r('builderFundingWallets', `${study.builder_id}:${source}`), { builder_id: study.builder_id, wallet: source });
        const after = postInTx(t, fs, cur.study_id, books, planFunding({ studyId: cur.study_id, fundingId, amountUnits: cur.amount_units }), `funding:${fundingId}`, fundingId, nowMs);
        auditInTx(t, fs, { id: newId(), actor_id: actorId, action: 'escrow.funding_confirmed', target_type: 'study', target_id: cur.study_id, reason: `${cur.amount_units} units from ${source} (${label})`, created_at: iso(nowMs) });
        // A funding that lands after its study closed (its builder deleted the account while the
        // transfer was in flight) is refunded at once to the wallet it came from, by the arbiter.
        if (study.status === 'closed') await authorizeRefundInTx(t, fs, study, nowMs, actorId, 'arbiter', { esc: { ...esc, funding_wallet: source }, books: after });
        return { ...cur, status: 'confirmed', signature, source, confirmed_at: nowMs };
      });
    },

    async isFunded(studyId) {
      return (await r('escrowGuards', `confirmedFunding:${studyId}`).get()).exists;
    },

    async studyBooks(studyId, nowMs) {
      const [s, esc, books] = await Promise.all([studies.getStudy(studyId), escrowDoc(studyId), booksOf(studyId)]);
      // After close no participation holds funds (closing requires every hold to have settled).
      const holding = s!.status === 'closed' ? 0 : (await studies.participationStatuses(studyId)).filter((p) => holdsBudget(p, nowMs)).length;
      return booksFromTotals(studyId, books, quoteOf(s!, esc!), holding);
    },

    async refundOf(studyId) {
      const x = await viaGuard('settlementGuards', `refund:${studyId}`);
      return x ? { id: x.id, status: x.status, amount_units: x.amount_units } : null;
    },

    async payoutsOfTester(testerId) {
      return all<SettlementRow>((await fs.collection(C.settlements).where('tester_id', '==', testerId).get()).docs)
        .filter((x) => x.kind === 'payout')
        .sort((a, b) => byCreatedAsc(b, a));
    },

    async allPayouts() {
      return all<SettlementRow>((await fs.collection(C.settlements).where('kind', '==', 'payout').get()).docs).sort(
        (a, b) => Number(b.status === 'failed') - Number(a.status === 'failed') || byCreatedAsc(b, a),
      );
    },

    async studyTitle(studyId) {
      return (await studies.getStudy(studyId))!.title;
    },

    // ── Settlement worker ──
    async expireUnpaidFundings(nowMs) {
      const due = all<FundingRow>((await fs.collection(C.escrowFundings).where('status', '==', 'awaiting_payment').get()).docs).filter((f) => f.expires_at <= nowMs);
      for (const f of due) {
        await tx(async (t) => {
          const cur = data<FundingRow>(await t.get(r('escrowFundings', f.id)));
          if (cur?.status === 'awaiting_payment' && cur.expires_at <= nowMs) t.update(r('escrowFundings', f.id), { status: 'expired' });
        });
      }
    },

    async pendingFundings() {
      return all<FundingRow>((await fs.collection(C.escrowFundings).where('status', '==', 'pending').get()).docs);
    },

    async dueSettlements(nowMs) {
      return all<SettlementRow>((await fs.collection(C.settlements).where('status', 'in', ['pending', 'failed', 'submitted', 'awaiting_approval']).get()).docs)
        .filter((s) => s.status === 'pending' || (s.status === 'failed' && s.next_attempt_at <= nowMs) || (s.status === 'submitted' && s.signature === null) || s.status === 'awaiting_approval')
        .sort(byCreatedAsc);
    },

    async setInFlightStatus(id, status) {
      await tx(async (t) => {
        const cur = data<SettlementRow>(await t.get(r('settlements', id)));
        if (cur && (cur.status === 'submitted' || cur.status === 'awaiting_approval') && cur.status !== status) t.update(r('settlements', id), { status });
      });
    },

    async beginAttempt(id, key) {
      await tx(async (t) => {
        const cur = data<SettlementRow>(await t.get(r('settlements', id)))!;
        t.update(r('settlements', id), { status: 'submitted', attempt: cur.attempt + 1, attempt_key: key, signature: null, failure_reason: null });
      });
    },

    async recordSubmitSignature(id, signature) {
      await tx(async (t) => {
        const g = await t.claimGuard(r('settlementSignatures', signature), { settlement_id: id }); // row 28
        if (!g.created && g.existing.settlement_id !== id) throw fail('CONFLICT_STATE', 'This signature already settles another payment.');
        t.update(r('settlements', id), { signature });
      });
    },

    async recordAttemptFailure(s, reason, auditReason, nextAttemptAtMs, nowMs) {
      await tx(async (t) => {
        t.update(r('settlements', s.id), { status: 'failed', failure_reason: reason, next_attempt_at: nextAttemptAtMs });
        auditInTx(t, fs, { id: newId(), actor_id: 'system', action: `escrow.${s.kind}_failed`, target_type: s.kind === 'payout' ? 'participation' : 'study', target_id: s.participation_id ?? s.study_id, reason: auditReason, created_at: iso(nowMs) });
      });
    },

    async submittedSettlements() {
      return all<SettlementRow>((await fs.collection(C.settlements).where('status', '==', 'submitted').get()).docs).filter((s) => s.signature !== null);
    },

    async confirmSettlement(s, nowMs, label) {
      await tx(async (t) => {
        const cur = data<SettlementRow>(await t.get(r('settlements', s.id)))!;
        if (cur.status !== 'submitted') return;
        const key = s.kind === 'payout' ? `payoutSettled:${s.participation_id}` : `refundSettled:${s.study_id}`; // rows 23, 25
        const g = await t.claimGuard(r('escrowGuards', key), { settlement_id: s.id });
        if (!g.created) return;
        const books = await booksInTx(t, fs, s.study_id);
        transitionPayout('submitted', 'confirm');
        t.update(r('settlements', s.id), { status: 'confirmed', settled_at: nowMs });
        const postings =
          s.kind === 'payout'
            ? planSettlePayout({ studyId: s.study_id, participationId: s.participation_id!, testerId: s.tester_id!, amountUnits: s.amount_units })
            : planSettleRefund({ studyId: s.study_id, funder: s.destination, amountUnits: s.amount_units });
        postInTx(t, fs, s.study_id, books, postings, key, s.signature, nowMs);
        auditInTx(t, fs, {
          id: newId(),
          actor_id: 'system',
          action: `escrow.${s.kind}_settled`,
          target_type: s.kind === 'payout' ? 'participation' : 'study',
          target_id: s.participation_id ?? s.study_id,
          reason: `${s.amount_units} units to ${s.destination} (${label})`,
          created_at: iso(nowMs),
        });
      });
    },

    async markSettlementFailed(id, reason, nextAttemptAtMs) {
      await tx(async (t) => {
        const cur = data<SettlementRow>(await t.get(r('settlements', id)))!;
        if (cur.status === 'submitted') t.update(r('settlements', id), { status: 'failed', failure_reason: reason, next_attempt_at: nextAttemptAtMs });
      });
    },

    async escalations(minAttempts) {
      return all<SettlementRow>((await fs.collection(C.settlements).where('status', '==', 'failed').get()).docs)
        .filter((s) => s.attempt >= minAttempts)
        .map(({ id, kind, attempt, failure_reason }) => ({ id, kind, attempt, failure_reason }));
    },

    async inFlightUnits(studyId) {
      return all<SettlementRow>((await fs.collection(C.settlements).where('study_id', '==', studyId).get()).docs)
        .filter((s) => s.status === 'submitted' || s.status === 'failed')
        .reduce((sum, s) => sum + s.amount_units, 0);
    },

    async hasOpenFunding(studyId) {
      return all<FundingRow>((await fs.collection(C.escrowFundings).where('study_id', '==', studyId).get()).docs).some((f) => OPEN_FUNDING.includes(f.status));
    },

    async escrowStudiesWithMultisig(mode) {
      return all<StudyEscrowDoc>((await fs.collection(C.studyEscrows).where('settlement', '==', mode).get()).docs)
        .filter((e) => e.multisig !== null)
        .map((e) => e.study_id);
    },

    // ── Simulated chain ──
    async simRecordTransfer(row) {
      if (!row.idempotency_key) {
        await r('simChainTransfers', row.signature).create(row);
        return row.signature;
      }
      return tx(async (t) => {
        const g = await t.claimGuard(r('simIdempotency', row.idempotency_key!), { signature: row.signature }); // row 29
        if (!g.created) return g.existing.signature;
        t.create(r('simChainTransfers', row.signature), row);
        return row.signature;
      });
    },

    async simTransfer(signature) {
      return data<SimTransferRow>(await r('simChainTransfers', signature).get()) ?? null;
    },

    async simSignatureForKey(key) {
      return data<{ signature: string }>(await r('simIdempotency', key).get())?.signature ?? null;
    },

    async simFinalizeProcessing(signature) {
      await tx(async (t) => {
        const cur = data<SimTransferRow>(await t.get(r('simChainTransfers', signature)));
        if (cur?.status === 'processing') t.update(r('simChainTransfers', signature), { status: 'finalized' });
      });
    },

    async simTransfersOfKind(kind) {
      return all<SimTransferRow>((await fs.collection(C.simChainTransfers).where('kind', '==', kind).get()).docs);
    },

    async simFundingSignature(reference) {
      return all<SimTransferRow>((await fs.collection(C.simChainTransfers).where('reference', '==', reference).get()).docs).find((x) => x.kind === 'funding')?.signature ?? null;
    },

    // ── Reputation ──
    async reputationOf(userId, nowMs) {
      const [rows, work, profile] = await Promise.all([eventsOf(userId), decidedWork(userId), profileOf(userId)]);
      const rank = profile?.opted_in === 1 ? ((await leaderboard(nowMs)).find((x) => x.alias === profile.alias)?.rank ?? null) : null;
      const titles = new Map<string, string>();
      for (const pid of new Set(rows.map((e) => e.participation_id))) {
        const p = await studies.getParticipation(pid);
        titles.set(pid, (await studies.getStudy(p!.study_id))!.title);
      }
      return reputationFrom({ rows, work, profile, rank, titles, nowMs });
    },

    leaderboard,

    async putLeaderboard(userId, optIn, alias, nowMs) {
      await tx(async (t) => {
        const cur = data<ProfileDoc>(await t.get(r('leaderboardProfiles', userId)));
        const next = alias ?? cur?.alias ?? null;
        if (optIn && !next) throw fail('VALIDATION', 'Choose an alias to appear on the leaderboard.');
        const nextGuard = next ? data<{ user_id: string }>(await t.get(r('leaderboardAliases', aliasKey(next)))) : undefined;
        if (next && nextGuard && nextGuard.user_id !== userId) throw fail('CONFLICT_STATE', 'That alias is taken.');
        // Row 32: the guard is held while the profile's alias is that alias (opted in or not, as
        // SQLite's partial index `alias IS NOT NULL`); a rename moves it in this transaction.
        if (cur?.alias && (!next || aliasKey(cur.alias) !== aliasKey(next))) t.delete(r('leaderboardAliases', aliasKey(cur.alias)));
        if (next && !nextGuard) t.create(r('leaderboardAliases', aliasKey(next)), { user_id: userId });
        t.set(r('leaderboardProfiles', userId), { user_id: userId, opted_in: optIn ? 1 : 0, alias: next, updated_at: iso(nowMs) } satisfies ProfileDoc);
      });
    },

    async upholdFraud(participationId, reason, adminId, nowMs) {
      assertCleanCopy({ reason });
      await tx(async (t) => {
        const p = await participationInTx(t, fs, participationId);
        if (!p) throw notFound('Participation');
        const accepted = p.status === 'approved' || (p.status === 'resolved' && (await disputeOfInTx(t, fs, p.id))?.outcome === 'overturned');
        if (!accepted) throw fail('CONFLICT_STATE', 'Only accepted work can be marked fraudulent.');
        // One finding per participation; with the reversal guards (row 31), a retry can't reverse twice.
        if ((await t.get(r('fraudFindings', p.id))).exists) throw fail('CONFLICT_STATE', 'This work is already marked fraudulent.');
        const events = all<EventRow>((await t.query(fs.collection(C.pointsEvents).where('user_id', '==', p.tester_id))).docs).map(toEvent);
        t.create(r('fraudFindings', p.id), { participation_id: p.id, reason, decided_by: adminId, created_at: iso(nowMs) });
        appendPointsInTx(t, fs, p.tester_id, planReversal(events, p.id), nowMs);
        auditInTx(t, fs, { id: newId(), actor_id: adminId, action: 'reputation.fraud_upheld', target_type: 'participation', target_id: p.id, reason, created_at: iso(nowMs) });
      });
    },

    // ── Account export and deletion ──
    async exportUser(userId, nowMs) {
      // Payments: the user's received payouts, and the fundings, refunds and payouts of their studies.
      const ownEscrows = all<StudyEscrowDoc>((await fs.collection(C.studyEscrows).where('builder_id', '==', userId).get()).docs);
      const received = all<SettlementRow>((await fs.collection(C.settlements).where('tester_id', '==', userId).get()).docs)
        .filter((x) => x.kind === 'payout')
        .sort(byCreatedAsc);
      const escrows = new Map<string, StudyEscrowDoc>(ownEscrows.map((e) => [e.study_id, e]));
      for (const sid of new Set(received.map((x) => x.study_id))) if (!escrows.has(sid)) { const e = await escrowDoc(sid); if (e) escrows.set(sid, e); }
      const studyRows = new Map<string, StudyRow>();
      const studyOf = async (id: string) => studyRows.get(id) ?? (studyRows.set(id, (await studies.getStudy(id))!), studyRows.get(id)!);
      const fundings: FundingRow[] = [];
      const refunds: SettlementRow[] = [];
      const payouts: SettlementRow[] = [];
      for (const e of ownEscrows) {
        fundings.push(...all<FundingRow>((await fs.collection(C.escrowFundings).where('study_id', '==', e.study_id).get()).docs));
        for (const x of all<SettlementRow>((await fs.collection(C.settlements).where('study_id', '==', e.study_id).get()).docs)) (x.kind === 'refund' ? refunds : payouts).push(x);
      }
      const payments = paymentsExportFrom({
        received: await Promise.all(received.map(async (x) => ({ ...x, title: (await studyOf(x.study_id)).title }))),
        fundings: fundings.sort(byCreatedAsc),
        refunds: refunds.sort(byCreatedAsc),
        studyPayments: await Promise.all(
          payouts.sort(byCreatedAsc).map(async (x) => {
            const s = await studyOf(x.study_id);
            return { study_id: x.study_id, amount_units: x.amount_units, status: x.status, created_at: x.created_at, settled_at: x.settled_at, fee_bps: escrows.get(x.study_id)!.fee_bps, reward_credits: s.reward_credits, slots: s.slots };
          }),
        ),
        settlementOf: (sid) => escrows.get(sid)?.settlement ?? 'simulated',
      });
      // Reputation: own events, work, profile, and findings/flags on own participations.
      const pids = (await studies.listParticipationsByTester(userId)).map((p) => p.id);
      const own = async (c: 'fraudFindings' | 'pointsFlags'): Promise<OwnFinding[]> =>
        (pids.length ? await fs.getAll(...pids.map((id) => r(c, id))) : [])
          .filter((d) => d.exists)
          .map((d) => d.data() as { participation_id: string; reason: string; created_at: string })
          .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
          .map((f) => ({ participationId: f.participation_id, reason: f.reason, createdAt: f.created_at }));
      const reputation = reputationExportFrom({ rows: await eventsOf(userId), work: await decidedWork(userId), profile: await profileOf(userId), fraudFindings: await own('fraudFindings'), withheld: await own('pointsFlags'), nowMs });
      return { payments, reputation };
    },

    async purgeUser(userId, nowMs) {
      // Idempotent and bounded: every step re-reads what is left and deletes in transactions of at
      // most PURGE_BATCH documents (a few writes each), looping until nothing is left.
      // 1. Demo transfers (wallet addresses, no ledger value), with their guards.
      for (const field of ['builder_id', 'tester_id'] as const) {
        for (;;) {
          const batch = all<TransferRow>((await fs.collection(C.devnetTransfers).where(field, '==', userId).limit(PURGE_BATCH).get()).docs);
          if (batch.length === 0) break;
          await tx(async (t) => {
            const open = await t.getAll(...batch.map((x) => r('openTransfers', x.participation_id)));
            const sigs = await t.getAll(...batch.filter((x) => x.signature).map((x) => r('transferSignatures', x.signature!)));
            batch.forEach((x, i) => {
              t.delete(r('devnetTransfers', x.id));
              if ((open[i]!.data() as { transfer_id?: string } | undefined)?.transfer_id === x.id) t.delete(r('openTransfers', x.participation_id));
            });
            for (const g of sigs) if (g.exists && batch.some((x) => x.id === (g.data() as { transfer_id: string }).transfer_id)) t.delete(g.ref);
          });
        }
      }
      // 2. The wallet link (and its address guard) and link nonces.
      await tx(async (t) => {
        const link = data<{ address: string }>(await t.get(r('walletLinks', userId)));
        const g = link ? data<{ user_id: string }>(await t.get(r('walletAddresses', link.address))) : undefined;
        if (link) t.delete(r('walletLinks', userId));
        if (link && g?.user_id === userId) t.delete(r('walletAddresses', link.address));
      });
      for (;;) {
        const nonces = await fs.collection(C.walletNonces).where('user_id', '==', userId).limit(PURGE_BATCH).get();
        if (nonces.empty) break;
        const b = fs.batch();
        for (const d of nonces.docs) b.delete(d.ref);
        await b.commit();
      }
      // 3. Draft escrow studies close with the account (the studies purge, which runs after this,
      // closes their rows): unpaid fundings expire and the vault is set aside for refund (arbiter).
      for (const e of all<StudyEscrowDoc>((await fs.collection(C.studyEscrows).where('builder_id', '==', userId).get()).docs)) {
        const fundings = all<FundingRow>((await fs.collection(C.escrowFundings).where('study_id', '==', e.study_id).get()).docs).filter((f) => f.status === 'awaiting_payment');
        await tx(async (t) => {
          const s = await studyInTx(t, fs, e.study_id);
          if (!s || s.payment_mode !== 'escrow' || s.status !== 'draft') return;
          const cur = await t.getAll(...fundings.map((f) => r('escrowFundings', f.id)));
          await authorizeRefundInTx(t, fs, { ...s, status: 'closed' }, nowMs, userId, 'arbiter');
          for (const d of cur) if ((d.data() as FundingRow | undefined)?.status === 'awaiting_payment') t.update(d.ref, { status: 'expired' });
        });
      }
      // 4. The leaderboard pseudonym (and its alias guard); points stay append-only.
      await tx(async (t) => {
        const p = data<ProfileDoc>(await t.get(r('leaderboardProfiles', userId)));
        if (!p) return;
        const g = p.alias ? data<{ user_id: string }>(await t.get(r('leaderboardAliases', aliasKey(p.alias)))) : undefined;
        t.delete(r('leaderboardProfiles', userId));
        if (p.alias && g?.user_id === userId) t.delete(r('leaderboardAliases', aliasKey(p.alias)));
      });
      return { mediaKeys: [] };
    },
  };
}
