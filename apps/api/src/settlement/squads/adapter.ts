import { createHash, createHmac, randomBytes } from 'node:crypto';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Keypair, PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { MAX_ESCROW_UNITS, observeTokenTransfer } from '@pocket-qa/domain';
import type { DB } from '../../db';
import { SettlementFailure, type SettlementProvider } from '../types';
import type { MemberState, MultisigState, SquadsChain, VaultTransfer } from './chain';
import { AUTONOMOUS, DEVNET_GENESIS, OPERATION_PREFIX, PERM, PILOT_DECIMALS, PILOT_MINT, PILOT_NETWORK, PILOT_TOKEN_PROGRAM, THRESHOLD, TRANSFER_CHECKED } from './pins';

/**
 * The Squads v4 DEVNET feasibility pilot (ADR 0007 §10). Devnet test USDC only (no value), and
 * pilot test keys simulate every role: this is not independent custody, and production refuses it.
 *
 * Each study gets an autonomous 2-of-3 multisig (no config authority, no time lock, no spending
 * limits, and NO rent collector: Squads then refuses to close finished transactions, so every
 * operation record stays on chain for good): the builder (Vote), Pocket QA (Initiate, Vote, Execute) and the arbiter (Vote). A
 * payout or refund is ONE vault transaction holding ONE TransferChecked of the exact amount from
 * the study vault's token account to the destination wallet's token account, approved by Pocket QA
 * and the cosigner (the builder, or the arbiter for an overturned dispute or an absent builder),
 * then executed by Pocket QA.
 *
 * Idempotency (the invariant the worker relies on) rests on an ON-CHAIN operation id: each vault
 * message is exactly [TransferChecked(plan), Memo(operation id)], where the id is derived from the
 * payment's kind, study and participation (`operationId`). Squads stores the message immutably and,
 * with no rent collector, permanently. Each settlement claims ONE transaction index, persisted in
 * `squads_attempts` BEFORE anything is sent, and every retry re-drives that index, re-reading the
 * vault transaction and proposal and doing only the missing steps. If the local claim is lost (a
 * database restore), the index is recovered from chain alone by the operation id; ambiguous or
 * mismatched carriers are refused. A multisig executes an index at most once, so funds move at
 * most once per payment. Before approving, the stored vault transaction is decoded and must equal
 * the plan exactly (operation id, transfer and Pocket QA as creator).
 *
 * Pins (genesis, program, mint owner and decimals) are checked before any step that signs.
 */
export type SquadsAccounts = { createKey: string; multisig: string; vaultAuthority: string; vaultAta: string };
type Attempt = { tx_index: number; execute_signature: string | null };

const KEY_DOMAIN = 'pocketqa/squads-devnet-pilot/create-key/v1/';

export class SquadsDevnetSettlement implements SettlementProvider {
  readonly mode = 'squads_devnet' as const;
  readonly network = PILOT_NETWORK;
  readonly mint = PILOT_MINT;
  private readonly db: DB;
  private readonly now: () => number;
  private readonly chain: SquadsChain;
  private readonly createSeed: Uint8Array;

  constructor(o: { db: DB; now: () => number; chain: SquadsChain; createSeed: Uint8Array }) {
    if (o.createSeed.length !== 32) throw new Error('The pilot create-key seed must be 32 bytes.');
    this.db = o.db;
    this.now = o.now;
    this.chain = o.chain;
    this.createSeed = o.createSeed;
  }

  /** The study's Squads create key is derived, so its addresses are known before it exists and after a restart. */
  private createKeySeed(studyId: string) {
    return createHmac('sha256', this.createSeed).update(KEY_DOMAIN + studyId).digest();
  }

  accountsFor(studyId: string): SquadsAccounts {
    const createKey = Keypair.fromSeed(this.createKeySeed(studyId)).publicKey;
    const [ms] = multisig.getMultisigPda({ createKey });
    const [vault] = multisig.getVaultPda({ multisigPda: ms, index: 0 });
    return { createKey: createKey.toBase58(), multisig: ms.toBase58(), vaultAuthority: vault.toBase58(), vaultAta: ataOf(vault.toBase58()) };
  }

