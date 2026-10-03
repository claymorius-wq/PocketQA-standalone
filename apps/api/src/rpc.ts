import type { ParsedTx } from '@pocket-qa/domain';
import type { DevnetRpc } from './context';

/**
 * Minimal JSON-RPC client for devnet reads. It never signs and never sends transactions.
 * Transfers are verified at `finalized` commitment so a `confirmed` status can't roll back.
 */
export function httpDevnetRpc(url: string, timeoutMs = 8000): DevnetRpc {
  let genesis: string | null = null;
  async function call<T>(method: string, params: unknown[]): Promise<T> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`rpc http ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { message: string } };
    if (body.error) throw new Error(`rpc error: ${body.error.message}`);
    return body.result as T;
  }
  return {
    async getGenesisHash() {
      genesis ??= await call<string>('getGenesisHash', []);
      return genesis;
    },
    async getLatestBlockhash() {
      const r = await call<{ value: { blockhash: string; lastValidBlockHeight: number } }>('getLatestBlockhash', [{ commitment: 'finalized' }]);
      return r.value;
    },
    async getTransaction(signature) {
      return call<ParsedTx | null>('getTransaction', [
        signature,
        { encoding: 'jsonParsed', commitment: 'finalized', maxSupportedTransactionVersion: 0 },
      ]);
    },
  };
}
