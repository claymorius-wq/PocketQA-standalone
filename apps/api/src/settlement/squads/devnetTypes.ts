import type { VersionedTransaction } from '@solana/web3.js';
import type { DevnetFundingTransaction, DevnetSettlementPlan, SettlementApproval, SettlementApprovalResult } from '@pocket-qa/contracts';
import type { FundingRow, SettlementRow } from '../../repo/escrow/types';
import type { SettlementProvider } from '../types';
import type { ParsedTokenTx } from '@pocket-qa/domain';
import type { ChainStatus, MemberState, MultisigState, ProposalState, VaultTransfer } from './chain';

/**
 * The devnet adapter's published seams (docs/reviews/devnet/pqa-be3-interfaces.md). pqa-be2's
 * independent fake implements `DevnetChain` from here, so a change to these types is a change to
 * that document, in the same commit.
 *
 * The server holds ONE key, the platform signer. It signs only `DevnetStep`s, and never casts the
 * first vote on a payment: the cosigner (the builder's wallet, or the arbiter's CLI) votes first.
 */

/** Every transaction the platform signer can sign, in the order a payment needs them. */
export type DevnetStep = 'multisig_create' | 'vault_ata_create' | 'dest_ata_create' | 'vault_tx_create' | 'proposal_create' | 'approve_platform' | 'execute';

/** What `prepare` needs for each step (all from the server's own state, CH-D3). */
export type DevnetStepInput =
  | { step: 'multisig_create'; studyId: string; multisig: string; members: MemberState[]; threshold: number }
  | { step: 'vault_ata_create' | 'dest_ata_create'; owner: string }
  | { step: 'vault_tx_create'; multisig: string; index: bigint; vaultAuthority: string; source: string; destination: string; amount: bigint; operation: string }
  | { step: 'proposal_create' | 'approve_platform' | 'execute'; multisig: string; index: bigint };

/**
 * A transaction signed by the platform signer and NOT yet broadcast. The receipt stores
 * `messageB64` and `signature` durably before `broadcast` (CH-D5); `wireB64` is the exact bytes
 * sent, so a re-broadcast of an unexpired transaction is the same transaction (same signature).
 * `estLamports`: the fee plus any rent this transaction pays, reserved against the spend caps.
 */
export type PreparedTx = {
  step: DevnetStep;
  messageB64: string;
  signature: string;
  wireB64: string;
  lastValidBlockHeight: number;
  estLamports: number;
};

/** An unsigned transaction for a wallet to sign (the cosigner pays its own fee). */
export type UnsignedTx = { messageB64: string; wireB64: string; lastValidBlockHeight: number };

export interface DevnetChain {
  /** Public keys only: no builder key exists on the server (the builder member is the study's linked wallet). */
  readonly roles: { platform: string; arbiter: string };
  genesisHash(): Promise<string>;
  /** The mint account as the RPC returns it: its own address, owning program and decimals (pqa-qa P2-DA2: all three are checked). */
  mintInfo(mint: string): Promise<{ address: string; owner: string; decimals: number } | null>;
  /** The study's Squads create key: derived from the platform signer (HMAC, own domain), so the server loads one key. */
  createKeyFor(studyId: string): string;
  programExecutable(): Promise<boolean>;
  memoProgramExecutable(): Promise<boolean>;
  /** sha256 of the Squads program-data account's bytes, re-read before and after live runs (CH-D6). */
  programDataHash(): Promise<string>;
  getMultisig(multisig: string): Promise<MultisigState | null>;
  tokenBalance(tokenAccount: string): Promise<bigint | null>;
  getVaultTransfer(multisig: string, index: bigint): Promise<VaultTransfer | null>;
  getProposal(multisig: string, index: bigint): Promise<ProposalState | null>;
  findExecuteSignature(multisig: string, index: bigint): Promise<string | null>;
  getParsedTransaction(signature: string): Promise<ParsedTokenTx | null>;
  signatureStatus(signature: string): Promise<ChainStatus>;
  /** The finalized block height: a prepared transaction can still land while lastValidBlockHeight >= it. */
  blockHeight(): Promise<number>;
  /** Builds and signs with the platform signer only. Never broadcasts. */
  prepare(input: DevnetStepInput): Promise<PreparedTx>;
  /** Sends exactly `p.wireB64`. Returns once the RPC accepted it (no wait for finality). */
  broadcast(p: PreparedTx): Promise<void>;
  /** An unsigned Squads proposal_approve for `member` (fee payer: the member), for a wallet or the arbiter CLI. */
  buildCosignerApprove(multisig: string, index: bigint, member: string): Promise<UnsignedTx>;
  /** An unsigned TransferChecked of the pinned mint from `from`'s token account to `vaultAta`, carrying `reference` (fee payer: `from`). */
  buildFundingTransfer(input: { from: string; vaultAta: string; amount: bigint; reference: string }): Promise<UnsignedTx>;
}

