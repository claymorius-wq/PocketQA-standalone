import type { ObservedTransfer } from '@pocket-qa/domain';

/**
 * The settlement boundary (ADR 0007 §4). The escrow state machine and its ledger only talk to a
 * provider through this interface. Two exist:
 * - `simulated.ts`: a local table stands in for a chain (no keys, no network, no asset);
 * - `squads/adapter.ts`: the bounded Squads **devnet** feasibility pilot (§10), devnet test USDC
 *   only, with test keys simulating every role. Production refuses both.
 */
export interface SettlementProvider {
  readonly mode: 'simulated' | 'squads_devnet';
  readonly network: string;
  readonly mint: string;
  /** The study's escrow token account (what a funding transfer must credit). Pure and synchronous. */
  vaultFor(studyId: string): string;
  /** A fresh funding reference: a key the funding transfer must carry (Solana Pay style). */
  newReference(): string;
  /** Makes the study's escrow exist on the network before funding (idempotent); returns its on-chain accounts. */
  prepareVault?(input: { studyId: string; builderWallet: string }): Promise<{ multisig: string; vaultAuthority: string }>;
  /** A transfer by signature, as final as the network reports it; null if not found yet. */
  getTransfer(signature: string, expect: { vault: string; reference: string }): Promise<(ObservedTransfer & { source: string }) | null>;
  /**
   * Sends an outbound transfer from a study vault. Idempotent per settlement: the same
   * `settlementId` never moves funds twice, whatever `key` (attempt) is used. Throws
   * `SettlementFailure` when nothing was sent (a definitive, retryable failure); any other error
   * leaves the outcome unknown, and the caller retries.
   */
  submit(req: {
    key: string;
    settlementId: string;
    kind: 'payout' | 'refund';
    studyId: string;
    vault: string;
    destination: string;
    amountUnits: number;
    cosigner: 'builder' | 'arbiter';
  }): Promise<{ signature: string }>;
  /** Finality of a submitted transfer. */
  status(signature: string): Promise<'processing' | 'finalized' | 'failed' | 'not_found'>;
  /** The escrow token account's balance on the network (for reconciliation), if the provider has one. */
  vaultBalance?(studyId: string): Promise<number | null>;
}

/**
 * A definitive refusal or stop: this attempt moves no funds and is retried later. `chainState`,
 * when the provider has a network, says what the network showed for the payment when it stopped
 * (an earlier attempt may have sent transactions); without one, nothing was sent at all.
 */
export class SettlementFailure extends Error {
  constructor(
    message: string,
    public chainState: string | null = null,
  ) {
    super(message);
  }
}
