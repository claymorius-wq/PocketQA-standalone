import { randomBytes } from 'node:crypto';
import { base58 } from '@scure/base';
import { Keypair } from '@solana/web3.js';
import type { ParsedTokenTx } from '@pocket-qa/domain';
import { ataOf } from '../src/settlement/squads/adapter';
import type { ChainStatus, MemberState, MultisigState, ProposalState, Role, SquadsChain, VaultTransfer } from '../src/settlement/squads/chain';
import { AUTONOMOUS, DEVNET_GENESIS, PERM, PILOT_DECIMALS, PILOT_MINT, PILOT_TOKEN_PROGRAM, TRANSFER_CHECKED } from '../src/settlement/squads/pins';

/**
 * An in-memory Squads devnet for adapter tests. It enforces what the program enforces and the
 * adapter relies on: a new vault transaction only at the next index, approvals only from Vote
 * members, execution only once and only at the threshold. `crashAfter` throws right after a step
 * landed (the outcome the adapter must recover from); `failApprovalFor` makes one signer refuse.
 */
export class FakeSquadsChain implements SquadsChain {
  private readonly kp = { builder: Keypair.generate(), pocketqa: Keypair.generate(), arbiter: Keypair.generate(), outsider: Keypair.generate() };
  readonly keys = Object.fromEntries(Object.entries(this.kp).map(([k, v]) => [k, v.publicKey.toBase58()])) as Record<Role | 'outsider', string>;
  readonly roles: Record<Role, string> = { builder: this.keys.builder, pocketqa: this.keys.pocketqa, arbiter: this.keys.arbiter };

  genesis = DEVNET_GENESIS;
  mintAccount: { owner: string; decimals: number } | null = { owner: PILOT_TOKEN_PROGRAM, decimals: PILOT_DECIMALS };
  programOk = true;
  /** Block time of recorded fundings (ms). */
  blockTimeMs = 1_800_000_000_000;
  multisigs = new Map<string, MultisigState>();
  vaultTxs = new Map<string, VaultTransfer>();
  proposals = new Map<string, ProposalState & { executeSig?: string }>();
  balances = new Map<string, number>();
  atas = new Set<string>();
  sent: { step: string; signature: string }[] = [];
  created = 0;
  crashAfter: string | null = null;
  failApprovalFor: Role | null = null;
  private txs = new Map<string, ParsedTokenTx>();
  private statuses = new Map<string, ChainStatus>();

  ataOf = ataOf;

  defaultMembers(builder: string): MemberState[] {
    return [
      { key: builder, mask: PERM.vote },
      { key: this.keys.pocketqa, mask: PERM.initiate | PERM.vote | PERM.execute },
      { key: this.keys.arbiter, mask: PERM.vote },
    ];
  }
  goodMultisig(builder: string): MultisigState {
    return { createKey: '', configAuthority: AUTONOMOUS, threshold: 2, timeLock: 0, transactionIndex: 0n, rentCollector: this.keys.pocketqa, members: this.defaultMembers(builder) };
  }
  /** Test-only: a role's ed25519 seed, to link that test wallet through the real SIWS flow. */
  seedOf(role: Role) {
    return this.kp[role].secretKey.slice(0, 32);
  }
  fundVault(ata: string, units: number) {
    this.atas.add(ata);
    this.balances.set(ata, (this.balances.get(ata) ?? 0) + units);
  }

  private sig() {
    // Shaped like a real signature (base58 of 64 bytes), so it passes the API's signature schema.
    const s = base58.encode(randomBytes(64));
    this.statuses.set(s, 'finalized');
    return s;
  }
  private send(step: string) {
    const signature = this.sig();
    this.sent.push({ step, signature });
    return signature;
  }
  private landed(step: string) {
    if (this.crashAfter === step) throw new Error(`simulated crash after ${step} landed`);
  }
  private k = (ms: string, i: bigint) => `${ms}:${i}`;

