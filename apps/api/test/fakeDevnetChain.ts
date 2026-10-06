import { createHash, randomBytes } from 'node:crypto';
import { base58 } from '@scure/base';
import { Keypair } from '@solana/web3.js';
import type { ParsedTokenTx } from '@pocket-qa/domain';
import { ataOf } from '../src/settlement/squads/adapter';
import type { ChainStatus, MultisigState, ProposalState, VaultTransfer } from '../src/settlement/squads/chain';
import { STEP_LAMPORTS, type DevnetChain, type DevnetStep, type DevnetStepInput, type PreparedTx, type UnsignedTx } from '../src/settlement/squads/devnetTypes';
import { AUTONOMOUS, DEVNET_GENESIS, PERM, PILOT_DECIMALS, PILOT_MINT, PILOT_TOKEN_PROGRAM, TRANSFER_CHECKED } from '../src/settlement/squads/pins';

/**
 * An in-memory Squads devnet behind the DevnetChain seam (prepare = sign without sending;
 * broadcast = send exact bytes). It enforces what the program enforces: the next index only, votes
 * only from Vote members on an Active proposal, execution once and only at the threshold. Faults:
 *  - dropNext: the next broadcasts never land (the RPC accepted them, the cluster dropped them);
 *  - lag: a landed transaction stays `processing` until `finalizeAll()`;
 *  - crashAfter: throw right after a step landed (the process "dies");
 *  - onBroadcast: a hook that runs before a transaction lands (e.g. to read the receipt);
 *  - pins: genesis, the mint account, program flags.
 * `prepared` counts every platform signature; `landed` every transaction that took effect.
 */
export class FakeDevnetChain implements DevnetChain {
  readonly platformKp = Keypair.generate();
  readonly arbiterKp = Keypair.generate();
  readonly roles = { platform: this.platformKp.publicKey.toBase58(), arbiter: this.arbiterKp.publicKey.toBase58() };

  genesis = DEVNET_GENESIS;
  mintAccount: { address: string; owner: string; decimals: number } | null = { address: PILOT_MINT, owner: PILOT_TOKEN_PROGRAM, decimals: PILOT_DECIMALS };
  programOk = true;
  memoOk = true;
  programData = 'program-data-v1';
  height = 1_000;

  multisigs = new Map<string, MultisigState>();
  vaultTxs = new Map<string, VaultTransfer>();
  proposals = new Map<string, ProposalState & { executeSig?: string }>();
  balances = new Map<string, number>();
  atas = new Set<string>();

  prepared: { step: DevnetStep; signature: string }[] = [];
  broadcasts: { step: DevnetStep; signature: string }[] = [];
  landed: { step: DevnetStep | 'cosigner_approve' | 'funding'; signature: string }[] = [];
  /** Unsigned transactions built for a wallet (the builder's or the arbiter CLI's). */
  built: ('approve' | 'funding')[] = [];
  dropNext = 0;
  lag = false;
  crashAfter: DevnetStep | null = null;
  onBroadcast: ((p: PreparedTx) => Promise<void>) | null = null;
  private statuses = new Map<string, ChainStatus>();
  private effects = new Map<string, () => void>();
  private txs = new Map<string, ParsedTokenTx>();
  private k = (ms: string, i: bigint) => `${ms}:${i}`;
  private sig = () => base58.encode(randomBytes(64));

  executes(ms?: string) {
    return this.landed.filter((l) => l.step === 'execute' && (!ms || true)).length;
  }
  fundVault(ata: string, units: number) {
    this.atas.add(ata);
    this.balances.set(ata, (this.balances.get(ata) ?? 0) + units);
  }
  finalizeAll() {
    for (const [s, st] of this.statuses) if (st === 'processing') this.statuses.set(s, 'finalized');
  }

  createKeyFor(studyId: string) {
    return Keypair.fromSeed(createHash('sha256').update(`fake-create-key/${studyId}`).digest()).publicKey.toBase58();
  }

  // ── reads ──
  async genesisHash() {
    return this.genesis;
  }
  async mintInfo(mint: string) {
    return mint === PILOT_MINT ? this.mintAccount : null;
  }
  async programExecutable() {
    return this.programOk;
  }
  async memoProgramExecutable() {
    return this.memoOk;
  }
  async programDataHash() {
    return createHash('sha256').update(this.programData).digest('hex');
  }
  async getMultisig(ms: string) {
    const m = this.multisigs.get(ms);
    return m ? { ...m, members: [...m.members] } : null;
  }
  async tokenBalance(account: string) {
    return this.atas.has(account) ? BigInt(this.balances.get(account) ?? 0) : null;
  }
  async getVaultTransfer(ms: string, index: bigint) {
    return this.vaultTxs.get(this.k(ms, index)) ?? null;
  }
  async getProposal(ms: string, index: bigint) {
    const p = this.proposals.get(this.k(ms, index));
    return p ? { status: p.status, approved: [...p.approved] } : null;
  }
  async findExecuteSignature(ms: string, index: bigint) {
    return this.proposals.get(this.k(ms, index))?.executeSig ?? null;
  }
  async getParsedTransaction(signature: string) {
    return this.txs.get(signature) ?? null;
  }
  async signatureStatus(signature: string) {
    return this.statuses.get(signature) ?? 'not_found';
  }
  async blockHeight() {
    return this.height;
  }

  // ── the platform signer: sign without sending, then send exact bytes ──
  async prepare(input: DevnetStepInput): Promise<PreparedTx> {
    const signature = this.sig();
    this.prepared.push({ step: input.step, signature });
    this.effects.set(signature, () => this.apply(input, signature));
    const wire = Buffer.from(JSON.stringify({ step: input.step, signature })).toString('base64');
    return { step: input.step, messageB64: Buffer.from(`msg:${signature}`).toString('base64'), signature, wireB64: wire, lastValidBlockHeight: this.height + 150, estLamports: STEP_LAMPORTS[input.step] };
  }

