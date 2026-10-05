import { DomainError } from './errors';
import { MAX_ESCROW_UNITS, type ObservedTransfer } from './escrow';

/**
 * Reading an SPL token funding transfer for a future devnet adapter (ADR 0007 §4). Pure: the
 * adapter fetches the transaction at `finalized` commitment on a genesis-checked devnet RPC and
 * passes it here. Nothing in this phase calls it against a network.
 *
 * The amount comes ONLY from `meta.preTokenBalances`/`postTokenBalances` of the vault's token
 * account for the pinned mint under the classic Token program, never from instruction parsing:
 * a transfer made through an inner (CPI) instruction is still seen, and a top-level transfer that
 * did not change the balance counts for nothing.
 */
export const CLASSIC_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
/** Circle's USDC on Solana devnet (developers.circle.com/stablecoins/usdc-contract-addresses); 6 decimals, has a freeze authority. */
export const DEVNET_USDC_MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
/** Mainnet USDC, refused everywhere in this phase. */
export const MAINNET_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

type TokenBalance = { accountIndex: number; mint: string; owner?: string; programId?: string; uiTokenAmount: { amount: string; decimals: number } };
/** The subset of a jsonParsed `getTransaction` result this reads. */
export type ParsedTokenTx = {
  blockTime: number | null;
  meta: { err: unknown; preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] } | null;
  transaction: { message: { accountKeys: { pubkey: string }[] } };
};

function baseUnits(amount: string): bigint {
  if (!/^\d+$/.test(amount)) throw new DomainError('VALIDATION', 'Malformed token amount.');
  return BigInt(amount);
}

/**
 * `observedNetwork` is what the adapter itself established (from the RPC's genesis hash), never
 * the expectation, so the verifier compares two independent values. The mint is reported only
 * when a credit under the pinned mint and the classic Token program was actually seen.
 */
export function observeTokenTransfer(
  tx: ParsedTokenTx,
  expect: { vault: string; mint: string; reference: string },
  observedNetwork: string,
): { transfer: ObservedTransfer; source: string | null } {
  const keys = tx.transaction.message.accountKeys.map((k) => k.pubkey);
  const vaultIndex = keys.indexOf(expect.vault);
  const pinned = (b: TokenBalance) => b.mint === expect.mint && b.programId === CLASSIC_TOKEN_PROGRAM;
  const at = (list: TokenBalance[] | undefined, index: number) => {
    const b = (list ?? []).find((x) => x.accountIndex === index && pinned(x));
    return b ? baseUnits(b.uiTokenAmount.amount) : 0n;
  };
  let credit = 0n;
  let source: string | null = null;
  if (vaultIndex >= 0 && tx.meta) {
    credit = at(tx.meta.postTokenBalances, vaultIndex) - at(tx.meta.preTokenBalances, vaultIndex);
    if (credit < 0n) credit = 0n;
    if (credit > BigInt(MAX_ESCROW_UNITS)) throw new DomainError('VALIDATION', 'Token amount too large.');
    // The funder: the pinned-mint account whose balance fell by exactly the vault's credit.
    if (credit > 0n) {
      for (const pre of (tx.meta.preTokenBalances ?? []).filter(pinned)) {
        if (pre.accountIndex === vaultIndex) continue;
        if (at(tx.meta.preTokenBalances, pre.accountIndex) - at(tx.meta.postTokenBalances, pre.accountIndex) === credit) {
          source = pre.owner ?? null;
          break;
        }
      }
    }
  }
  return {
    transfer: {
      status: !tx.meta || tx.meta.err !== null ? 'failed' : 'finalized',
      network: observedNetwork,
      mint: credit > 0n ? expect.mint : '',
      destination: vaultIndex >= 0 ? expect.vault : '',
      amountUnits: Number(credit),
      reference: keys.includes(expect.reference) ? expect.reference : '',
      blockTimeMs: tx.blockTime === null ? null : tx.blockTime * 1000,
    },
    source,
  };
}
