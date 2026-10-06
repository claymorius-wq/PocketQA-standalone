import type { DevnetTransfer, Reputation } from '@pocket-qa/contracts';
import type { DomainError, LoginChallengeRecord, NonceRecord } from '@pocket-qa/domain';
import type { UserRow } from '../../views/core';

/**
 * Escrow repository (owner: pqa-be3, see ../index.ts): wallet links and nonces, wallet login,
 * devnet demo transfers, escrow, settlements and reputation. Intent-level async operations only;
 * rows keep today's SQLite shapes so views and contracts don't change.
 *
 * Every operation that SQLite runs as one transaction is one transaction here (and one `runTx`
 * in Firestore). Network calls (RPC, settlement provider) never happen inside an operation: the
 * caller does them before or after, and passes in what it learned (a verdict, a signature).
 */

/** A user's linked devnet wallet (`wallet_links`; Firestore `walletLinks/{userId}`). */
export type WalletLink = { address: string; linkedAt: string };

export type TransferRow = {
  id: string;
  participation_id: string;
  builder_id: string;
  tester_id: string;
  sender: string;
  recipient: string;
  lamports: number;
  signature: string | null;
  status: DevnetTransfer['status'];
  failure_reason: string | null;
  created_at: string;
  expires_at: string;
  verified_at: string | null;
};

export type EscrowRow = { study_id: string; settlement: 'simulated' | 'squads_devnet'; network: string; mint: string; vault: string; fee_bps: number; funding_wallet: string | null; created_at: string; multisig: string | null; vault_authority: string | null };

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
  /** Who co-signs with the Pocket QA release key (Squads pilot): the builder, or the arbiter. */
  cosigner: 'builder' | 'arbiter';
};

/** The escrow books of a study and its invariant (ADR 0007 §5), as `escrowInvariant` returns them. */
export type EscrowBooks = ReturnType<typeof import('@pocket-qa/domain').escrowInvariant>;

/** One transfer on the SIMULATED chain (ADR 0007 §4): no network, no asset, no value. */
export type SimTransferRow = {
  signature: string;
  network: string;
  mint: string;
  source: string;
  destination: string;
  amount_units: number;
  reference: string;
  kind: 'funding' | 'payout' | 'refund' | 'other';
  status: 'processing' | 'finalized' | 'failed';
  idempotency_key: string | null;
  block_time_ms: number;
};

/** What a funding transfer's verification concluded (computed outside the transaction). */
export type FundingVerdict = { status: 'pending' | 'confirmed' | 'failed'; reason: string | null };

export interface EscrowRepo {
  // ── Wallet links (T8) ──────────────────────────────────────────────────────────────────────
  /** The user's linked wallet, or null. Read by the core `userView`. */
  walletLinkOf(userId: string): Promise<WalletLink | null>;
  /** Stores a single-use SIWS link nonce. */
  createLinkNonce(n: { nonce: string; userId: string; address: string; inputJson: string; expiresAtMs: number }): Promise<void>;
  /**
   * Links `address` to the user in one transaction: burns the nonce on ANY attempt by its owner
   * (single use, committed even when verification fails), runs `verify` (pure: signature and
   * record checks, throws a DomainError), refuses an address linked to another account, then
   * upserts the user's link (the address may change: Firestore moves `walletAddresses/{address}`).
   * Returns the refusal instead of throwing, so the burn is committed.
   */
  linkWallet(input: { userId: string; address: string; nonce: string; nowMs: number; verify: (record: NonceRecord | null) => void }): Promise<DomainError | null>;
  /**
   * Removes the user's link, unless it is their only way in: no password and no recovery
   * identity (ADR 0005 §2). Returns false when refused.
   */
  unlinkWallet(user: { id: string; hasPassword: boolean }): Promise<boolean>;