/**
 * What the devnet provider adds to `SettlementProvider` for the builder's wallet (the three devnet
 * routes). `builderWallet`: the requesting builder's linked wallet (the multisig's builder member).
 */
export interface DevnetSettlementOps {
  fundingTransaction(f: FundingRow, builderWallet: string): Promise<DevnetFundingTransaction>;
  approval(s: SettlementRow, builderWallet: string): Promise<SettlementApproval>;
  submitApproval(s: SettlementRow, body: { signature: string; txIndex: number; opId: string }, builderWallet: string): Promise<SettlementApprovalResult>;
  /** The operator's read-only plan of a payment (the arbiter CLI's inputs); 409 until it has a receipt. */
  operatorPlan(s: SettlementRow): Promise<DevnetSettlementPlan>;
  /** CH-D1: reserves the test USDC a funding request brings in, before the request exists (409 DEVNET_SPEND_CAP). */
  reserveFunding(input: { studyId: string; userId: string; amountUnits: number }): Promise<void>;
}
export const isDevnetSettlement = (p: SettlementProvider | null): p is SettlementProvider & DevnetSettlementOps =>
  !!p && typeof (p as Partial<DevnetSettlementOps>).approval === 'function' && typeof (p as Partial<DevnetSettlementOps>).fundingTransaction === 'function';

/** How a test or harness signs as the builder (the `bui…` fixture), standing in for Phantom or MWA. */
export interface BuilderWallet {
  publicKey: string;
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
}

/**
 * Spend caps (CH-D1), checked durably before any platform-signed broadcast.
 * - lamports (fees plus rent of platform-signed transactions) are reserved for a WHOLE operation
 *   when it starts, never per step (pqa-be2 P2: per-step reservations let concurrent payouts each
 *   take a first step and strand all of them half-created). A payment reserves
 *   `paymentLamports(destinationAtaMissing)` atomically when it claims its Squads index, and is
 *   refused up front (409 DEVNET_SPEND_CAP, nothing signed) if that doesn't fit. A study's vault
 *   reserves `VAULT_LAMPORTS` when the multisig is prepared. On finalize the reservation is trued up
 *   to what the landed transactions actually cost, releasing the remainder.
 * - usdcUnits: test USDC entering the system, reserved when a funding request is opened (the only
 *   way funds enter; payouts, refunds and the fee sweep move funds already reserved).
 * Reservations are guard docs (`devnetSpendReservations/{opKey}`), so a retried claim or a
 * re-broadcast never reserves twice; totals are read and written in the same transaction, so N
 * concurrent claims at the last unit of headroom give exactly one success.
 */
export type DevnetLimits = {
  global: { lamports: number; usdcUnits: number };
  perUser: { lamports: number; usdcUnits: number };
};