  vaultFor(studyId: string) {
    return this.accountsFor(studyId).vaultAta;
  }

  /** A Solana Pay style reference: a fresh random public key the funding transfer must include. */
  newReference() {
    return new PublicKey(randomBytes(32)).toBase58();
  }

  private members(): MemberState[] {
    const r = this.chain.roles;
    return sortMembers([
      { key: r.builder, mask: PERM.vote },
      { key: r.pocketqa, mask: PERM.initiate | PERM.vote | PERM.execute },
      { key: r.arbiter, mask: PERM.vote },
    ]);
  }

  /** Genesis, Squads program and mint pins, checked before anything is signed. */
  private async assertPins() {
    const genesis = await this.chain.genesisHash();
    if (genesis !== DEVNET_GENESIS) throw new SettlementFailure('Refused before signing: the RPC is not Solana devnet (genesis hash mismatch).');
    if (!(await this.chain.programExecutable())) throw new SettlementFailure('Refused before signing: the Squads v4 program is not deployed as pinned on this cluster.');
    if (!(await this.chain.memoProgramExecutable())) throw new SettlementFailure('Refused before signing: the pinned SPL Memo program is not deployed as pinned on this cluster.');
    const mint = await this.chain.mintInfo(PILOT_MINT);
    if (!mint || mint.owner !== PILOT_TOKEN_PROGRAM || mint.decimals !== PILOT_DECIMALS) {
      throw new SettlementFailure('Refused before signing: the devnet test USDC mint does not match its pins (classic Token program, 6 decimals).');
    }
  }

  /** R1: exactly the autonomous 2-of-3 this adapter creates; anything else is refused. */
  private assertConfig(ms: MultisigState) {
    const want = this.members();
    const got = sortMembers(ms.members);
    const sameMembers = got.length === want.length && got.every((m, i) => m.key === want[i]!.key && m.mask === want[i]!.mask);
    if (ms.threshold !== THRESHOLD || ms.configAuthority !== AUTONOMOUS || ms.timeLock !== 0 || ms.rentCollector !== null || !sameMembers) {
      throw new SettlementFailure('Refused before signing: the study multisig config on chain is not the pinned autonomous 2-of-3 (threshold, config authority, time lock, rent collector or members differ).');
    }
  }

  /**
   * Creates the study's multisig (once) and its vault token account, so a funding transfer has a
   * destination. In the pilot the builder member must be the pilot builder TEST key, because the
   * adapter signs its approvals; a real wallet would have to sign for itself.
   */
  async prepareVault(input: { studyId: string; builderWallet: string }) {
    if (input.builderWallet !== this.chain.roles.builder) {
      throw new SettlementFailure('Pilot: test keys simulate every role, so the builder’s linked wallet must be the pilot builder test key.');
    }
    await this.assertPins();
    const a = this.accountsFor(input.studyId);
    let ms = await this.chain.getMultisig(a.multisig);
    if (!ms) {
      await this.chain.createMultisig({ createKeySeed: this.createKeySeed(input.studyId), multisig: a.multisig, members: this.members(), threshold: THRESHOLD, rentCollector: null });
      ms = await this.chain.getMultisig(a.multisig);
      if (!ms) throw new Error('The study multisig is not visible after creation; retry.');
    }
    this.assertConfig(ms);
    await this.chain.ensureAta(a.vaultAuthority);
    return { multisig: a.multisig, vaultAuthority: a.vaultAuthority };
  }

  async getTransfer(signature: string, expect: { vault: string; reference: string }) {
    const tx = await this.chain.getParsedTransaction(signature);
    if (!tx) return null;
    // The network is what the RPC itself reports (its genesis), never assumed.
    const genesis = await this.chain.genesisHash();
    const observed = genesis === DEVNET_GENESIS ? PILOT_NETWORK : `solana:genesis:${genesis}`;
    const { transfer, source } = observeTokenTransfer(tx, { vault: expect.vault, mint: PILOT_MINT, reference: expect.reference }, observed);
    // A refund must be able to reach the funder: a program-owned (off-curve) source is no funding
    // wallet, so it is reported as none and verification fails rather than confirming.
    return { ...transfer, source: source && isWallet(source) ? source : '' };
  }