  // ── Wallet login (T8) ──────────────────────────────────────────────────────────────────────
  /** Stores a login challenge (and prunes challenges expired over an hour ago). */
  createLoginChallenge(c: { nonce: string; address: string; inputJson: string; expiresAtMs: number; nowMs: number }): Promise<void>;
  /**
   * One transaction: burns the challenge on any attempt, runs `verify` (pure), resolves the wallet
   * to its linked active account (admins refused), or creates a wallet-only account when
   * `newAccount` is given. `firebase`: also ensures the account's Firebase subject identity.
   */
  walletLogin(input: {
    address: string;
    nonce: string;
    nowMs: number;
    verify: (record: LoginChallengeRecord | null) => void;
    newAccount: { id: string; displayName: string; role: UserRow['role'] } | null;
    firebase: boolean;
  }): Promise<{ error: DomainError } | { user: UserRow; subject: string | null }>;

  // ── Devnet demo transfers ──────────────────────────────────────────────────────────────────
  /**
   * Inserts an `awaiting_signature` transfer; null if the participation already has an open one.
   * An existing transfer with this id (a rule D retry) is returned unchanged.
   */
  createTransfer(row: Omit<TransferRow, 'signature' | 'status' | 'failure_reason' | 'verified_at'>): Promise<TransferRow | null>;
  transferById(id: string): Promise<TransferRow | null>;
  /** The transfer if `builderId` created it, else null. */
  builderTransfer(id: string, builderId: string): Promise<TransferRow | null>;
  /** A participation's transfers, newest first. */
  transfersOf(participationId: string): Promise<TransferRow[]>;
  /** `awaiting_signature` → `expired` (releases the open-transfer guard). */
  expireTransfer(id: string, reason: string): Promise<TransferRow>;
  /** A final chain verdict on a pending transfer (`failed` releases the open-transfer guard). */
  recordTransferVerdict(id: string, v: { status: TransferRow['status']; reason: string | null; verifiedAt: string | null }): Promise<TransferRow>;
  /**
   * `awaiting_signature` → `pending` with this signature; null when the signature is already used
   * by another transfer.
   */
  attachTransferSignature(id: string, signature: string, expiresAt: string): Promise<TransferRow | null>;

  // ── Escrow (T9) ────────────────────────────────────────────────────────────────────────────
  escrowOf(studyId: string): Promise<EscrowRow | undefined>;
  /** The participation's payout settlement, if one was authorized. */
  payoutSettlementOf(participationId: string): Promise<SettlementRow | undefined>;
  /** Records the study's on-chain escrow accounts (Squads pilot; after `prepareVault`). */
  setEscrowAccounts(studyId: string, multisig: string, vaultAuthority: string): Promise<void>;
  /**
   * The builder's open funding request for a draft escrow study, reused if one is open, else a new
   * one carrying `reference` and the study's quote total. Throws today's refusals.
   */
  openFunding(input: { studyId: string; user: UserRow; nowMs: number; reference: string; ttlMs: number }): Promise<FundingRow>;
  fundingById(id: string): Promise<FundingRow | null>;
  /** Is this transfer signature already recorded on another funding request? */
  fundingSignatureUsedElsewhere(signature: string, fundingId: string): Promise<boolean>;
  /**
   * Records a funding verdict once (one transaction): confirmed credits the vault exactly once,
   * sets the funding wallet, audits, and refunds at once if the study already closed.
   * `source`: the observed funding wallet (null when none). `label`: settlement copy for the audit.
   */
  recordFundingVerdict(input: { fundingId: string; signature: string; verdict: FundingVerdict; source: string | null; nowMs: number; actorId: string; label: string }): Promise<FundingRow>;
  isFunded(studyId: string): Promise<boolean>;
  /** The study's escrow books and invariant. */
  studyBooks(studyId: string, nowMs: number): Promise<EscrowBooks>;
  refundOf(studyId: string): Promise<Pick<SettlementRow, 'status' | 'amount_units'> | null>;
  payoutsOfTester(testerId: string): Promise<SettlementRow[]>;
  /** Every payout, failed first (operations view). */
  allPayouts(): Promise<SettlementRow[]>;
  /** Cross-domain read for payout views (studies owner: pqa-be1). */
  studyTitle(studyId: string): Promise<string>;

