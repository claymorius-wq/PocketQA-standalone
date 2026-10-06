import { base64 } from '@scure/base';
import type { SettlementApproval } from '@pocket-qa/contracts';
import { decodeVaultTransaction, DEVNET_GENESIS_HASH, SQUADS_V4_PROGRAM, squadsTransactionPda, verifyVaultTransfer } from '@pocket-qa/domain';

/**
 * The payment a builder's vote approves, read on Solana devnet by the client itself (pqa-qa CS3).
 * The endpoint is pinned here, never taken from Pocket QA's server, so the check doesn't rest on
 * the party that built the vote; the cluster is proven by its genesis hash before anything is read.
 * Outcomes: `checked` (the VaultTransaction matches the plan exactly), `mismatch` (refuse the vote)
 * or `unavailable` (no answer: the amount and recipient stay "as described by Pocket QA").
 */
export const DEVNET_RPC_URL = 'https://api.devnet.solana.com';
const TIMEOUT_MS = 8000;

export type VaultRead =
  | { state: 'checked'; amountUnits: number; recipient: string; opId: string }
  | { state: 'mismatch'; reason: string }
  | { state: 'unavailable'; reason: string };

class Unreachable extends Error {}

export async function readVaultTransfer(plan: SettlementApproval, fetchImpl: typeof fetch = fetch): Promise<VaultRead> {
  let id = 0;
  const call = async <T,>(method: string, params: unknown[]): Promise<T> => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(DEVNET_RPC_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        signal: abort.signal,
      });
      if (!res.ok) throw new Unreachable(`HTTP ${res.status}`);
      const body = (await res.json()) as { result?: T; error?: unknown };
      if (body.error !== undefined || body.result === undefined) throw new Unreachable('RPC error');
      return body.result;
    } catch (e) {
      throw e instanceof Unreachable ? e : new Unreachable('network');
    } finally {
      clearTimeout(timer);
    }
  };

  let info: { value: { owner: string; data: [string, string] } | null };
  try {
    if ((await call<string>('getGenesisHash', [])) !== DEVNET_GENESIS_HASH) return { state: 'unavailable', reason: 'The endpoint isn’t Solana devnet, so we didn’t read the payment there' };
    info = await call('getAccountInfo', [squadsTransactionPda(plan.multisig, BigInt(plan.txIndex)), { encoding: 'base64', commitment: 'finalized' }]);
  } catch {
    return { state: 'unavailable', reason: 'We couldn’t reach Solana devnet to read the payment' };
  }
  if (!info.value) return { state: 'unavailable', reason: 'The payment is not on Solana devnet yet (finalized)' };
  if (info.value.owner !== SQUADS_V4_PROGRAM) return { state: 'mismatch', reason: 'The account at this payment’s address is not a Squads account' };
  try {
    const v = verifyVaultTransfer(decodeVaultTransaction(base64.decode(info.value.data[0])), {
      multisig: plan.multisig,
      txIndex: plan.txIndex,
      recipient: plan.destination,
      amountUnits: plan.amountUnits,
      opId: plan.opId,
    });
    return { state: 'checked', amountUnits: v.amountUnits, recipient: v.recipient, opId: plan.opId };
  } catch (e) {
    return { state: 'mismatch', reason: e instanceof Error ? e.message : 'The payment on Solana devnet doesn’t match' };
  }
}