/** Contract bounds (devnet-phase-contract.md): 0.05 SOL fees+rent and 3 test USDC per run. */
export const DEFAULT_DEVNET_LIMITS: DevnetLimits = {
  global: { lamports: 50_000_000, usdcUnits: 3_000_000 },
  perUser: { lamports: 50_000_000, usdcUnits: 3_000_000 },
};

/**
 * Upper estimates of what each platform-signed step costs (fee plus the rent it pays), in
 * lamports. A payment (vault tx + proposal + approve + execute) is about 5.14M, as measured on the
 * pilot (amendments r1 CH-D1); a token account's rent is 2,039,280.
 */
export const STEP_LAMPORTS: Record<DevnetStep, number> = {
  multisig_create: 1_825_000,
  vault_ata_create: 2_044_280,
  dest_ata_create: 2_044_280,
  vault_tx_create: 3_005_000,
  proposal_create: 2_120_000,
  approve_platform: 5_000,
  execute: 10_000,
};
/** Rebuilds after an expired, unlanded broadcast cost nothing; a landed failure costs one fee: this covers a few. */
export const RETRY_MARGIN_LAMPORTS = 20_000;
export const paymentLamports = (destinationAtaMissing: boolean) =>
  STEP_LAMPORTS.vault_tx_create + STEP_LAMPORTS.proposal_create + STEP_LAMPORTS.approve_platform + STEP_LAMPORTS.execute + (destinationAtaMissing ? STEP_LAMPORTS.dest_ata_create : 0) + RETRY_MARGIN_LAMPORTS;
export const VAULT_LAMPORTS = STEP_LAMPORTS.multisig_create + STEP_LAMPORTS.vault_ata_create + RETRY_MARGIN_LAMPORTS;

/** A per-operation lease's life. Every write and every broadcast re-checks the fence first. */
export const DEVNET_OP_LEASE_MS = 30_000;

/** One platform-signed step as the receipt records it: message and signature stored BEFORE broadcast (CH-D5). */
export type ReceiptStep = {
  message_b64: string;
  /** The exact signed bytes (public: a signed transaction holds no secret), re-broadcast unchanged while unexpired. */
  wire_b64: string;
  signature: string;
  last_valid_block_height: number;
  est_lamports: number;
  status: 'prepared' | 'sent' | 'finalized' | 'failed';
  slot: number | null;
  fee_lamports: number | null;
};

export type ReceiptState = 'claimed' | 'created' | 'proposed' | 'awaiting_cosigner' | 'approved' | 'executed' | 'finalized' | 'refused';

/**
 * The receipt of one payment (payout, refund or fee sweep): `squadsAttempts/{settlementId}` in the
 * devnet namespace. Written before the first broadcast; every later write is fenced by `lease`.
 */
export type DevnetReceipt = {
  settlement_id: string;
  kind: 'payout' | 'refund' | 'fee';
  study_id: string;
  participation_id: string | null;
  /** The user whose spend cap the payment counts against (the study's builder). */
  uid: string;
  op_id: string;
  multisig: string;
  vault_authority: string;
  vault_ata: string;
  destination: string;
  destination_ata: string;
  amount_units: number;
  cosigner: 'builder' | 'arbiter';
  cosigner_key: string;
  /** Claimed index; guard `squadsTx/{multisig}:{index}` (R2 row 33). */
  tx_index: number;
  /** Lamports reserved for the whole payment (`paymentLamports`), trued up on finalize. */
  reserved_lamports: number;
  steps: Partial<Record<DevnetStep, ReceiptStep>>;
  state: ReceiptState;
  /** Why the payment stopped for an operator (state 'refused'), from a fresh chain read; never a guess. */
  refusal: string | null;
  lease: { holder: string; fence: number; until: number } | null;
  created_at: number;
  updated_at: number;
};

