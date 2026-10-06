import type { VersionedTransaction } from '@solana/web3.js';
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
  | { step: 'multisig_create'; createKeySeed: Uint8Array; multisig: string; members: MemberState[]; threshold: number }
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
  mintInfo(mint: string): Promise<{ owner: string; decimals: number } | null>;
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

/** How a test or harness signs as the builder (the `bui…` fixture), standing in for Phantom or MWA. */
export interface BuilderWallet {
  publicKey: string;
  signTransaction(tx: VersionedTransaction): Promise<VersionedTransaction>;
}

/**
 * Spend caps (CH-D1), checked durably before every platform-signed broadcast.
 * - lamports: fees plus rent of platform-signed transactions (the `estLamports` of each), reserved
 *   once per transaction signature; a rebuilt transaction releases its expired predecessor's
 *   reservation in the same Firestore transaction.
 * - usdcUnits: test USDC entering the system, reserved when a funding request is opened (the only
 *   way funds enter; payouts and refunds move funds already reserved).
 * A reservation that would exceed a cap is refused before signing (409 DEVNET_SPEND_CAP).
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