  // ── Settlement worker (T9) ─────────────────────────────────────────────────────────────────
  expireUnpaidFundings(nowMs: number): Promise<void>;
  pendingFundings(): Promise<FundingRow[]>;
  /** Pending, retry-due failed, and submitted-without-signature settlements, oldest first. */
  dueSettlements(nowMs: number): Promise<SettlementRow[]>;
  /** Persists a new attempt (`submitted`, attempt+1, key) BEFORE anything is sent. */
  beginAttempt(id: string, key: string): Promise<void>;
  recordSubmitSignature(id: string, signature: string): Promise<void>;
  /** A definitive refusal: `failed` with its retry time, audited. */
  recordAttemptFailure(s: SettlementRow, reason: string, auditReason: string, nextAttemptAtMs: number, nowMs: number): Promise<void>;
  submittedSettlements(): Promise<SettlementRow[]>;
  /** `submitted` → `confirmed` once, with its settle postings and audit (one transaction). */
  confirmSettlement(s: SettlementRow, nowMs: number, label: string): Promise<void>;
  /** `submitted` → `failed` (network failure), retried later. */
  markSettlementFailed(id: string, reason: string, nextAttemptAtMs: number): Promise<void>;
  /** Failed settlements with at least `minAttempts` attempts. */
  escalations(minAttempts: number): Promise<Pick<SettlementRow, 'id' | 'kind' | 'attempt' | 'failure_reason'>[]>;
  /** Units in settlements not yet confirmed (`submitted` or `failed`). */
  inFlightUnits(studyId: string): Promise<number>;
  hasOpenFunding(studyId: string): Promise<boolean>;
  /** Studies whose escrow of this settlement kind has an on-chain multisig. */
  escrowStudiesWithMultisig(mode: EscrowRow['settlement']): Promise<string[]>;

  // ── Simulated chain (settlement/simulated.ts; hosted runs simulated settlement only) ──────────
  /**
   * Records a simulated transfer. With an idempotency key already used (row 29), nothing is
   * written and the existing transfer's signature is returned.
   */
  simRecordTransfer(row: SimTransferRow): Promise<string>;
  simTransfer(signature: string): Promise<SimTransferRow | null>;
  simSignatureForKey(key: string): Promise<string | null>;
  /** A held (`processing`) transfer finalizes: a late confirmation. */
  simFinalizeProcessing(signature: string): Promise<void>;
  /** The simulated funding transfer already sent for this funding reference, if any. */
  simFundingSignature(reference: string): Promise<string | null>;

  // ── Reputation (T10) ───────────────────────────────────────────────────────────────────────
  reputationOf(userId: string, nowMs: number): Promise<Reputation>;
  leaderboard(nowMs: number): Promise<ReturnType<typeof import('@pocket-qa/domain').rankLeaderboard>>;
  /** Opt in with a pseudonym (unique, case-insensitive), or opt out (the alias is kept). */
  putLeaderboard(userId: string, optIn: boolean, alias: string | undefined, nowMs: number): Promise<void>;
  /** An admin upholds a fraud finding on accepted work: points reversed (append-only), audited. */
  upholdFraud(participationId: string, reason: string, adminId: string, nowMs: number): Promise<void>;

  // ── Account export and deletion (called by the lead's handlers/account.ts) ──────────────────
  /** This domain's part of the user's own data export (least data). */
  exportUser(userId: string, nowMs: number): Promise<{ payments: PaymentsExport; reputation: ReputationExport }>;
  /**
   * This domain's part of account deletion: devnet transfers, wallet link and nonces deleted; the
   * builder's draft escrow studies' unpaid fundings expire and their vaults are set aside for
   * refund (arbiter); the leaderboard profile (and alias) removed. Points and escrow postings stay
   * (append-only). Idempotent. SQLite: runs inside the CALLER's transaction (opens none), and must
   * run BEFORE the studies purge closes the draft study rows.
   */
  purgeUser(userId: string, nowMs: number): Promise<{ mediaKeys: string[] }>;
}

export type PaymentsExport = ReturnType<typeof import('../../escrow').paymentsExport>;
export type ReputationExport = ReturnType<typeof import('../../reputation').reputationExport>;