  async genesisHash() {
    return this.genesis;
  }
  async mintInfo(mint: string) {
    return mint === PILOT_MINT ? this.mintAccount : null;
  }
  async programExecutable() {
    return this.programOk;
  }
  async getMultisig(ms: string) {
    return this.multisigs.get(ms) ?? null;
  }
  async createMultisig(input: { createKeySeed: Uint8Array; multisig: string; members: MemberState[]; threshold: number; rentCollector: string }) {
    if (this.multisigs.has(input.multisig)) throw new Error('account already in use');
    this.created++;
    this.multisigs.set(input.multisig, {
      createKey: Keypair.fromSeed(input.createKeySeed).publicKey.toBase58(),
      configAuthority: AUTONOMOUS,
      threshold: input.threshold,
      timeLock: 0,
      transactionIndex: 0n,
      rentCollector: input.rentCollector,
      members: [...input.members].sort((a, b) => (a.key < b.key ? -1 : 1)),
    });
    return this.send('createMultisig');
  }
  async ensureAta(owner: string) {
    const ata = ataOf(owner);
    if (this.atas.has(ata)) return null;
    this.atas.add(ata);
    return this.send('ensureAta');
  }
  async tokenBalance(account: string) {
    return this.atas.has(account) ? BigInt(this.balances.get(account) ?? 0) : null;
  }
  async getVaultTransfer(ms: string, index: bigint) {
    return this.vaultTxs.get(this.k(ms, index)) ?? null;
  }
  async createVaultTransfer(input: { multisig: string; index: bigint; vaultAuthority: string; source: string; destination: string; amount: bigint }) {
    const ms = this.multisigs.get(input.multisig);
    if (!ms || input.index !== ms.transactionIndex + 1n) throw new Error('InvalidTransactionIndex');
    ms.transactionIndex = input.index;
    this.vaultTxs.set(this.k(input.multisig, input.index), {
      instructions: 1,
      program: PILOT_TOKEN_PROGRAM,
      opcode: TRANSFER_CHECKED,
      source: input.source,
      mint: PILOT_MINT,
      destination: input.destination,
      authority: input.vaultAuthority,
      amount: input.amount,
      decimals: PILOT_DECIMALS,
    });
    const s = this.send('createVaultTransfer');
    this.landed('createVaultTransfer');
    return s;
  }
  async getProposal(ms: string, index: bigint) {
    const p = this.proposals.get(this.k(ms, index));
    return p ? { status: p.status, approved: [...p.approved] } : null;
  }
  async createProposal(ms: string, index: bigint) {
    if (!this.vaultTxs.has(this.k(ms, index)) || this.proposals.has(this.k(ms, index))) throw new Error('cannot create proposal');
    this.proposals.set(this.k(ms, index), { status: 'Active', approved: [] });
    const s = this.send('createProposal');
    this.landed('createProposal');
    return s;
  }
  async approve(ms: string, index: bigint, role: Role) {
    if (this.failApprovalFor === role) throw new Error(`approval by ${role} failed (simulated signer refusal)`);
    const m = this.multisigs.get(ms)!;
    const key = this.roles[role];
    const member = m.members.find((x) => x.key === key);
    const p = this.proposals.get(this.k(ms, index));
    if (!member || !(member.mask & PERM.vote)) throw new Error('NotAMember');
    if (!p || p.status !== 'Active') throw new Error('InvalidProposalStatus');
    if (p.approved.includes(key)) throw new Error('AlreadyApproved');
    p.approved.push(key);
    if (p.approved.length >= m.threshold) p.status = 'Approved';
    const s = this.send(`approve:${role}`);
    this.landed(`approve:${role}`);
    return s;
  }
  async execute(ms: string, index: bigint) {
    const p = this.proposals.get(this.k(ms, index));
    if (!p || p.status !== 'Approved') throw new Error('InvalidProposalStatus: not approved by the threshold, or already executed');
    const vt = this.vaultTxs.get(this.k(ms, index))!;
    const from = this.balances.get(vt.source) ?? 0;
    if (!this.atas.has(vt.destination)) throw new Error('destination token account missing');
    if (from < Number(vt.amount)) throw new Error('insufficient funds');
    this.balances.set(vt.source, from - Number(vt.amount));
    this.balances.set(vt.destination, (this.balances.get(vt.destination) ?? 0) + Number(vt.amount));
    p.status = 'Executed';
    const s = this.send('execute');
    p.executeSig = s;
    this.landed('execute');
    return s;
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

  /** A finalized wallet transfer (the builder funding a vault, or a stray deposit), in jsonParsed shape. */
  recordFunding(t: { from: string; toAta: string; amount: number; reference: string; mint?: string }) {
    const mint = t.mint ?? PILOT_MINT;
    const fromAta = ataOf(t.from);
    const bal = (list: [number, number, string][]) =>
      list.map(([accountIndex, amount, owner]) => ({ accountIndex, mint, owner, programId: PILOT_TOKEN_PROGRAM, uiTokenAmount: { amount: String(amount), decimals: PILOT_DECIMALS } }));
    // A funder's token account starts with 50 test USDC the first time it is seen.
    if (mint === PILOT_MINT && !this.atas.has(fromAta)) this.fundVault(fromAta, 50_000_000);
    const from = mint === PILOT_MINT ? this.balances.get(fromAta)! : 50_000_000;
    const before = this.balances.get(t.toAta) ?? 0;
    const signature = this.sig();
    this.txs.set(signature, {
      blockTime: Math.floor(this.blockTimeMs / 1000),
      meta: { err: null, preTokenBalances: bal([[1, from, t.from], [2, before, 'vault']]), postTokenBalances: bal([[1, from - t.amount, t.from], [2, before + t.amount, 'vault']]) },
      transaction: { message: { accountKeys: [t.from, fromAta, t.toAta, t.reference, mint, PILOT_TOKEN_PROGRAM].map((pubkey) => ({ pubkey })) } },
    });
    if (mint === PILOT_MINT) {
      this.balances.set(fromAta, from - t.amount);
      this.fundVault(t.toAta, t.amount);
    }
    return signature;
  }
}
