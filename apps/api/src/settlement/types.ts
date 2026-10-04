import type { ObservedTransfer } from '@pocket-qa/domain';

/**
 * The settlement boundary (ADR 0007 §4). The escrow state machine and its ledger only talk to a
 * provider through this interface. The only implementation in this phase is the SIMULATED one
 * (`simulated.ts`): no keys, no network, no asset. A devnet or real adapter is disabled until a
 * verified provider or program is chosen and separately approved.
 */
export interface SettlementProvider {
  readonly mode: 'simulated';
  readonly network: string;
  readonly mint: string;
  /** The study's escrow address on this settlement network. */
  vaultFor(studyId: string): string;
  /** A transfer by signature, as final as the network reports it; null if not found yet. */
  getTransfer(signature: string): Promise<(ObservedTransfer & { source: string }) | null>;
  /**
   * Sends an outbound transfer from a study vault. Idempotent per `key`: the same key always
   * returns the same signature and never sends twice. Throws `SettlementFailure` when nothing was
   * sent (a definitive, retryable failure); any other error leaves the outcome unknown, and the
   * caller must retry with the same key.
   */
  submit(req: { key: string; kind: 'payout' | 'refund'; vault: string; destination: string; amountUnits: number }): Promise<{ signature: string }>;
  /** Finality of a submitted transfer. */
  status(signature: string): Promise<'processing' | 'finalized' | 'failed' | 'not_found'>;
}

/** Nothing was sent; safe to retry later with a new attempt. */
export class SettlementFailure extends Error {}