  async status(signature: string) {
    return this.chain.signatureStatus(signature);
  }

  /** The vault token account's finalized balance on devnet (reconciliation: unmatched deposits). */
  async vaultBalance(studyId: string) {
    if ((await this.chain.genesisHash()) !== DEVNET_GENESIS) return null;
    const b = await this.chain.tokenBalance(this.vaultFor(studyId));
    return b === null ? null : Number(b);
  }

  async submit(req: Parameters<SettlementProvider['submit']>[0]) {
    const ctx: DriveContext = { multisig: null, operation: null };
    try {
      return await this.drive(req, ctx);
    } catch (e) {
      // Failure copy states what the chain shows for this payment, never an unproven "nothing sent".
      if (e instanceof SettlementFailure && e.chainState === null) e.chainState = await this.describe(ctx);
      throw e;
    }
  }

  private async drive(req: Parameters<SettlementProvider['submit']>[0], ctx: DriveContext) {
    const { db, chain } = this;
    // The request must be exactly the recorded settlement (the worker reads it from the same row).
    const row = db.prepare('SELECT kind, study_id, participation_id, destination, amount_units FROM settlements WHERE id = ?').get(req.settlementId) as
      | { kind: 'payout' | 'refund'; study_id: string; participation_id: string | null; destination: string; amount_units: number }
      | undefined;
    if (!row || row.kind !== req.kind || row.study_id !== req.studyId || row.destination !== req.destination || row.amount_units !== req.amountUnits) {
      throw new SettlementFailure('Refused before signing: the transfer does not match its recorded settlement.');
    }
    const a = this.accountsFor(req.studyId);
    if (req.vault !== a.vaultAta) throw new SettlementFailure('Refused before signing: the source is not this study’s vault.');
    if (!Number.isSafeInteger(req.amountUnits) || req.amountUnits <= 0 || req.amountUnits > MAX_ESCROW_UNITS) throw new SettlementFailure('Refused before signing: invalid amount.');
    if (!isWallet(req.destination) || req.destination === a.vaultAuthority) {
      throw new SettlementFailure('Refused before signing: the destination is not a wallet address (an on-curve public key).');
    }
    const operation = operationId(row.kind, row.study_id, row.participation_id);
    ctx.multisig = a.multisig;
    ctx.operation = operation;
    await this.assertPins();
    const ms = await chain.getMultisig(a.multisig);
    if (!ms) throw new SettlementFailure('Stopped before signing: the study vault does not exist on devnet.');
    this.assertConfig(ms);

    const plan: VaultTransfer = {
      creator: chain.roles.pocketqa,
      operation,
      instructions: 2,
      program: PILOT_TOKEN_PROGRAM,
      opcode: TRANSFER_CHECKED,
      source: a.vaultAta,
      mint: PILOT_MINT,
      destination: ataOf(req.destination),
      authority: a.vaultAuthority,
      amount: BigInt(req.amountUnits),
      decimals: PILOT_DECIMALS,
    };

    const attempt = await this.claimIndex(req.settlementId, a.multisig, ms.transactionIndex, plan);
    if (attempt.execute_signature) return { signature: attempt.execute_signature };
    const index = BigInt(attempt.tx_index);
    const release = () => db.prepare('DELETE FROM squads_attempts WHERE settlement_id = ? AND execute_signature IS NULL').run(req.settlementId);

    // The destination's token account (Pocket QA pays its rent); a no-op once it exists.
    await chain.ensureAta(req.destination);

    let vt = await chain.getVaultTransfer(a.multisig, index);
    if (!vt) {
      if (ms.transactionIndex !== index - 1n) {
        // Squads only creates the next index. The claim is released (nothing exists at it), so
        // this settlement never holds up others while it waits.
        release();
        throw new SettlementFailure(`Stopped before creating Squads transaction ${index}: Squads creates only index ${ms.transactionIndex + 1n} next.`);
      }
      const balance = await chain.tokenBalance(a.vaultAta);
      if (balance === null || balance < plan.amount) {
        release();
        throw new SettlementFailure('Stopped before creating the transfer: the study vault holds less than it on devnet.');
      }
      await chain.createVaultTransfer({ multisig: a.multisig, index, vaultAuthority: a.vaultAuthority, source: plan.source, destination: plan.destination, amount: plan.amount, operation });
      vt = await chain.getVaultTransfer(a.multisig, index);
      if (!vt) throw new Error(`Squads transaction ${index} is not visible after creation; retry.`);
    }
    if (!sameTransfer(vt, plan)) {
      throw new SettlementFailure(`Refused: Squads transaction ${index} of this study is not exactly this payment (operation id, transfer or creator differ); it is never approved.`);
    }

    let proposal = await chain.getProposal(a.multisig, index);
    if (!proposal) {
      await chain.createProposal(a.multisig, index);
      proposal = await chain.getProposal(a.multisig, index);
      if (!proposal) throw new Error(`The proposal for Squads transaction ${index} is not visible after creation; retry.`);
    }
    if (['Rejected', 'Cancelled', 'Draft'].includes(proposal.status)) {
      throw new SettlementFailure(`Refused: the proposal for Squads transaction ${index} is ${proposal.status.toLowerCase()}; an operator must resolve it.`);
    }

    let signature: string | null;
    if (proposal.status === 'Executed' || proposal.status === 'Executing') {
      // Sent before a crash: find it, never execute again.
      signature = await chain.findExecuteSignature(a.multisig, index);
      if (!signature) throw new Error(`Squads transaction ${index} is executed but its signature is not found yet; retry.`);
    } else {
      for (const role of ['pocketqa', req.cosigner] as const) {
        if (!proposal.approved.includes(chain.roles[role])) await chain.approve(a.multisig, index, role);
      }
      proposal = await chain.getProposal(a.multisig, index);
      if (proposal?.status !== 'Approved') throw new Error(`Squads transaction ${index} has not reached ${THRESHOLD} approvals; retry.`);
      signature = await chain.execute(a.multisig, index);
    }
    db.prepare('UPDATE squads_attempts SET execute_signature = ? WHERE settlement_id = ?').run(signature, req.settlementId);
    return { signature };
  }

