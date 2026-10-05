import { randomBytes } from 'node:crypto';
import type { DB } from '../db';
import { SettlementFailure, type SettlementProvider } from './types';

/**
 * SIMULATED settlement (ADR 0007 §4): a local table stands in for a chain. Nothing here holds a
 * key, signs, or touches a network, and SIM-USDC has no value. Every API response that comes from
 * it says `settlement: 'simulated'`, and the app labels it as a simulation, never as paid.
 *
 * It enforces what a real provider must: an idempotent `submit` per key, finality before a
 * transfer counts, and failures that send nothing. Test hooks (`holdProcessing`, `payoutFault`,
 * `crashAfterSubmit`) exercise the worker's retry and reconciliation paths.
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

export class SimulatedSettlement implements SettlementProvider {
  readonly mode = 'simulated' as const;
  readonly network = SIM_NETWORK;
  readonly mint = SIM_MINT;
  /** Test hooks. */
  holdProcessing = false;
  payoutFault: SimFault | null = null;
  crashAfterSubmit = false;

  constructor(
    private readonly db: DB,
    private readonly now: () => number,
  ) {}

  vaultFor(studyId: string) {
    return `sim-vault:${studyId}`;
  }

  newReference() {
    return `ref${randomBytes(16).toString('hex')}`;
  }

  /** Records a simulated transfer as if a wallet had sent it; returns its signature. */
  recordTransfer(t: Partial<SimTransfer> & Pick<SimTransfer, 'source' | 'destination' | 'amountUnits' | 'reference'>, kind: 'funding' | 'payout' | 'refund' | 'other' = 'other', key: string | null = null): string {
    const signature = `sim${randomBytes(24).toString('hex')}`;
    this.db
      .prepare(
        `INSERT INTO sim_chain_transfers (signature, network, mint, source, destination, amount_units, reference, kind, status, idempotency_key, block_time_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(signature, t.network ?? SIM_NETWORK, t.mint ?? SIM_MINT, t.source, t.destination, t.amountUnits, t.reference, kind, t.status ?? (this.holdProcessing ? 'processing' : 'finalized'), key, this.now());
    return signature;
  }

  /** Processing transfers finalize once the hold is lifted (a late confirmation). */
  private settleProcessing(signature: string) {
    if (!this.holdProcessing) this.db.prepare(`UPDATE sim_chain_transfers SET status = 'finalized' WHERE signature = ? AND status = 'processing'`).run(signature);
  }

  async getTransfer(signature: string, _expect?: { vault: string; reference: string }) {
    this.settleProcessing(signature);
    const r = this.db.prepare('SELECT * FROM sim_chain_transfers WHERE signature = ?').get(signature) as
      | { network: string; mint: string; source: string; destination: string; amount_units: number; reference: string; status: SimTransfer['status']; block_time_ms: number }
      | undefined;
    if (!r) return null;
    return { status: r.status, network: r.network, mint: r.mint, destination: r.destination, amountUnits: r.amount_units, reference: r.reference, blockTimeMs: r.block_time_ms, source: r.source };
  }

  async submit(req: { key: string; kind: 'payout' | 'refund'; vault: string; destination: string; amountUnits: number }) {
    // Idempotent per attempt key, as the worker persists it before sending (simulation).
    const existing = this.db.prepare('SELECT signature FROM sim_chain_transfers WHERE idempotency_key = ?').get(req.key) as { signature: string } | undefined;
    if (existing) return { signature: existing.signature };
    if (req.kind === 'payout' && this.payoutFault) throw new SettlementFailure(FAULT_REASONS[this.payoutFault]);
    const signature = this.recordTransfer({ source: req.vault, destination: req.destination, amountUnits: req.amountUnits, reference: req.key }, req.kind, req.key);
    if (this.crashAfterSubmit) throw new Error('simulated crash after the transfer was sent, before it was recorded');
    return { signature };
  }

  async status(signature: string) {
    this.settleProcessing(signature);
    const r = this.db.prepare('SELECT status FROM sim_chain_transfers WHERE signature = ?').get(signature) as { status: SimTransfer['status'] } | undefined;
    return r ? r.status : 'not_found';
  }

  /** Test and evidence helpers: landed transfers by kind and destination. */
  payoutCount(opts: { landed?: boolean } = {}) {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM sim_chain_transfers WHERE kind = 'payout'${opts.landed ? ` AND status = 'finalized'` : ''}`).get() as { n: number }).n;
  }
  payoutsTo(destination: string) {
    return (this.db.prepare(`SELECT COALESCE(SUM(amount_units),0) AS s FROM sim_chain_transfers WHERE kind = 'payout' AND status = 'finalized' AND destination = ?`).get(destination) as { s: number }).s;
  }
  refundsTo(destination: string) {
    return (this.db.prepare(`SELECT COALESCE(SUM(amount_units),0) AS s FROM sim_chain_transfers WHERE kind = 'refund' AND status = 'finalized' AND destination = ?`).get(destination) as { s: number }).s;
  }
}
