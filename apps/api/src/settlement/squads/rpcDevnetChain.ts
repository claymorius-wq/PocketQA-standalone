import { createHash, createHmac } from 'node:crypto';
import { base58 } from '@scure/base';
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, unpackAccount } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction, type AddressLookupTableAccount, type TokenBalance } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import type { ParsedTokenTx } from '@pocket-qa/domain';
import { SettlementFailure, SettlementPending } from '../types';
import type { ChainStatus, MultisigState, ProposalStatus, VaultTransfer } from './chain';
import { STEP_LAMPORTS, type DevnetChain, type DevnetStepInput, type PreparedTx, type UnsignedTx } from './devnetTypes';
import { buildApproveTx, buildFundingTx } from './walletTx';
import { BPF_LOADER_2, BPF_UPGRADEABLE_LOADER, DEVNET_GENESIS, MEMO_PROGRAM, PILOT_DECIMALS, PILOT_MINT, SQUADS_PROGRAM, SQUADS_PROGRAM_DATA } from './pins';

/**
 * The DevnetChain over a devnet RPC (POCKETQA_ENV=devnet; pqa-qa N-1). It holds ONE key, the
 * platform signer: `roles.platform` is that key's public key, and it is the only key that ever signs
 * here (plus each study's derived create key, for the one multisig_create). There is no builder or
 * arbiter key and no path that could sign for them: their votes are wallet-signed transactions this
 * class only BUILDS, unsigned.
 *
 * One Connection for everything (genesis, blockhash, reads, sends); reads are at `finalized`.
 * `prepare` signs without sending; `broadcast` sends the exact bytes and returns at once (no wait
 * for finality: the adapter's next run reads the signature's status). The read and decode logic is
 * the pilot's (rpcChain.ts, tested on devnet), copied so this module has no access to the pilot's
 * three-key send path.
 */
const MINT = new PublicKey(PILOT_MINT);
const PROGRAM = new PublicKey(SQUADS_PROGRAM);
const EXECUTE_DISCRIMINATOR = Buffer.from(multisig.generated.vaultTransactionExecuteInstructionDiscriminator);
const CREATE_KEY_DOMAIN = 'pocketqa/devnet/create-key/v1/';

/**
 * What a finalized transaction cost the platform as its fee payer (account 0): pre minus post
 * balance, i.e. fee + rent; null if it isn't finalized yet or someone else paid.
 */
async function platformCost(conn: Connection, signature: string, platform: PublicKey) {
  const tx = await conn.getTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
  if (!tx?.meta) return null;
  if (!tx.transaction.message.staticAccountKeys[0]?.equals(platform)) return null;
  return { lamports: tx.meta.preBalances[0]! - tx.meta.postBalances[0]!, slot: tx.slot };
}

/**
 * Read-only cost lookups with the platform's PUBLIC key only (pqa-qa P3-SR1): what the spend report
 * needs, without ever loading the platform secret.
 */
export function rpcCostReader(conn: Connection | string, platformPubkey: string) {
  const c = typeof conn === 'string' ? new Connection(conn, 'finalized') : conn;
  const platform = new PublicKey(platformPubkey);
  return { costOf: (signature: string) => platformCost(c, signature, platform) };
}

export class RpcDevnetChain implements DevnetChain {
  readonly roles: { platform: string; arbiter: string };

  constructor(
    private readonly conn: Connection,
    private readonly platform: Keypair,
    arbiter: string,
  ) {
    this.roles = { platform: platform.publicKey.toBase58(), arbiter };
  }

  /** The production connection: one Connection to the configured devnet RPC, finalized commitment. */
  static connect(rpcUrl: string, platform: Keypair, arbiter: string) {
    return new RpcDevnetChain(new Connection(rpcUrl, 'finalized'), platform, arbiter);
  }

  private createKey(studyId: string) {
    // The seed derives from the platform secret (domain-separated), so the server loads one key.
    return Keypair.fromSeed(createHmac('sha256', this.platform.secretKey).update(CREATE_KEY_DOMAIN + studyId).digest());
  }
  createKeyFor(studyId: string) {
    return this.createKey(studyId).publicKey.toBase58();
  }

  // ── reads (finalized) ────────────────────────────────────────────────────────────────────────

  async genesisHash() {
    return this.conn.getGenesisHash();
  }

