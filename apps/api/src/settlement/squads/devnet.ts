import { randomBytes, randomUUID } from 'node:crypto';
import { PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { DEVNET_COPY, type DevnetFundingTransaction, type SettlementApproval, type SettlementApprovalResult } from '@pocket-qa/contracts';
import { MAX_ESCROW_UNITS, observeTokenTransfer } from '@pocket-qa/domain';
import type { Repos } from '../../repo';
import type { FundingRow, SettlementRow } from '../../repo/escrow/types';
import { fail } from '../../util';
import { AwaitingCosigner, SettlementFailure, SettlementPending, type SettlementProvider } from '../types';
import { ataOf, isWallet, operationId, sameTransfer, sortMembers } from './adapter';
import type { MemberState, MultisigState, VaultTransfer } from './chain';
import { assertPlatformSigner } from './devnetSigner';
import {
  paymentLamports,
  VAULT_LAMPORTS,
  type DevnetChain,
  type DevnetLimits,
  type DevnetReceipt,
  type DevnetSettlementOps,
  type DevnetStep,
  type DevnetStepInput,
  type DevnetStore,
  type ReceiptKind,
  type ReceiptStep,
} from './devnetTypes';
import { AUTONOMOUS, DEVNET_GENESIS, PERM, PILOT_DECIMALS, PILOT_MINT, PILOT_NETWORK, PILOT_TOKEN_PROGRAM, THRESHOLD, TRANSFER_CHECKED } from './pins';

/**
 * POCKETQA_ENV=devnet's settlement (devnet-phase-contract.md, amendments r1; pqa-be3-interfaces.md):
 * Squads v4 on Solana devnet, devnet test USDC (no value), durable on Firestore.
 *
 * Custody: the server holds ONE key, the platform signer (Initiate, Vote, Execute). Each study's
 * 2-of-3 multisig has the builder's own linked wallet and the arbiter as the other members. For every
 * payment the platform creates the vault transaction and proposal WITHOUT voting; the cosigner (the
 * builder's wallet, or the arbiter's operator CLI) votes first; only once that vote is on chain does
 * the platform cast the second vote and execute. No route makes the server sign alone. Test keys,
 * not independent custody.
 *
 * Every signature is preceded by the pin checks (genesis, the mint's address, owner and decimals,
 * the Squads and Memo programs: pqa-qa P2-DA2) and the platform-key check (pinned, never another
 * role, incl. the study's builder wallet: P2-DA1). Every broadcast is preceded by a Firestore
 * transaction that re-checks the operation's lease fence and stores the step's message, wire bytes
 * and signature in its receipt (CH-D5, pqa-be2 flag 1), so a fenced-out holder broadcasts nothing
 * and a crash leaves a signature to look up. A run sends at most one transaction per operation and
 * never waits in-process: the next run (a request slice or cron) reads its status and continues.
 * A retry checks the recorded signature first, then the chain state by op id, and adopts what
 * landed; a step is rebuilt only when its blockhash expired strictly (lastValidBlockHeight <
 * blockHeight) and its effect is absent on chain (pqa-be2 flag 3).
 */
export type DevnetDeps = {
  repo: Repos;
  chain: DevnetChain;
  now: () => number;
  limits: DevnetLimits;
  /** The pinned keys from config (POCKETQA_DEVNET_*). */
  roles: { platform: string; arbiter: string; feeWallet: string };
  /** Labelled synthetic accounts allowed to start a server-signed operation (CH-D1). */
  allowedEmails: string[];
};

type Plan = VaultTransfer;
const MAX_INDEX_SCAN = 64;

export class DevnetSquadsSettlement implements SettlementProvider, DevnetSettlementOps {
  readonly mode = 'squads_devnet' as const;
  readonly network = PILOT_NETWORK;
  readonly mint = PILOT_MINT;
  private readonly store: DevnetStore;

  constructor(private readonly d: DevnetDeps) {
    if (!d.repo.escrow.devnet) throw new Error('The devnet adapter runs only on Firestore (the devnet namespace).');
    this.store = d.repo.escrow.devnet;
  }

  // ── Accounts (derived, so known before they exist and after a restart) ────────────────────

  accountsFor(studyId: string) {
    const createKey = new PublicKey(this.d.chain.createKeyFor(studyId));
    const [ms] = multisig.getMultisigPda({ createKey });
    const [vault] = multisig.getVaultPda({ multisigPda: ms, index: 0 });
    return { multisig: ms.toBase58(), vaultAuthority: vault.toBase58(), vaultAta: ataOf(vault.toBase58()) };
  }

  vaultFor(studyId: string) {
    return this.accountsFor(studyId).vaultAta;
  }

  newReference() {
    return new PublicKey(randomBytes(32)).toBase58();
  }

  private members(builderWallet: string): MemberState[] {
    return sortMembers([
      { key: builderWallet, mask: PERM.vote },
      { key: this.d.roles.platform, mask: PERM.initiate | PERM.vote | PERM.execute },
      { key: this.d.roles.arbiter, mask: PERM.vote },
    ]);
  }

  // ── Guards: before EVERY signature (and at startup) ────────────────────────────────────────

  /** P2-DA1 + P2-DA2 + the program pins. Throws SettlementFailure, so nothing is signed. */
  private async guard(builderWallet?: string) {
    const { chain } = this.d;
    try {
      assertPlatformSigner(chain.roles.platform, { ...this.d.roles, ...(builderWallet ? { builderWallet } : {}) });
    } catch (e) {
      throw new SettlementFailure(`Refused before signing: ${(e as Error).message}`);
    }
    if (chain.roles.arbiter !== this.d.roles.arbiter) throw new SettlementFailure('Refused before signing: the arbiter key differs from POCKETQA_DEVNET_ARBITER_PUBKEY.');
    if ((await chain.genesisHash()) !== DEVNET_GENESIS) throw new SettlementFailure('Refused before signing: the RPC is not Solana devnet (genesis hash mismatch).');
    const m = await chain.mintInfo(PILOT_MINT);
    if (!m || m.address !== PILOT_MINT || m.owner !== PILOT_TOKEN_PROGRAM || m.decimals !== PILOT_DECIMALS) {
      throw new SettlementFailure('Refused before signing: the devnet test USDC mint does not match its pins (address, classic Token program, 6 decimals).');
    }
    if (!(await chain.programExecutable())) throw new SettlementFailure('Refused before signing: the Squads v4 program is not deployed as pinned on this cluster.');
    if (!(await chain.memoProgramExecutable())) throw new SettlementFailure('Refused before signing: the pinned SPL Memo program is not deployed as pinned on this cluster.');
  }

  /**
   * pqa-qa P2-F1: a transaction built for the builder's own wallet is a signature too (theirs), so
   * the same pins hold before one is built. On a route, a refusal is 503 CHAIN_UNAVAILABLE.
   */
  private async guardForWallet(builderWallet: string) {
    try {
      await this.guard(builderWallet);
    } catch (e) {
      if (e instanceof SettlementFailure) throw fail('CHAIN_UNAVAILABLE', e.message);
      throw e;
    }
  }

  /** At startup: the same checks, so a misconfigured deployment refuses before serving. */
  async startupCheck() {
    await this.guard();
  }

  private assertConfig(ms: MultisigState, builderWallet: string) {
    const want = this.members(builderWallet);
    const got = sortMembers(ms.members);
    const same = got.length === want.length && got.every((m, i) => m.key === want[i]!.key && m.mask === want[i]!.mask);
    if (ms.threshold !== THRESHOLD || ms.configAuthority !== AUTONOMOUS || ms.timeLock !== 0 || ms.rentCollector !== null || !same) {
      throw new SettlementFailure('Refused before signing: the study multisig on chain is not the pinned autonomous 2-of-3 (threshold, config authority, time lock, rent collector or members differ).');
    }
  }

  private async allowed(userId: string) {
    const u = await this.d.repo.core.userById(userId);
    if (!u || !this.d.allowedEmails.includes(u.email.toLowerCase())) {
      throw new SettlementFailure('Refused: only the labelled synthetic devnet accounts can start a devnet operation (CH-D1).');
    }
  }

  // ── One step: sign + record + broadcast, or follow up on the recorded one ──────────────────

  /**
   * Makes `step` happen once. Returns only when its recorded transaction is finalized; otherwise it
   * (re)broadcasts at most once and throws SettlementPending for the next run.
   */
  private async step(kind: ReceiptKind, id: string, fence: number, rec: ReceiptStep | undefined, input: DevnetStepInput, builderWallet: string): Promise<void> {
    const { chain, now } = this.d;
    if (rec && rec.status !== 'failed') {
      const st = await chain.signatureStatus(rec.signature);
      if (st === 'finalized') {
        await this.patchOrPend(kind, id, fence, { steps: { [input.step]: { ...rec, status: 'finalized' } } });
        return;
      }
      if (st === 'processing') throw new SettlementPending(`${input.step} is confirming`);
      if (st === 'failed') {
        await this.patchOrPend(kind, id, fence, { steps: { [input.step]: { ...rec, status: 'failed' } } });
      } else if (rec.last_valid_block_height >= (await chain.blockHeight())) {
        // Not seen, but it can still land: the SAME bytes again (same signature), never a new transaction.
        if (!(await this.store.beforeBroadcast(kind, id, fence, input.step, rec, now()))) throw new SettlementPending('fenced out');
        await chain.broadcast({ step: input.step, messageB64: rec.message_b64, signature: rec.signature, wireB64: rec.wire_b64, lastValidBlockHeight: rec.last_valid_block_height, estLamports: rec.est_lamports });
        throw new SettlementPending(`${input.step} re-broadcast`);
      }
      // Expired strictly and absent on chain (the caller read the chain before asking): rebuild below.
    }
    await this.guard(builderWallet);
    const p = await chain.prepare(input);
    if (p.step !== input.step) throw new Error('The chain prepared a different step.');
    const record: ReceiptStep = { message_b64: p.messageB64, wire_b64: p.wireB64, signature: p.signature, last_valid_block_height: p.lastValidBlockHeight, est_lamports: p.estLamports, status: 'sent', slot: null, fee_lamports: null };
    if (!(await this.store.beforeBroadcast(kind, id, fence, input.step, record, now()))) throw new SettlementPending('fenced out');
    await chain.broadcast(p);
    throw new SettlementPending(`${input.step} sent`);
  }

  /**
   * The chain shows `step`'s effect: resolve its recorded transaction from its signature, so the
   * receipt (and the spend true-up, which counts finalized steps) reflects what landed (pqa-be2 E-25:
   * a step whose effect a run merely observes would otherwise stay `sent` and cost nothing).
   */
  private async observed(kind: ReceiptKind, id: string, fence: number, step: DevnetStep, rec: ReceiptStep | undefined) {
    if (!rec || rec.status === 'finalized' || rec.status === 'failed') return;
    const st = await this.d.chain.signatureStatus(rec.signature);
    if (st === 'finalized' || st === 'failed') await this.patchOrPend(kind, id, fence, { steps: { [step]: { ...rec, status: st } } });
  }

  private async patchOrPend(kind: ReceiptKind, id: string, fence: number, p: Parameters<DevnetStore['patch']>[3]) {
    if (!(await this.store.patch(kind, id, fence, p, this.d.now()))) throw new SettlementPending('fenced out');
  }

  /** Runs `fn` under the operation's lease; another holder means "not now" (pending), never a second runner. */
  private async leased<T>(kind: ReceiptKind, id: string, fn: (fence: number) => Promise<T>): Promise<T> {
    const fence = await this.store.acquire(kind, id, randomUUID(), this.d.now());
    if (fence === null) throw new SettlementPending('another run holds this operation');
    try {
      return await fn(fence);
    } finally {
      await this.store.release(kind, id, fence).catch(() => undefined);
    }
  }

  // ── The study vault ─────────────────────────────────────────────────────────────────────────

  async prepareVault(input: { studyId: string; builderWallet: string; userId?: string }) {
    if (!input.userId) throw new SettlementFailure('Refused: a devnet vault is prepared only for a signed-in builder.');
    await this.allowed(input.userId);
    if (!isWallet(input.builderWallet)) throw new SettlementFailure('Refused before signing: the builder wallet is not a wallet address.');
    const a = this.accountsFor(input.studyId);
    let v = await this.store.vault(input.studyId);
    if (!v) {
      const claimed = await this.store.claimVault(
        { study_id: input.studyId, uid: input.userId, multisig: a.multisig, vault_authority: a.vaultAuthority, vault_ata: a.vaultAta, builder_wallet: input.builderWallet, fee_wallet: this.d.roles.feeWallet, reserved_lamports: VAULT_LAMPORTS },
        this.d.limits,
        this.d.now(),
      );
      if ('cap' in claimed) throw fail('DEVNET_SPEND_CAP', `Preparing this study's devnet vault would exceed ${claimed.cap}; nothing was signed.`);
      v = claimed.vault;
    }
    if (v.builder_wallet !== input.builderWallet) throw new SettlementFailure('Refused: this study’s devnet vault was prepared for a different builder wallet.');
    if (v.state === 'ready') return { multisig: a.multisig, vaultAuthority: a.vaultAuthority };
    return this.leased('vault', input.studyId, async (fence) => {
      const cur = (await this.store.vault(input.studyId))!;
      let ms = await this.d.chain.getMultisig(a.multisig);
      if (!ms) {
        await this.step('vault', input.studyId, fence, cur.steps.multisig_create, { step: 'multisig_create', studyId: input.studyId, multisig: a.multisig, members: this.members(input.builderWallet), threshold: THRESHOLD }, input.builderWallet);
        ms = await this.d.chain.getMultisig(a.multisig);
        if (!ms) throw new SettlementPending('the multisig is not visible yet');
      } else await this.observed('vault', input.studyId, fence, 'multisig_create', cur.steps.multisig_create);
      this.assertConfig(ms, input.builderWallet);
      if ((await this.d.chain.tokenBalance(a.vaultAta)) === null) {
        await this.step('vault', input.studyId, fence, cur.steps.vault_ata_create, { step: 'vault_ata_create', owner: a.vaultAuthority }, input.builderWallet);
        if ((await this.d.chain.tokenBalance(a.vaultAta)) === null) throw new SettlementPending('the vault token account is not visible yet');
      } else await this.observed('vault', input.studyId, fence, 'vault_ata_create', cur.steps.vault_ata_create);
      await this.patchOrPend('vault', input.studyId, fence, { state: 'ready' });
      // The cumulative spend keeps what the landed transactions cost (re-read: steps were just resolved).
      await this.store.trueUp(`vault:${input.studyId}`, spent((await this.store.vault(input.studyId))!.steps));
      return { multisig: a.multisig, vaultAuthority: a.vaultAuthority };
    });
  }

  // ── Payments (payout, refund, fee sweep) ─────────────────────────────────────────────────────

  async submit(req: Parameters<SettlementProvider['submit']>[0]) {
    const s = await this.d.repo.escrow.settlementById(req.settlementId);
    // CH-D3: the request must be exactly the recorded settlement.
    if (!s || s.kind !== req.kind || s.study_id !== req.studyId || s.destination !== req.destination || s.amount_units !== req.amountUnits) {
      throw new SettlementFailure('Refused before signing: the transfer does not match its recorded settlement.');
    }
    const receipt = (await this.store.receipt(s.id)) ?? (await this.claim(s));
    return this.leased('payment', s.id, (fence) => this.drive(receipt.settlement_id, fence));
  }

  private plan(r: Pick<DevnetReceipt, 'op_id' | 'vault_ata' | 'destination_ata' | 'vault_authority' | 'amount_units'>): Plan {
    return {
      creator: this.d.roles.platform,
      operation: r.op_id,
      instructions: 2,
      program: PILOT_TOKEN_PROGRAM,
      opcode: TRANSFER_CHECKED,
      source: r.vault_ata,
      mint: PILOT_MINT,
      destination: r.destination_ata,
      authority: r.vault_authority,
      amount: BigInt(r.amount_units),
      decimals: PILOT_DECIMALS,
    };
  }

  /** The receipt and the WHOLE payment's lamports, claimed before anything is signed (pqa-be2 P2). */
  private async claim(s: SettlementRow): Promise<DevnetReceipt> {
    const study = await this.d.repo.studies.getStudy(s.study_id);
    if (!study) throw new SettlementFailure('Refused: the study of this payment does not exist.');
    await this.allowed(study.builder_id);
    const v = await this.store.vault(s.study_id);
    if (v?.state !== 'ready') throw new SettlementFailure('Refused before signing: this study has no prepared devnet vault.');
    if (!Number.isSafeInteger(s.amount_units) || s.amount_units <= 0 || s.amount_units > MAX_ESCROW_UNITS) throw new SettlementFailure('Refused before signing: invalid amount.');
    if (!isWallet(s.destination) || s.destination === v.vault_authority) throw new SettlementFailure('Refused before signing: the destination is not a wallet address.');
    // CH-D3: a fee sweep goes only to the pinned platform fee wallet.
    if (s.kind === 'fee' && s.destination !== this.d.roles.feeWallet) throw new SettlementFailure('Refused before signing: a fee sweep must go to the pinned platform fee wallet (POCKETQA_DEVNET_FEE_WALLET).');
    const kind = s.kind as DevnetReceipt['kind'];
    const op = operationId(kind, s.study_id, s.participation_id);
    const draft = {
      settlement_id: s.id,
      kind,
      study_id: s.study_id,
      participation_id: s.participation_id,
      uid: study.builder_id,
      op_id: op,
      multisig: v.multisig,
      vault_authority: v.vault_authority,
      vault_ata: v.vault_ata,
      destination: s.destination,
      destination_ata: ataOf(s.destination),
      amount_units: s.amount_units,
      cosigner: s.cosigner,
      cosigner_key: s.cosigner === 'builder' ? v.builder_wallet : this.d.roles.arbiter,
      reserved_lamports: paymentLamports((await this.d.chain.tokenBalance(ataOf(s.destination))) === null),
    };
    const ms = await this.d.chain.getMultisig(v.multisig);
    if (!ms) throw new SettlementFailure('Stopped before signing: the study vault does not exist on devnet.');
    // A lost receipt: the index is recovered from chain alone, by the op id in the vault message.
    const found = await this.findByOperation(v.multisig, ms.transactionIndex, op);
    if (found.length > 1) throw new SettlementFailure(`Refused: ${found.length} Squads transactions of this study carry this payment’s operation id; an operator must resolve it.`);
    if (found[0] && !sameTransfer(found[0].vt, this.plan(draft))) throw new SettlementFailure('Refused: a Squads transaction carries this payment’s operation id but not its exact transfer; it is never approved.');
    const claimed = await this.store.claimPayment(draft, Number(ms.transactionIndex), found[0] ? Number(found[0].index) : null, this.d.limits, this.d.now());
    if ('cap' in claimed) throw new SettlementFailure(`Refused before signing: this payment would exceed ${claimed.cap} (DEVNET_SPEND_CAP); nothing was signed.`);
    return claimed.receipt;
  }

  private async findByOperation(ms: string, chainIndex: bigint, op: string) {
    const out: { index: bigint; vt: VaultTransfer }[] = [];
    const from = chainIndex > BigInt(MAX_INDEX_SCAN) ? chainIndex - BigInt(MAX_INDEX_SCAN) + 1n : 1n;
    for (let i = from; i <= chainIndex; i++) {
      const vt = await this.d.chain.getVaultTransfer(ms, i);
      if (vt?.operation === op) out.push({ index: i, vt });
    }
    return out;
  }

  /** One run of a payment under its lease. Returns the execute signature once it is finalized on chain. */
  private async drive(id: string, fence: number): Promise<{ signature: string }> {
    const { chain } = this.d;
    let r = (await this.store.receipt(id))!;
    const builderWallet = (await this.store.vault(r.study_id))!.builder_wallet;
    const ms = await chain.getMultisig(r.multisig);
    if (!ms) throw new SettlementFailure('Stopped before signing: the study vault does not exist on devnet.');
    this.assertConfig(ms, builderWallet);
    // pqa-qa P3-F4 (liveness): Squads creates indexes strictly in order. A payment without an index
    // (it released one) or waiting behind an index nobody holds (released) moves to the next free one.
    const next = Number(ms.transactionIndex) + 1;
    if (!r.steps.vault_tx_create && (r.tx_index === 0 || (r.tx_index > next && (await this.store.indexOwner(r.multisig, next)) === null))) {
      if ((await this.store.reclaimIndex(id, fence, next, this.d.now())) === null) throw new SettlementPending(`waiting for Squads index ${next} of this study`);
      r = (await this.store.receipt(id))!;
    }
    const index = BigInt(r.tx_index);
    const plan = this.plan(r);

    // 1. The destination's token account (the platform pays its rent); a no-op once it exists.
    if ((await chain.tokenBalance(r.destination_ata)) === null) {
      await this.step('payment', id, fence, r.steps.dest_ata_create, { step: 'dest_ata_create', owner: r.destination }, builderWallet);
    } else await this.observed('payment', id, fence, 'dest_ata_create', r.steps.dest_ata_create);
    // 2. The vault transaction [TransferChecked(plan), Memo(op id)], created by the platform.
    let vt = await chain.getVaultTransfer(r.multisig, index);
    if (!vt) {
      if (ms.transactionIndex < index - 1n) throw new SettlementPending(`waiting for Squads index ${index - 1n} of this study`);
      if (ms.transactionIndex >= index) {
        await this.store.releaseIndex(id, fence, this.d.now());
        throw new SettlementFailure(`Stopped: Squads index ${index} of this study is taken by another transaction; this payment takes the next free index on its next attempt.`);
      }
      const balance = await chain.tokenBalance(r.vault_ata);
      if (balance === null || balance < plan.amount) {
        // Nothing was created at this index: give it back so later payments aren't blocked (P3-F4).
        await this.store.releaseIndex(id, fence, this.d.now());
        throw new SettlementFailure('Stopped before creating the transfer: the study vault holds less than it on devnet.');
      }
      await this.step('payment', id, fence, r.steps.vault_tx_create, { step: 'vault_tx_create', multisig: r.multisig, index, vaultAuthority: r.vault_authority, source: r.vault_ata, destination: r.destination_ata, amount: plan.amount, operation: r.op_id }, builderWallet);
      vt = await chain.getVaultTransfer(r.multisig, index);
      if (!vt) throw new SettlementPending('the vault transaction is not visible yet');
    } else await this.observed('payment', id, fence, 'vault_tx_create', r.steps.vault_tx_create);
    if (!sameTransfer(vt, plan)) throw new SettlementFailure(`Refused: Squads transaction ${index} of this study is not exactly this payment; it is never approved.`);
    // 3. The proposal (Initiate only: the platform does NOT vote here).
    let p = await chain.getProposal(r.multisig, index);
    if (!p) {
      await this.step('payment', id, fence, r.steps.proposal_create, { step: 'proposal_create', multisig: r.multisig, index }, builderWallet);
      p = await chain.getProposal(r.multisig, index);
      if (!p) throw new SettlementPending('the proposal is not visible yet');
    } else await this.observed('payment', id, fence, 'proposal_create', r.steps.proposal_create);
    if (['Rejected', 'Cancelled', 'Draft'].includes(p.status)) throw new SettlementFailure(`Refused: the proposal for Squads transaction ${index} is ${p.status.toLowerCase()}; an operator must resolve it.`);
    if (p.status === 'Executed' || p.status === 'Executing') return this.finish(r, fence);
    // 4. The cosigner votes first, in their own wallet (or the arbiter's CLI). Until then, nothing more is signed.
    if (!p.approved.includes(r.cosigner_key)) {
      if (r.state !== 'awaiting_cosigner') await this.patchOrPend('payment', id, fence, { state: 'awaiting_cosigner' });
      throw new AwaitingCosigner(`waiting for the ${r.cosigner}'s approval`);
    }
    // 5. The platform completes the 2-of-3, then executes.
    if (!p.approved.includes(this.d.roles.platform)) {
      await this.step('payment', id, fence, r.steps.approve_platform, { step: 'approve_platform', multisig: r.multisig, index }, builderWallet);
      p = await chain.getProposal(r.multisig, index);
    } else await this.observed('payment', id, fence, 'approve_platform', r.steps.approve_platform);
    if (p?.status === 'Approved') {
      await this.step('payment', id, fence, r.steps.execute, { step: 'execute', multisig: r.multisig, index }, builderWallet);
    }
    const after = await chain.getProposal(r.multisig, index);
    if (after?.status === 'Executed') return this.finish(r, fence);
    throw new SettlementPending(`Squads transaction ${index} is not executed yet`);
  }

  /** Executed: adopt the execute signature (recorded, or found on chain), true up the spend. */
  private async finish(r: DevnetReceipt, fence: number) {
    // Every step's effect is on chain now: resolve each recorded transaction before counting.
    for (const step of ['dest_ata_create', 'vault_tx_create', 'proposal_create', 'approve_platform', 'execute'] as const) {
      await this.observed('payment', r.settlement_id, fence, step, (await this.store.receipt(r.settlement_id))!.steps[step]);
    }
    const fresh = (await this.store.receipt(r.settlement_id))!;
    const recorded = fresh.steps.execute?.status === 'finalized' ? fresh.steps.execute.signature : null;
    const signature = recorded ?? (await this.d.chain.findExecuteSignature(r.multisig, BigInt(r.tx_index)));
    if (!signature) throw new SettlementPending('executed; the execute signature is not found yet');
    if (fresh.state !== 'executed') {
      await this.patchOrPend('payment', r.settlement_id, fence, { state: 'executed' });
      await this.store.trueUp(`payment:${r.settlement_id}`, spent(fresh.steps));
    }
    return { signature };
  }

  async status(signature: string) {
    return this.d.chain.signatureStatus(signature);
  }

  async vaultBalance(studyId: string) {
    if ((await this.d.chain.genesisHash()) !== DEVNET_GENESIS) return null;
    const b = await this.d.chain.tokenBalance(this.vaultFor(studyId));
    return b === null ? null : Number(b);
  }

  async getTransfer(signature: string, expect: { vault: string; reference: string }) {
    const tx = await this.d.chain.getParsedTransaction(signature);
    if (!tx) return null;
    const genesis = await this.d.chain.genesisHash();
    const observed = genesis === DEVNET_GENESIS ? PILOT_NETWORK : `solana:genesis:${genesis}`;
    const { transfer, source } = observeTokenTransfer(tx, { vault: expect.vault, mint: PILOT_MINT, reference: expect.reference }, observed);
    return { ...transfer, source: source && isWallet(source) ? source : '' };
  }

  // ── The builder's wallet (the three devnet routes) ───────────────────────────────────────────

  async fundingTransaction(f: FundingRow, builderWallet: string): Promise<DevnetFundingTransaction> {
    if (f.status !== 'awaiting_payment' || f.expires_at <= this.d.now()) throw fail('CONFLICT_STATE', 'This funding request is no longer open. Start a new one.');
    const v = await this.store.vault(f.study_id);
    if (v?.state !== 'ready') {
      // Each request advances the vault by at most one transaction.
      const study = await this.d.repo.studies.getStudy(f.study_id);
      await this.prepareVault({ studyId: f.study_id, builderWallet, userId: study!.builder_id }).catch((e: unknown) => {
        if (!(e instanceof SettlementPending)) throw e;
      });
      if ((await this.store.vault(f.study_id))?.state !== 'ready') throw fail('VAULT_NOT_READY', 'The study’s devnet vault is still being created. Try again in a few seconds.');
    }
    const vaultAta = this.vaultFor(f.study_id);
    await this.guardForWallet(builderWallet);
    // CH-D3: from the server's own state only: this study's vault, the quoted amount, the request's reference.
    const tx = await this.d.chain.buildFundingTransfer({ from: builderWallet, vaultAta, amount: BigInt(f.amount_units), reference: f.reference });
    return { transactionB64: tx.wireB64, fundingId: f.id, studyId: f.study_id, reference: f.reference, amountUnits: f.amount_units, destination: vaultAta, mint: PILOT_MINT, network: 'devnet', copy: DEVNET_COPY };
  }

  /** The payment's receipt, if its proposal is waiting for THIS builder's vote. */
  private async waitingFor(s: SettlementRow, builderWallet: string) {
    const r = await this.store.receipt(s.id);
    if (!r || !['proposed', 'awaiting_cosigner'].includes(r.state)) throw fail('CONFLICT_STATE', 'This payment has no proposal waiting for approval yet.');
    if (r.cosigner !== 'builder' || r.cosigner_key !== builderWallet) throw fail('CONFLICT_STATE', 'This payment is approved by the arbiter, not by your wallet.');
    return r;
  }

  async approval(s: SettlementRow, builderWallet: string): Promise<SettlementApproval> {
    const r = await this.waitingFor(s, builderWallet);
    await this.guardForWallet(builderWallet);
    const tx = await this.d.chain.buildCosignerApprove(r.multisig, BigInt(r.tx_index), builderWallet);
    return {
      settlementId: s.id,
      kind: r.kind,
      transactionB64: tx.wireB64,
      multisig: r.multisig,
      txIndex: r.tx_index,
      opId: r.op_id,
      amountUnits: r.amount_units,
      destination: r.destination,
      mint: PILOT_MINT,
      network: 'devnet',
      copy: DEVNET_COPY,
    };
  }

  async submitApproval(s: SettlementRow, body: { signature: string; txIndex: number; opId: string }, builderWallet: string): Promise<SettlementApprovalResult> {
    const r = await this.waitingFor(s, builderWallet);
    if (body.txIndex !== r.tx_index || body.opId !== r.op_id) throw fail('APPROVAL_MISMATCH', 'This approval is for a different Squads transaction than this payment.');
    // The signature is a hint only: the vote must be on THIS proposal, from the builder's wallet.
    const p = await this.d.chain.getProposal(r.multisig, BigInt(r.tx_index));
    if (!p?.approved.includes(builderWallet)) throw fail('COSIGNER_NOT_SEEN', 'Your approval is not on devnet yet. Try again once your wallet shows it confirmed.');
    return { settlementId: s.id, kind: r.kind, status: 'submitted', signature: null, network: 'devnet' };
  }

  /** CH-D1: test USDC entering the system, reserved once per study's funding (before the request exists). */
  async reserveFunding(input: { studyId: string; userId: string; amountUnits: number }) {
    // A route: the refusal is the API's 403 (the worker path keeps SettlementFailure).
    await this.allowed(input.userId).catch((e: unknown) => {
      throw e instanceof SettlementFailure ? fail('FEATURE_UNAVAILABLE', e.message) : e;
    });
    if (!(await this.store.reserveUsdc(`funding:${input.studyId}`, input.userId, input.amountUnits, this.d.limits))) {
      throw fail('DEVNET_SPEND_CAP', 'Funding this study would exceed the devnet test-USDC cap; nothing was created.');
    }
  }
}

/** What a receipt's landed transactions cost: their estimates (fee + rent); a landed failure cost its fee. */
function spent(steps: Partial<Record<DevnetStep, ReceiptStep>>) {
  return Object.values(steps).reduce((sum, s) => sum + (s?.status === 'finalized' ? s.est_lamports : s?.status === 'failed' ? 5_000 : 0), 0);
}

export function devnetSettlement(deps: DevnetDeps): DevnetSquadsSettlement {
  return new DevnetSquadsSettlement(deps);
}

