import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  unpackAccount,
} from '@solana/spl-token';
import { Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount, type TokenBalance } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import type { ParsedTokenTx } from '@pocket-qa/domain';
import { SettlementFailure } from '../types';
import type { ChainStatus, MemberState, MultisigState, ProposalStatus, Role, SquadsChain, VaultTransfer } from './chain';
import { BPF_LOADER_2, BPF_UPGRADEABLE_LOADER, DEVNET_GENESIS, MEMO_PROGRAM, PILOT_DECIMALS, PILOT_MINT, SQUADS_PROGRAM, SQUADS_PROGRAM_DATA } from './pins';

/** The public devnet RPC (authorized for this pilot only); there is no override. */
export const DEVNET_RPC = 'https://api.devnet.solana.com';
const MINT = new PublicKey(PILOT_MINT);
const PROGRAM = new PublicKey(SQUADS_PROGRAM);
const EXECUTE_DISCRIMINATOR = Buffer.from(multisig.generated.vaultTransactionExecuteInstructionDiscriminator);

export type SentStep = { step: string; signature: string; slot: number; feeLamports: number | null };

/**
 * Loads the pilot TEST keys from a directory outside the repository (mode 0700, files 0600, the
 * Solana CLI 64-byte JSON format). Key material is never logged or returned; only public keys
 * leave this module.
 */
export function loadPilotKeys(dir: string): { signers: Record<Role, Keypair>; createSeed: Uint8Array } {
  if ((statSync(dir).mode & 0o077) !== 0) throw new Error('The pilot keys directory must be mode 0700.');
  const file = (name: string) => {
    const p = join(dir, name);
    if ((statSync(p).mode & 0o077) !== 0) throw new Error(`The pilot key file ${name} must be mode 0600.`);
    return readFileSync(p);
  };
  const kp = (name: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(file(name).toString('utf8')) as number[]));
  const createSeed = new Uint8Array(file('create-seed.bin'));
  if (createSeed.length !== 32) throw new Error('create-seed.bin must hold 32 bytes.');
  return { signers: { builder: kp('builder.json'), pocketqa: kp('pocketqa.json'), arbiter: kp('arbiter.json') }, createSeed };
}

/**
 * The SquadsChain over a devnet RPC. Every send re-checks the genesis hash right before signing,
 * pays fees from the Pocket QA test key, and returns only once the transaction is `finalized`
 * (an error if it failed). Reads are all at `finalized`.
 */
export class RpcSquadsChain implements SquadsChain {
  readonly roles: Record<Role, string>;

  constructor(
    private readonly conn: Connection,
    private readonly signers: Record<Role, Keypair>,
    /** Receipt hook: every landed step with its slot and fee (no secrets). */
    private readonly onSent: (s: SentStep) => void = () => {},
  ) {
    this.roles = { builder: signers.builder.publicKey.toBase58(), pocketqa: signers.pocketqa.publicKey.toBase58(), arbiter: signers.arbiter.publicKey.toBase58() };
  }

  static devnet(signers: Record<Role, Keypair>, onSent?: (s: SentStep) => void) {
    return new RpcSquadsChain(new Connection(DEVNET_RPC, 'finalized'), signers, onSent);
  }

  private get payer() {
    return this.signers.pocketqa;
  }

  async genesisHash() {
    return this.conn.getGenesisHash();
  }

  async mintInfo(mint: string) {
    const info = await this.conn.getAccountInfo(new PublicKey(mint), 'finalized');
    if (!info) return null;
    // SPL Mint layout: COption<authority> (36) + supply (8), then decimals (u8) at offset 44.
    return { owner: info.owner.toBase58(), decimals: info.data.length >= 82 ? info.data[44]! : -1 };
  }