/** A study vault's preparation (multisig + vault token account): `devnetVaults/{studyId}` in the namespace. */
export type VaultReceipt = {
  study_id: string;
  uid: string;
  multisig: string;
  vault_authority: string;
  vault_ata: string;
  builder_wallet: string;
  /** The pinned platform fee wallet (POCKETQA_DEVNET_FEE_WALLET): where the study's earned fees are swept on close. */
  fee_wallet: string;
  reserved_lamports: number;
  steps: Partial<Record<DevnetStep, ReceiptStep>>;
  state: 'claimed' | 'ready' | 'refused';
  refusal: string | null;
  lease: { holder: string; fence: number; until: number } | null;
  created_at: number;
  updated_at: number;
};

export type ReceiptKind = 'payment' | 'vault';
export type PaymentDraft = Omit<DevnetReceipt, 'tx_index' | 'steps' | 'state' | 'refusal' | 'lease' | 'created_at' | 'updated_at'>;
export type VaultDraft = Omit<VaultReceipt, 'steps' | 'state' | 'refusal' | 'lease' | 'created_at' | 'updated_at'>;

/**
 * Durable devnet state (Firestore, devnet namespace): receipts, per-operation leases with fencing,
 * Squads index claims and spend reservations. Every method is one Firestore transaction.
 */
export interface DevnetStore {
  receipt(settlementId: string): Promise<DevnetReceipt | null>;
  vault(studyId: string): Promise<VaultReceipt | null>;
  /**
   * Creates the payment's receipt (state 'claimed') with its Squads index (guard squadsTx, row 33)
   * and reserves its WHOLE lamport cost, all or nothing. An existing receipt is returned as it is.
   * `adoptIndex`: an index found on chain carrying this op id (adopted, never re-created).
   */
  claimPayment(draft: PaymentDraft, chainIndex: number, adoptIndex: number | null, limits: DevnetLimits, nowMs: number): Promise<{ receipt: DevnetReceipt } | { cap: string }>;
  claimVault(draft: VaultDraft, limits: DevnetLimits, nowMs: number): Promise<{ vault: VaultReceipt } | { cap: string }>;
  /** Takes the operation's lease if free or expired: its new fence, or null if held. */
  acquire(kind: ReceiptKind, id: string, holder: string, nowMs: number): Promise<number | null>;
  /**
   * Immediately before a broadcast (CH-D5, pqa-be2 flag 1): refuses unless the fence still holds,
   * and stores the step's serialised message and signature. False: fenced out, do not broadcast.
   */
  beforeBroadcast(kind: ReceiptKind, id: string, fence: number, step: DevnetStep, rec: ReceiptStep, nowMs: number): Promise<boolean>;
  /** A fenced update of steps, state or refusal. False: fenced out, nothing written. */
  patch(kind: ReceiptKind, id: string, fence: number, p: { steps?: Partial<Record<DevnetStep, ReceiptStep>>; state?: string; refusal?: string | null }, nowMs: number): Promise<boolean>;
  release(kind: ReceiptKind, id: string, fence: number): Promise<void>;
  /** The payment holding Squads index `index` of `multisig`, or null (never claimed, or released). */
  indexOwner(multisig: string, index: number): Promise<string | null>;
  /**
   * pqa-qa P3-F4: a payment that stopped before its vault transaction was ever sent gives its index
   * back (guard deleted, tx_index 0), so later payments are not blocked by a gap. False if a vault
   * transaction was recorded (it might still land) or the fence is lost.
   */
  releaseIndex(settlementId: string, fence: number, nowMs: number): Promise<boolean>;
  /** Moves the payment to index `index` (free, or already its own): the index, or null if another payment holds it. */
  reclaimIndex(settlementId: string, fence: number, index: number, nowMs: number): Promise<number | null>;
  /** Sets a reservation to what was actually spent, releasing the rest. */
  trueUp(opKey: string, actualLamports: number): Promise<void>;
  /** Reserves test-USDC units entering the system (a funding request), once per op key. */
  reserveUsdc(opKey: string, uid: string, units: number, limits: DevnetLimits): Promise<boolean>;
}