  async mintInfo(mint: string) {
    const info = await this.conn.getAccountInfo(new PublicKey(mint), 'finalized');
    if (!info) return null;
    // SPL Mint layout: COption<authority> (36) + supply (8), then decimals (u8) at offset 44.
    return { address: mint, owner: info.owner.toBase58(), decimals: info.data.length >= 82 ? info.data[44]! : -1 };
  }

  async programExecutable() {
    const info = await this.conn.getAccountInfo(PROGRAM, 'finalized');
    if (!info || !info.executable || info.owner.toBase58() !== BPF_UPGRADEABLE_LOADER || info.data.length < 36) return false;
    return info.data.readUInt32LE(0) === 2 && new PublicKey(info.data.subarray(4, 36)).toBase58() === SQUADS_PROGRAM_DATA;
  }

  async memoProgramExecutable() {
    const info = await this.conn.getAccountInfo(new PublicKey(MEMO_PROGRAM), 'finalized');
    return !!info && info.executable && info.owner.toBase58() === BPF_LOADER_2;
  }

  /** CH-D6: the Squads program-data account's bytes, hashed (re-read before and after live runs). */
  async programDataHash() {
    const info = await this.conn.getAccountInfo(new PublicKey(SQUADS_PROGRAM_DATA), 'finalized');
    return info ? createHash('sha256').update(info.data).digest('hex') : '';
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
      return { creator: '', operation: null, instructions: -1, program: '', opcode: -1, source: '', mint: '', destination: '', authority: '', amount: -1n, decimals: -1 };
    }
    const msg = vt.message;
    const [first, second] = msg.instructions;
    const key = (i: number) => msg.accountKeys[i]?.toBase58() ?? '';
    const data = Buffer.from(first?.data ?? []);
    const accounts = Array.from(first?.accountIndexes ?? []).map(key);
    const shapeOk = msg.addressTableLookups.length === 0 && accounts.length === 4 && data.length === 10;
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

  async getProposal(ms: string, index: bigint) {
    const [pda] = multisig.getProposalPda({ multisigPda: new PublicKey(ms), transactionIndex: index });
    const info = await this.conn.getAccountInfo(pda, 'finalized');
    if (!info) return null;
    const [p] = multisig.accounts.Proposal.fromAccountInfo(info);
    return { status: p.status.__kind as ProposalStatus, approved: p.approved.map((k) => k.toBase58()) };
  }