  async programExecutable() {
    const info = await this.conn.getAccountInfo(PROGRAM, 'finalized');
    if (!info || !info.executable || info.owner.toBase58() !== BPF_UPGRADEABLE_LOADER || info.data.length < 36) return false;
    // UpgradeableLoaderState::Program { programdata_address }: tag 2 (u32), then the address.
    return info.data.readUInt32LE(0) === 2 && new PublicKey(info.data.subarray(4, 36)).toBase58() === SQUADS_PROGRAM_DATA;
  }

  async memoProgramExecutable() {
    const info = await this.conn.getAccountInfo(new PublicKey(MEMO_PROGRAM), 'finalized');
    return !!info && info.executable && info.owner.toBase58() === BPF_LOADER_2;
  }

  async getMultisig(ms: string): Promise<MultisigState | null> {
    const info = await this.conn.getAccountInfo(new PublicKey(ms), 'finalized');
    if (!info) return null;
    if (!info.owner.equals(PROGRAM)) throw new Error('The multisig account is not owned by the Squads program.');
    const [m] = multisig.accounts.Multisig.fromAccountInfo(info);
    return {
      createKey: m.createKey.toBase58(),
      configAuthority: m.configAuthority.toBase58(),
      threshold: m.threshold,
      timeLock: m.timeLock,
      transactionIndex: BigInt(m.transactionIndex.toString()),
      rentCollector: m.rentCollector ? m.rentCollector.toBase58() : null,
      members: m.members.map((x) => ({ key: x.key.toBase58(), mask: x.permissions.mask })),
    };
  }

  async createMultisig(input: { createKeySeed: Uint8Array; multisig: string; members: MemberState[]; threshold: number; rentCollector: string | null }) {
    const createKey = Keypair.fromSeed(input.createKeySeed);
    const [configPda] = multisig.getProgramConfigPda({});
    const config = await multisig.accounts.ProgramConfig.fromAccountAddress(this.conn, configPda, 'finalized');
    if (BigInt(config.multisigCreationFee.toString()) !== 0n) throw new SettlementFailure('Refused before signing: the devnet Squads creation fee is not zero.');
    const ix = multisig.instructions.multisigCreateV2({
      treasury: config.treasury,
      creator: this.payer.publicKey,
      multisigPda: new PublicKey(input.multisig),
      configAuthority: null,
      threshold: input.threshold,
      members: input.members.map((m) => ({ key: new PublicKey(m.key), permissions: { mask: m.mask } as never })),
      timeLock: 0,
      createKey: createKey.publicKey,
      rentCollector: input.rentCollector === null ? null : new PublicKey(input.rentCollector),
    });
    return this.send('multisig_create', [ix], [createKey]);
  }

  async ensureAta(owner: string) {
    const ownerKey = new PublicKey(owner);
    const ata = getAssociatedTokenAddressSync(MINT, ownerKey, true);
    if (await this.conn.getAccountInfo(ata, 'finalized')) return null;
    return this.send(`token_account_create:${owner}`, [createAssociatedTokenAccountIdempotentInstruction(this.payer.publicKey, ata, ownerKey, MINT)], []);
  }

  async tokenBalance(account: string) {
    const key = new PublicKey(account);
    const info = await this.conn.getAccountInfo(key, 'finalized');
    if (!info) return null;
    const acc = unpackAccount(key, info, TOKEN_PROGRAM_ID);
    if (!acc.mint.equals(MINT)) throw new Error('The token account holds a different mint.');
    return acc.amount;
  }

