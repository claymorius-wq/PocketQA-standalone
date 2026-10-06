import { randomBytes } from 'node:crypto';
import type { DB } from '../db';
import type { Repos } from '../repo';
import { sqliteEscrowRepo } from '../repo/escrow/sqlite';
import type { EscrowRepo, SimTransferRow } from '../repo/escrow/types';
import { SettlementFailure, type SettlementProvider } from './types';

/**
 * SIMULATED settlement (ADR 0007 §4): a stored table stands in for a chain. Nothing here holds a
 * key, signs, or touches a network, and SIM-USDC has no value. Every API response that comes from
 * it says `settlement: 'simulated'`, and the app labels it as a simulation, never as paid.
 *
 * It enforces what a real provider must: an idempotent `submit` per key, finality before a
 * transfer counts, and failures that send nothing. Test hooks (`holdProcessing`, `payoutFault`,
 * `crashAfterSubmit`) exercise the worker's retry and reconciliation paths.
 *
 * Storage goes through the escrow repository (sim chain transfers, plus the `simIdempotency`
 * guard on Firestore), so hosted deployments can run it. Built over a SQLite `db` it also offers
 * the synchronous test helpers (`recordTransfer`, `payoutCount`, `payoutsTo`, `refundsTo`).
 */
export const SIM_NETWORK = 'simulated';
export const SIM_MINT = 'SIM-USDC';

export type SimFault = 'missing_token_account' | 'frozen_account' | 'relayer_underfunded';
const FAULT_REASONS: Record<SimFault, string> = {
  missing_token_account: 'The tester’s wallet has no token account for this asset yet (simulated).',
  frozen_account: 'The token account is frozen by the asset issuer (simulated).',
  relayer_underfunded: 'The transaction submitter has too little SOL for fees (simulated).',
};

export type SimTransfer = {
  network: string;
  mint: string;
  source: string;
  destination: string;
  amountUnits: number;
  reference: string;
  status: 'processing' | 'finalized' | 'failed';
};
type SimInput = Partial<SimTransfer> & Pick<SimTransfer, 'source' | 'destination' | 'amountUnits' | 'reference'>;

export class SimulatedSettlement implements SettlementProvider {
  readonly mode = 'simulated' as const;
  readonly network = SIM_NETWORK;
  readonly mint = SIM_MINT;
  /** Test hooks. */
  holdProcessing = false;
  payoutFault: SimFault | null = null;
  crashAfterSubmit = false;

  private readonly chain: EscrowRepo;
  /** Only when built over SQLite: backs the synchronous test helpers. */
  private readonly db: DB | null;

  constructor(
    source: DB | Pick<Repos, 'escrow'>,
    private readonly now: () => number,
  ) {
    if ('prepare' in source) {
      this.db = source;
      this.chain = sqliteEscrowRepo(source);
    } else {
      this.db = null;
      this.chain = source.escrow;
    }
  }

  vaultFor(studyId: string) {
    return `sim-vault:${studyId}`;
  }

  newReference() {
    return `ref${randomBytes(16).toString('hex')}`;
  }

  private row(t: SimInput, kind: SimTransferRow['kind'], key: string | null): SimTransferRow {
    return {
      signature: `sim${randomBytes(24).toString('hex')}`,
      network: t.network ?? SIM_NETWORK,
      mint: t.mint ?? SIM_MINT,
      source: t.source,
      destination: t.destination,
      amount_units: t.amountUnits,
      reference: t.reference,
      kind,
      status: t.status ?? (this.holdProcessing ? 'processing' : 'finalized'),
      idempotency_key: key,
      block_time_ms: this.now(),
    };
  }

  /** Records a simulated transfer as if a wallet had sent it; returns its signature. */
  async sendTransfer(t: SimInput, kind: SimTransferRow['kind'] = 'other', key: string | null = null): Promise<string> {
    return this.chain.simRecordTransfer(this.row(t, kind, key));
  }

  /** The signature of the simulated funding transfer already sent for this reference, if any. */
  fundingSignatureFor(reference: string): Promise<string | null> {
    return this.chain.simFundingSignature(reference);
  }

  /** Processing transfers finalize once the hold is lifted (a late confirmation). */
  private async settleProcessing(signature: string) {
    if (!this.holdProcessing) await this.chain.simFinalizeProcessing(signature);
  }

  async getTransfer(signature: string, _expect?: { vault: string; reference: string }) {
    await this.settleProcessing(signature);
    const r = await this.chain.simTransfer(signature);
    if (!r) return null;
    return { status: r.status, network: r.network, mint: r.mint, destination: r.destination, amountUnits: r.amount_units, reference: r.reference, blockTimeMs: r.block_time_ms, source: r.source };
  }

  async submit(req: { key: string; kind: 'payout' | 'refund'; vault: string; destination: string; amountUnits: number }) {
    // Idempotent per attempt key, as the worker persists it before sending (simulation).
    const existing = await this.chain.simSignatureForKey(req.key);
    if (existing) return { signature: existing };
    if (req.kind === 'payout' && this.payoutFault) throw new SettlementFailure(FAULT_REASONS[this.payoutFault]);
    const signature = await this.sendTransfer({ source: req.vault, destination: req.destination, amountUnits: req.amountUnits, reference: req.key }, req.kind, req.key);
    if (this.crashAfterSubmit) throw new Error('simulated crash after the transfer was sent, before it was recorded');
    return { signature };
  }

  async status(signature: string) {
    await this.settleProcessing(signature);
    const r = await this.chain.simTransfer(signature);
    return r ? r.status : 'not_found';
  }

  // ── Synchronous test and evidence helpers (SQLite only) ──────────────────────────────────

  private sqlite(): DB {
    if (!this.db) throw new Error('SimulatedSettlement: synchronous test helpers need the SQLite backend.');
    return this.db;
  }

  /** Records a simulated transfer synchronously (tests); returns its signature. */
  recordTransfer(t: SimInput, kind: SimTransferRow['kind'] = 'other', key: string | null = null): string {
    const r = this.row(t, kind, key);
    this.sqlite()
      .prepare(
        `INSERT INTO sim_chain_transfers (signature, network, mint, source, destination, amount_units, reference, kind, status, idempotency_key, block_time_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(r.signature, r.network, r.mint, r.source, r.destination, r.amount_units, r.reference, r.kind, r.status, r.idempotency_key, r.block_time_ms);
    return r.signature;
  }

  /** Landed transfers by kind and destination. */
  payoutCount(opts: { landed?: boolean } = {}) {
    return (this.sqlite().prepare(`SELECT COUNT(*) AS n FROM sim_chain_transfers WHERE kind = 'payout'${opts.landed ? ` AND status = 'finalized'` : ''}`).get() as { n: number }).n;
  }
  payoutsTo(destination: string) {
    return (this.sqlite().prepare(`SELECT COALESCE(SUM(amount_units),0) AS s FROM sim_chain_transfers WHERE kind = 'payout' AND status = 'finalized' AND destination = ?`).get(destination) as { s: number }).s;
  }
  refundsTo(destination: string) {
    return (this.sqlite().prepare(`SELECT COALESCE(SUM(amount_units),0) AS s FROM sim_chain_transfers WHERE kind = 'refund' AND status = 'finalized' AND destination = ?`).get(destination) as { s: number }).s;
  }
}
