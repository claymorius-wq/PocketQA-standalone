import type { ParsedTokenTx } from '@pocket-qa/domain';

/**
 * What the Squads pilot adapter needs from the network. `rpcChain.ts` implements it with
 * @solana/web3.js and @sqds/multisig against a genesis-checked devnet RPC; tests use an in-memory
 * fake. Every read is at `finalized` commitment, and every send waits for `finalized` before it
 * returns, so the adapter's recovery reads never see a state the cluster could still drop.
 *
 * The signing keys are pilot TEST keys held by the implementation: they simulate every role
 * (builder, Pocket QA, arbiter). Nothing here is independent custody.
 */
export type Role = 'builder' | 'pocketqa' | 'arbiter';
export type MemberState = { key: string; mask: number };
export type MultisigState = {
  createKey: string;
  configAuthority: string;
  threshold: number;
  timeLock: number;
  transactionIndex: bigint;
  rentCollector: string | null;
  members: MemberState[];
};
/**
 * A vault transaction as the program stored it (immutable once created), decoded: its creator,
 * the count of instructions, the first one's program, SPL tag, accounts and arguments, and the
 * operation id carried by the second one. The adapter approves only exactly
 * [TransferChecked(plan), Memo(operation id)], created by Pocket QA. `operation` is null unless the
 * second instruction is a pinned-Memo instruction with no accounts and UTF-8 data.
 */
export type VaultTransfer = {
  creator: string;
  operation: string | null;
  instructions: number;
  program: string;
  opcode: number;
  source: string;
  mint: string;
  destination: string;
  authority: string;
  amount: bigint;
  decimals: number;
};
export type ProposalStatus = 'Draft' | 'Active' | 'Rejected' | 'Approved' | 'Executing' | 'Executed' | 'Cancelled';
export type ProposalState = { status: ProposalStatus; approved: string[] };
export type ChainStatus = 'processing' | 'finalized' | 'failed' | 'not_found';

export interface SquadsChain {
  /** Public keys of the pilot test keys. */
  readonly roles: Record<Role, string>;
  genesisHash(): Promise<string>;
  /** The mint's owning program and decimals, or null if the account doesn't exist. */
  mintInfo(mint: string): Promise<{ owner: string; decimals: number } | null>;
  /** The Squads program is the executable upgradeable-loader program at the pinned address. */
  programExecutable(): Promise<boolean>;
  /** The pinned SPL Memo program is executable under the (immutable) BPF loader 2. */
  memoProgramExecutable(): Promise<boolean>;
  getMultisig(multisig: string): Promise<MultisigState | null>;
  createMultisig(input: { createKeySeed: Uint8Array; multisig: string; members: MemberState[]; threshold: number; rentCollector: string | null }): Promise<string>;
  /** Creates the owner's associated token account for the pilot mint if missing (Pocket QA pays); returns the signature or null if it existed. */
  ensureAta(owner: string): Promise<string | null>;
  /** A token account's balance in base units, or null if it doesn't exist. */
  tokenBalance(tokenAccount: string): Promise<bigint | null>;
  getVaultTransfer(multisig: string, index: bigint): Promise<VaultTransfer | null>;
  createVaultTransfer(input: { multisig: string; index: bigint; vaultAuthority: string; source: string; destination: string; amount: bigint; operation: string }): Promise<string>;
  getProposal(multisig: string, index: bigint): Promise<ProposalState | null>;
  createProposal(multisig: string, index: bigint): Promise<string>;
  approve(multisig: string, index: bigint, role: Role): Promise<string>;
  /** Executes an approved vault transaction (Pocket QA, the only Execute member). */
  execute(multisig: string, index: bigint): Promise<string>;
  /** The signature of the successful execute of this vault transaction, found on chain, or null. */
  findExecuteSignature(multisig: string, index: bigint): Promise<string | null>;
  /** A transaction at finalized commitment in jsonParsed shape, or null if not finalized (yet). */
  getParsedTransaction(signature: string): Promise<ParsedTokenTx | null>;
  signatureStatus(signature: string): Promise<ChainStatus>;
}