  async broadcast(p: PreparedTx) {
    this.broadcasts.push({ step: p.step, signature: p.signature });
    if (this.statuses.has(p.signature)) return; // the same bytes again: the same transaction
    if (this.dropNext > 0) {
      this.dropNext -= 1;
      return;
    }
    if (this.height > p.lastValidBlockHeight) return; // expired: it can no longer land
    if (this.onBroadcast) await this.onBroadcast(p);
    const effect = this.effects.get(p.signature);
    if (!effect) throw new Error('unknown transaction bytes');
    try {
      effect();
      this.statuses.set(p.signature, this.lag ? 'processing' : 'finalized');
      this.landed.push({ step: p.step, signature: p.signature });
    } catch {
      this.statuses.set(p.signature, 'failed'); // landed, and the program refused it (fee paid)
    }
    if (this.crashAfter === p.step) {
      this.crashAfter = null;
      throw new Error(`simulated crash after ${p.step} landed`);
    }
  }

  private apply(input: DevnetStepInput, signature: string) {
    switch (input.step) {
      case 'multisig_create': {
        if (this.multisigs.has(input.multisig)) throw new Error('account already in use');
        this.multisigs.set(input.multisig, { createKey: this.createKeyFor(input.studyId), configAuthority: AUTONOMOUS, threshold: input.threshold, timeLock: 0, transactionIndex: 0n, rentCollector: null, members: [...input.members] });
        return;
      }
      case 'vault_ata_create':
      case 'dest_ata_create':
        this.atas.add(ataOf(input.owner));
        return;
      case 'vault_tx_create': {
        const ms = this.multisigs.get(input.multisig);
        if (!ms || input.index !== ms.transactionIndex + 1n) throw new Error('InvalidTransactionIndex');
        ms.transactionIndex = input.index;
        this.vaultTxs.set(this.k(input.multisig, input.index), {
          creator: this.roles.platform,
          operation: input.operation,
          instructions: 2,
          program: PILOT_TOKEN_PROGRAM,
          opcode: TRANSFER_CHECKED,
          source: input.source,
          mint: PILOT_MINT,
          destination: input.destination,
          authority: input.vaultAuthority,
          amount: input.amount,
          decimals: PILOT_DECIMALS,
        });
        return;
      }
      case 'proposal_create': {
        const key = this.k(input.multisig, input.index);
        if (!this.vaultTxs.has(key) || this.proposals.has(key)) throw new Error('cannot create proposal');
        this.proposals.set(key, { status: 'Active', approved: [] });
        return;
      }
      case 'approve_platform':
        this.vote(input.multisig, input.index, this.roles.platform);
        return;
      case 'execute': {
        const key = this.k(input.multisig, input.index);
        const p = this.proposals.get(key);
        if (!p || p.status !== 'Approved') throw new Error('InvalidProposalStatus');
        const vt = this.vaultTxs.get(key)!;
        const from = this.balances.get(vt.source) ?? 0;
        if (!this.atas.has(vt.destination) || from < Number(vt.amount)) throw new Error('insufficient funds or no token account');
        this.balances.set(vt.source, from - Number(vt.amount));
        this.balances.set(vt.destination, (this.balances.get(vt.destination) ?? 0) + Number(vt.amount));
        p.status = 'Executed';
        p.executeSig = signature;
        return;
      }
    }
  }

  private vote(ms: string, index: bigint, member: string) {
    const m = this.multisigs.get(ms)!;
    const p = this.proposals.get(this.k(ms, index));
    const mem = m.members.find((x) => x.key === member);
    if (!mem || !(mem.mask & PERM.vote)) throw new Error('NotAMember');
    if (!p || p.status !== 'Active') throw new Error('InvalidProposalStatus');
    if (p.approved.includes(member)) throw new Error('AlreadyApproved');
    p.approved.push(member);
    if (p.approved.length >= m.threshold) p.status = 'Approved';
  }

  // ── wallet-signed transactions (the builder's wallet, the arbiter CLI) ──
  async buildCosignerApprove(multisig: string, index: bigint, member: string): Promise<UnsignedTx> {
    this.built.push('approve');
    const wire = Buffer.from(JSON.stringify({ kind: 'approve', multisig, index: String(index), member })).toString('base64');
    return { messageB64: wire, wireB64: wire, lastValidBlockHeight: this.height + 150 };
  }
  async buildFundingTransfer(input: { from: string; vaultAta: string; amount: bigint; reference: string }): Promise<UnsignedTx> {
    this.built.push('funding');
    const wire = Buffer.from(JSON.stringify({ kind: 'funding', ...input, amount: String(input.amount) })).toString('base64');
    return { messageB64: wire, wireB64: wire, lastValidBlockHeight: this.height + 150 };
  }
  /** A wallet signed `wireB64` as `signer` and sent it. Returns its signature. */
  walletSend(wireB64: string, signer: string): string {
    const tx = JSON.parse(Buffer.from(wireB64, 'base64').toString('utf8')) as { kind: string; multisig: string; index: string; member: string };
    if (tx.kind !== 'approve' || tx.member !== signer) throw new Error('the wallet signs only its own vote');
    this.vote(tx.multisig, BigInt(tx.index), signer);
    const s = this.sig();
    this.statuses.set(s, 'finalized');
    this.landed.push({ step: 'cosigner_approve', signature: s });
    return s;
  }
}