  /** Every vault transaction of the multisig (1..chain index) whose stored operation id is `operation`. */
  private async findByOperation(ms: string, chainIndex: bigint, operation: string) {
    const found: { index: bigint; vt: VaultTransfer }[] = [];
    for (let i = 1n; i <= chainIndex; i++) {
      const vt = await this.chain.getVaultTransfer(ms, i);
      if (vt?.operation === operation) found.push({ index: i, vt });
    }
    return found;
  }

  /**
   * The settlement's transaction index.
   * 1. The persisted claim, if any.
   * 2. Recovery from chain alone (the local mapping can be lost, e.g. by a database restore): the
   *    one vault transaction whose immutable Memo carries this payment's operation id is adopted,
   *    but only if its payload equals the plan and Pocket QA created it. Two carriers of the id, a
   *    carrier with any other payload or creator, or a carrier claimed by another settlement are
   *    refused: never created, approved or executed again.
   * 3. Otherwise a fresh index after both the chain's counter and every index claimed here.
   * Persisted before any send; UNIQUE(multisig, tx_index) rules out two claims of one index.
   */
  private async claimIndex(settlementId: string, ms: string, chainIndex: bigint, plan: VaultTransfer): Promise<Attempt> {
    const get = () => this.db.prepare('SELECT tx_index, execute_signature FROM squads_attempts WHERE settlement_id = ?').get(settlementId) as Attempt | undefined;
    const existing = get();
    if (existing) return existing;
    const found = await this.findByOperation(ms, chainIndex, plan.operation!);
    if (found.length > 1) {
      throw new SettlementFailure(`Refused: ${found.length} Squads transactions of this study (indexes ${found.map((f) => f.index).join(', ')}) carry this payment’s operation id; none is approved or executed until an operator resolves it.`);
    }
    const carrier = found[0];
    if (carrier) {
      if (!sameTransfer(carrier.vt, plan)) {
        throw new SettlementFailure(`Refused: Squads transaction ${carrier.index} carries this payment’s operation id but not its exact transfer or creator; it is never approved.`);
      }
      const owner = this.db.prepare('SELECT settlement_id FROM squads_attempts WHERE multisig = ? AND tx_index = ?').get(ms, Number(carrier.index)) as { settlement_id: string } | undefined;
      if (owner && owner.settlement_id !== settlementId) {
        throw new SettlementFailure(`Refused: Squads transaction ${carrier.index} carries this payment’s operation id but already belongs to another settlement; an operator must resolve it.`);
      }
      this.db.prepare('INSERT INTO squads_attempts (settlement_id, multisig, tx_index, created_at) VALUES (?,?,?,?)').run(settlementId, ms, Number(carrier.index), this.now());
      return get()!;
    }
    return this.db.transaction(() => {
      const claimed = (this.db.prepare('SELECT MAX(tx_index) AS m FROM squads_attempts WHERE multisig = ?').get(ms) as { m: number | null }).m ?? 0;
      const index = Math.max(Number(chainIndex), claimed) + 1;
      this.db.prepare('INSERT INTO squads_attempts (settlement_id, multisig, tx_index, created_at) VALUES (?,?,?,?)').run(settlementId, ms, index, this.now());
      return get()!;
    })();
  }