  async getVaultTransfer(ms: string, index: bigint): Promise<VaultTransfer | null> {
    const [pda] = multisig.getTransactionPda({ multisigPda: new PublicKey(ms), index });
    const info = await this.conn.getAccountInfo(pda, 'finalized');
    if (!info) return null;
    let vt: multisig.accounts.VaultTransaction;
    try {
      if (!info.owner.equals(PROGRAM)) throw new Error('not a Squads account');
      [vt] = multisig.accounts.VaultTransaction.fromAccountInfo(info);
    } catch {
      // Something other than a vault transaction at this index (e.g. a config transaction): it can
      // never match a plan, and nothing is created over it.
      return { creator: '', operation: null, instructions: -1, program: '', opcode: -1, source: '', mint: '', destination: '', authority: '', amount: -1n, decimals: -1 };
    }
    const msg = vt.message;
    const [first, second] = msg.instructions;
    const key = (i: number) => msg.accountKeys[i]?.toBase58() ?? '';
    const data = Buffer.from(first?.data ?? []);
    const accounts = Array.from(first?.accountIndexes ?? []).map(key);
    // Lookup tables, or anything but 4 accounts and 10 data bytes, can't be the planned TransferChecked.
    const shapeOk = msg.addressTableLookups.length === 0 && accounts.length === 4 && data.length === 10;
    // The operation id: the second instruction must be the pinned Memo with no accounts and UTF-8 data.
    let operation: string | null = null;
    if (second && key(second.programIdIndex) === MEMO_PROGRAM && second.accountIndexes.length === 0) {
      try {
        operation = new TextDecoder('utf-8', { fatal: true }).decode(second.data);
      } catch {
        operation = null;
      }
    }
    return {
      creator: vt.creator.toBase58(),
      operation,
      instructions: shapeOk ? msg.instructions.length : -1,
      program: first ? key(first.programIdIndex) : '',
      opcode: shapeOk ? data[0]! : -1,
      source: accounts[0] ?? '',
      mint: accounts[1] ?? '',
      destination: accounts[2] ?? '',
      authority: accounts[3] ?? '',
      amount: shapeOk ? data.readBigUInt64LE(1) : -1n,
      decimals: shapeOk ? data[9]! : -1,
    };
  }

