import type { Page } from '@playwright/test';
import { base58, base64 } from '@scure/base';
import { DEVNET_GENESIS_HASH, VAULT_TRANSACTION_DISCRIMINATOR } from '@pocket-qa/domain';

// TEST DOUBLE for the LOCAL devnet browser journey: the client's pinned devnet endpoint
// (src/wallet/devnetRpc.ts) is answered by the in-process fake chain behind be3's connectors seam.
// It proves the app's checks and states against a deterministic chain; it is NOT evidence of a
// real devnet transfer (the hosted run uses Solana devnet itself).
export const PINNED_DEVNET_RPC = 'https://api.devnet.solana.com';
const SQUADS = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';

export type FakeAccount = { owner: string; data: Uint8Array };
export type FakeDevnet = { genesis?: string; account: (address: string) => FakeAccount | null; requests?: { method: string; params: unknown[] }[] };

/** Answers JSON-RPC on the pinned devnet endpoint for this page. Methods the client doesn't use are errors. */
export async function routeDevnetRpc(page: Page, chain: FakeDevnet) {
  await page.route(`${PINNED_DEVNET_RPC}/**`, async (route) => {
    const { id, method, params } = JSON.parse(route.request().postData() ?? '{}') as { id: number; method: string; params: unknown[] };
    chain.requests?.push({ method, params });
    const ok = (result: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id, result }) });
    if (method === 'getGenesisHash') return ok(chain.genesis ?? DEVNET_GENESIS_HASH);
    if (method === 'getAccountInfo') {
      const a = chain.account(String(params[0]));
      return ok({ context: { slot: 1 }, value: a ? { owner: a.owner, data: [base64.encode(a.data), 'base64'], lamports: 1, executable: false, rentEpoch: 0 } : null });
    }
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32601, message: `${method}: not answered by the test double` } }) });
  });
}

const u32 = (n: number) => Array.from(new Uint8Array(new Uint32Array([n]).buffer));
const u64 = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return Array.from(b);
};

/**
 * A Squads VaultTransaction account for one planned transfer, as the server creates it
 * ([TransferChecked, Memo(op id)]); layout pinned against @sqds/multisig in packages/domain
 * vaultTransfer.test.ts. `t` is be3's VaultTransfer shape (apps/api settlement/squads/chain.ts).
 */
export function vaultTransactionAccount(multisig: string, index: bigint, t: { creator: string; operation: string | null; source: string; mint: string; destination: string; authority: string; amount: bigint; decimals: number }): FakeAccount {
  const ixs = [
    { program: TOKEN, accounts: [t.source, t.mint, t.destination, t.authority], data: [12, ...u64(t.amount), t.decimals] },
    ...(t.operation === null ? [] : [{ program: MEMO, accounts: [] as string[], data: Array.from(new TextEncoder().encode(t.operation)) }]),
  ];
  const keys: string[] = [];
  for (const ix of ixs) for (const k of [...ix.accounts, ix.program]) if (!keys.includes(k)) keys.push(k);
  const b: number[] = [...VAULT_TRANSACTION_DISCRIMINATOR, ...base58.decode(multisig), ...base58.decode(t.creator), ...u64(index), 255, 0, 255, ...u32(0), 1, 1, 2, ...u32(keys.length)];
  for (const k of keys) b.push(...base58.decode(k));
  b.push(...u32(ixs.length));
  for (const ix of ixs) b.push(keys.indexOf(ix.program), ...u32(ix.accounts.length), ...ix.accounts.map((a) => keys.indexOf(a)), ...u32(ix.data.length), ...ix.data);
  b.push(...u32(0));
  return { owner: SQUADS, data: Uint8Array.from(b) };
}