  /** What the chain shows for this payment's operation id, read now (for failure copy). */
  private async describe(ctx: DriveContext): Promise<string> {
    if (!ctx.multisig || !ctx.operation) return 'This attempt stopped before signing; the devnet state of this payment was not read. Check its recorded devnet transactions.';
    try {
      // Never report another cluster's state as devnet's.
      if ((await this.chain.genesisHash()) !== DEVNET_GENESIS) return 'This attempt stopped before signing; the RPC is not devnet, so the devnet state of this payment was not read. Check its recorded devnet transactions.';
      const ms = await this.chain.getMultisig(ctx.multisig);
      const found = ms ? await this.findByOperation(ctx.multisig, ms.transactionIndex, ctx.operation) : [];
      if (found.length === 0) return 'On devnet now: not created (no Squads transaction carries this payment’s operation id).';
      if (found.length > 1) return `On devnet now: ambiguous (${found.length} Squads transactions carry this payment’s operation id).`;
      const { index } = found[0]!;
      const p = await this.chain.getProposal(ctx.multisig, index);
      if (!p) return `On devnet now: Squads transaction ${index} created, no proposal yet.`;
      if (p.status === 'Active') return `On devnet now: Squads transaction ${index} awaiting approvals (${p.approved.length} of ${THRESHOLD}).`;
      if (p.status === 'Approved') return `On devnet now: Squads transaction ${index} approved, not executed.`;
      if (p.status === 'Executed' || p.status === 'Executing') {
        const sig = await this.chain.findExecuteSignature(ctx.multisig, index);
        return `On devnet now: Squads transaction ${index} executed${sig ? ` (signature ${sig}, confirming)` : ''}.`;
      }
      return `On devnet now: Squads transaction ${index} proposal ${p.status.toLowerCase()}.`;
    } catch {
      return 'On devnet now: unknown (the read failed); checking again on the next run.';
    }
  }
}

type DriveContext = { multisig: string | null; operation: string | null };

/** The payment's durable operation id: bound to its kind, study and participation, never to a local row id. */
export function operationId(kind: 'payout' | 'refund', studyId: string, participationId: string | null) {
  return OPERATION_PREFIX + createHash('sha256').update(`${kind}|${studyId}|${participationId ?? '-'}`).digest('hex');
}

export function ataOf(owner: string) {
  return getAssociatedTokenAddressSync(new PublicKey(PILOT_MINT), new PublicKey(owner), true).toBase58();
}

function isWallet(address: string) {
  try {
    return PublicKey.isOnCurve(new PublicKey(address).toBytes());
  } catch {
    return false;
  }
}

const sortMembers = (m: MemberState[]) => [...m].sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));

function sameTransfer(a: VaultTransfer, b: VaultTransfer) {
  return (
    a.creator === b.creator &&
    a.operation === b.operation &&
    a.instructions === b.instructions &&
    a.program === b.program &&
    a.opcode === b.opcode &&
    a.source === b.source &&
    a.mint === b.mint &&
    a.destination === b.destination &&
    a.authority === b.authority &&
    a.amount === b.amount &&
    a.decimals === b.decimals
  );
}