  async createVaultTransfer(input: { multisig: string; index: bigint; vaultAuthority: string; source: string; destination: string; amount: bigint; operation: string }) {
    const vault = new PublicKey(input.vaultAuthority);
    const { blockhash } = await this.conn.getLatestBlockhash('finalized');
    const transactionMessage = new TransactionMessage({
      payerKey: vault,
      recentBlockhash: blockhash, // not used by Squads; the vault signs by CPI at execution
      instructions: [
        createTransferCheckedInstruction(new PublicKey(input.source), MINT, new PublicKey(input.destination), vault, input.amount, PILOT_DECIMALS, [], TOKEN_PROGRAM_ID),
        // The operation id, stored immutably in the vault transaction (no accounts: nobody's signature is claimed).
        new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), keys: [], data: Buffer.from(input.operation, 'utf8') }),
      ],
    });
    const ix = multisig.instructions.vaultTransactionCreate({
      multisigPda: new PublicKey(input.multisig),
      transactionIndex: input.index,
      creator: this.payer.publicKey,
      rentPayer: this.payer.publicKey,
      vaultIndex: 0,
      ephemeralSigners: 0,
      transactionMessage,
    });
    return this.send(`vault_transaction_create:${input.index}`, [ix], []);
  }

  async getProposal(ms: string, index: bigint) {
    const [pda] = multisig.getProposalPda({ multisigPda: new PublicKey(ms), transactionIndex: index });
    const info = await this.conn.getAccountInfo(pda, 'finalized');
    if (!info) return null;
    const [p] = multisig.accounts.Proposal.fromAccountInfo(info);
    return { status: p.status.__kind as ProposalStatus, approved: p.approved.map((k) => k.toBase58()) };
  }

  async createProposal(ms: string, index: bigint) {
    const ix = multisig.instructions.proposalCreate({ multisigPda: new PublicKey(ms), creator: this.payer.publicKey, rentPayer: this.payer.publicKey, transactionIndex: index });
    return this.send(`proposal_create:${index}`, [ix], []);
  }

  async approve(ms: string, index: bigint, role: Role) {
    const member = this.signers[role];
    const ix = multisig.instructions.proposalApprove({ multisigPda: new PublicKey(ms), transactionIndex: index, member: member.publicKey });
    return this.send(`proposal_approve:${index}:${role}`, [ix], [member]);
  }

  async execute(ms: string, index: bigint) {
    const { instruction, lookupTableAccounts } = await multisig.instructions.vaultTransactionExecute({
      connection: this.conn,
      multisigPda: new PublicKey(ms),
      transactionIndex: index,
      member: this.payer.publicKey,
    });
    return this.send(`vault_transaction_execute:${index}`, [instruction], [], lookupTableAccounts);
  }

  async findExecuteSignature(ms: string, index: bigint) {
    const [pda] = multisig.getTransactionPda({ multisigPda: new PublicKey(ms), index });
    for (const s of await this.conn.getSignaturesForAddress(pda, { limit: 50 }, 'finalized')) {
      if (s.err) continue;
      const tx = await this.conn.getTransaction(s.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
      if (!tx || tx.meta?.err) continue;
      const keys = tx.transaction.message.staticAccountKeys;
      const hit = tx.transaction.message.compiledInstructions.some(
        (ix) => keys[ix.programIdIndex]?.equals(PROGRAM) && Buffer.from(ix.data).subarray(0, 8).equals(EXECUTE_DISCRIMINATOR),
      );
      if (hit) return s.signature;
    }
    return null;
  }

  async getParsedTransaction(signature: string): Promise<ParsedTokenTx | null> {
    const tx = await this.conn.getParsedTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!tx) return null;
    const bal = (list: TokenBalance[] | null | undefined) =>
      (list ?? []).map((b) => ({ accountIndex: b.accountIndex, mint: b.mint, owner: b.owner, programId: b.programId, uiTokenAmount: { amount: b.uiTokenAmount.amount, decimals: b.uiTokenAmount.decimals } }));
    return {
      blockTime: tx.blockTime ?? null,
      meta: tx.meta ? { err: tx.meta.err, preTokenBalances: bal(tx.meta.preTokenBalances), postTokenBalances: bal(tx.meta.postTokenBalances) } : null,
      transaction: { message: { accountKeys: tx.transaction.message.accountKeys.map((k) => ({ pubkey: k.pubkey.toBase58() })) } },
    };
  }

  async signatureStatus(signature: string): Promise<ChainStatus> {
    const { value } = await this.conn.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const v = value[0];
    if (!v) return 'not_found';
    if (v.err) return 'failed';
    return v.confirmationStatus === 'finalized' ? 'finalized' : 'processing';
  }

  /**
   * Signs and sends one transaction (fee payer: Pocket QA) after re-checking the genesis, and
   * waits for `finalized`. A thrown error before `sendTransaction` means nothing was sent.
   */
  private async send(step: string, ixs: TransactionInstruction[], extraSigners: Keypair[], luts: AddressLookupTableAccount[] = []) {
    if ((await this.conn.getGenesisHash()) !== DEVNET_GENESIS) throw new SettlementFailure('Refused before signing this step: the RPC is not Solana devnet (genesis hash mismatch).');
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash('finalized');
    const message = new TransactionMessage({ payerKey: this.payer.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(luts);
    const tx = new VersionedTransaction(message);
    const signers = [this.payer, ...extraSigners.filter((k) => !k.publicKey.equals(this.payer.publicKey))];
    tx.sign(signers);
    const signature = await this.conn.sendTransaction(tx, { preflightCommitment: 'confirmed', maxRetries: 5 });
    const res = await this.conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'finalized');
    if (res.value.err) throw new Error(`${step} failed on devnet: ${JSON.stringify(res.value.err)} (${signature})`);
    const landed = await this.conn.getTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    this.onSent({ step, signature, slot: landed?.slot ?? res.context.slot, feeLamports: landed?.meta?.fee ?? null });
    return signature;
  }
}