  async findExecuteSignature(ms: string, index: bigint) {
    const [pda] = multisig.getTransactionPda({ multisigPda: new PublicKey(ms), index });
    for (const s of await this.conn.getSignaturesForAddress(pda, { limit: 50 }, 'finalized')) {
      if (s.err) continue;
      const tx = await this.conn.getTransaction(s.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
      if (!tx || tx.meta?.err) continue;
      const keys = tx.transaction.message.staticAccountKeys;
      const hit = tx.transaction.message.compiledInstructions.some((ix) => keys[ix.programIdIndex]?.equals(PROGRAM) && Buffer.from(ix.data).subarray(0, 8).equals(EXECUTE_DISCRIMINATOR));
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

  async costOf(signature: string) {
    return platformCost(this.conn, signature, this.platform.publicKey);
  }

  async blockHeight() {
    return this.conn.getBlockHeight('finalized');
  }

  // ── the platform signer: sign without sending; send exact bytes ─────────────────────────────

  private async instructions(input: DevnetStepInput): Promise<{ ixs: TransactionInstruction[]; extra: Keypair[]; luts: AddressLookupTableAccount[] }> {
    const payer = this.platform.publicKey;
    switch (input.step) {
      case 'multisig_create': {
        const createKey = this.createKey(input.studyId);
        const [configPda] = multisig.getProgramConfigPda({});
        const config = await multisig.accounts.ProgramConfig.fromAccountAddress(this.conn, configPda, 'finalized');
        if (BigInt(config.multisigCreationFee.toString()) !== 0n) throw new SettlementFailure('Refused before signing: the devnet Squads creation fee is not zero.');
        const ix = multisig.instructions.multisigCreateV2({
          treasury: config.treasury,
          creator: payer,
          multisigPda: new PublicKey(input.multisig),
          configAuthority: null,
          threshold: input.threshold,
          members: input.members.map((m) => ({ key: new PublicKey(m.key), permissions: { mask: m.mask } as never })),
          timeLock: 0,
          createKey: createKey.publicKey,
          rentCollector: null,
        });
        return { ixs: [ix], extra: [createKey], luts: [] };
      }
      case 'vault_ata_create':
      case 'dest_ata_create': {
        const owner = new PublicKey(input.owner);
        const ata = getAssociatedTokenAddressSync(MINT, owner, true);
        return { ixs: [createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, MINT)], extra: [], luts: [] };
      }
      case 'vault_tx_create': {
        const vault = new PublicKey(input.vaultAuthority);
        const { blockhash } = await this.conn.getLatestBlockhash('finalized');
        const transactionMessage = new TransactionMessage({
          payerKey: vault,
          recentBlockhash: blockhash, // not used by Squads; the vault signs by CPI at execution
          instructions: [
            createTransferCheckedInstruction(new PublicKey(input.source), MINT, new PublicKey(input.destination), vault, input.amount, PILOT_DECIMALS, [], TOKEN_PROGRAM_ID),
            new TransactionInstruction({ programId: new PublicKey(MEMO_PROGRAM), keys: [], data: Buffer.from(input.operation, 'utf8') }),
          ],
        });
        const ix = multisig.instructions.vaultTransactionCreate({ multisigPda: new PublicKey(input.multisig), transactionIndex: input.index, creator: payer, rentPayer: payer, vaultIndex: 0, ephemeralSigners: 0, transactionMessage });
        return { ixs: [ix], extra: [], luts: [] };
      }
      case 'proposal_create':
        return { ixs: [multisig.instructions.proposalCreate({ multisigPda: new PublicKey(input.multisig), creator: payer, rentPayer: payer, transactionIndex: input.index })], extra: [], luts: [] };
      case 'approve_platform':
        // The platform's own vote only: `member` is always the platform key.
        return { ixs: [multisig.instructions.proposalApprove({ multisigPda: new PublicKey(input.multisig), transactionIndex: input.index, member: payer })], extra: [], luts: [] };
      case 'execute': {
        const { instruction, lookupTableAccounts } = await multisig.instructions.vaultTransactionExecute({ connection: this.conn, multisigPda: new PublicKey(input.multisig), transactionIndex: input.index, member: payer });
        return { ixs: [instruction], extra: [], luts: lookupTableAccounts };
      }
    }
  }

  async prepare(input: DevnetStepInput): Promise<PreparedTx> {
    if ((await this.conn.getGenesisHash()) !== DEVNET_GENESIS) throw new SettlementFailure('Refused before signing this step: the RPC is not Solana devnet (genesis hash mismatch).');
    const { ixs, extra, luts } = await this.instructions(input);
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash('finalized');
    const message = new TransactionMessage({ payerKey: this.platform.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message(luts);
    const tx = new VersionedTransaction(message);
    tx.sign([this.platform, ...extra]);
    return {
      step: input.step,
      messageB64: Buffer.from(tx.message.serialize()).toString('base64'),
      signature: base58.encode(tx.signatures[0]!),
      wireB64: Buffer.from(tx.serialize()).toString('base64'),
      lastValidBlockHeight,
      estLamports: STEP_LAMPORTS[input.step],
    };
  }

  async broadcast(p: PreparedTx) {
    try {
      await this.conn.sendRawTransaction(Buffer.from(p.wireB64, 'base64'), { skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 0 });
    } catch (e) {
      // Not accepted (preflight, rate limit, already processed): the next run reads the signature's
      // status and decides (same bytes again while unexpired, rebuild only once strictly expired).
      throw new SettlementPending(`${p.step} broadcast not accepted: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  // ── wallet-signed transactions, built unsigned ───────────────────────────────────────────────

  private async blockhash() {
    const { blockhash, lastValidBlockHeight } = await this.conn.getLatestBlockhash('finalized');
    return { recentBlockhash: blockhash, lastValidBlockHeight };
  }

  // The wallet's transactions: the pure builders (walletTx.ts), shared with the test fake, over this RPC's blockhash.
  async buildCosignerApprove(ms: string, index: bigint, member: string): Promise<UnsignedTx> {
    return buildApproveTx({ multisig: ms, index, member, ...(await this.blockhash()) });
  }

  async buildFundingTransfer(input: { from: string; vaultAta: string; amount: bigint; reference: string }): Promise<UnsignedTx> {
    return buildFundingTx({ ...input, ...(await this.blockhash()) });
  }
}
