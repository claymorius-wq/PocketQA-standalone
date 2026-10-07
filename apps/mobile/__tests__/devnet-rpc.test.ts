import { squadsTransactionPda } from '@pocket-qa/domain';
import type { SettlementApproval } from '@pocket-qa/contracts';
import { approvalPlan, ATTACKER, LINKED, MULTISIG, OP, vaultAccount } from '../test-support/devnetTx';
import { DEVNET_RPC_URL, readVaultTransfer } from '../src/wallet/devnetRpc';

// pqa-qa CS3: the client reads the payment a vote approves on Solana devnet itself (a pinned public
// endpoint, never one Pocket QA's server names), checks the cluster first, and reports one of:
// checked (the account matches the plan), mismatch (refuse) or unavailable (stays "described").

const DEVNET = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const MAINNET = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
const SQUADS = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const plan = (over: Record<string, unknown> = {}) => approvalPlan(over) as unknown as SettlementApproval;

type Rpc = { genesis?: string; account?: { owner: string; data: string } | null; fail?: 'network' | 'http' };
function rpc(o: Rpc) {
  const calls: { url: string; body: { method: string; params: unknown[] } }[] = [];
  const fetchImpl = jest.fn(async (url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { id: number; method: string; params: unknown[] };
    calls.push({ url, body });
    if (o.fail === 'network') throw new TypeError('Network request failed');
    if (o.fail === 'http') return { ok: false, status: 429, json: async () => ({}) };
    const result =
      body.method === 'getGenesisHash'
        ? (o.genesis ?? DEVNET)
        : { context: { slot: 1 }, value: o.account === null ? null : { owner: o.account?.owner ?? SQUADS, data: [o.account?.data ?? vaultAccount(), 'base64'], lamports: 1, executable: false } };
    return { ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe('readVaultTransfer', () => {
  it('checked: the pinned devnet endpoint, the cluster first, then the finalized vault transaction at (multisig, index)', async () => {
    const r = rpc({});
    await expect(readVaultTransfer(plan(), r.fetchImpl)).resolves.toEqual({ state: 'checked', amountUnits: 1_500_000, recipient: ATTACKER, opId: OP });
    expect(DEVNET_RPC_URL).toBe('https://api.devnet.solana.com');
    expect(r.calls.map((c) => c.url)).toEqual([DEVNET_RPC_URL, DEVNET_RPC_URL]);
    expect(r.calls[0]!.body.method).toBe('getGenesisHash');
    expect(r.calls[1]!.body).toMatchObject({ method: 'getAccountInfo', params: [squadsTransactionPda(MULTISIG, 4n), { encoding: 'base64', commitment: 'finalized' }] });
  });

  it.each<[string, Rpc, RegExp]>([
    ['another amount on chain', { account: { owner: SQUADS, data: vaultAccount({ amount: 9_000_000n }) } }, /amount differs/],
    ['another recipient on chain', { account: { owner: SQUADS, data: vaultAccount({ recipient: LINKED }) } }, /recipient/],
    ['another operation id on chain', { account: { owner: SQUADS, data: vaultAccount({ opId: `pqa-op1:${'cd'.repeat(32)}` }) } }, /operation id/],
    ['another index in the account', { account: { owner: SQUADS, data: vaultAccount({ index: 5n }) } }, /index/],
    ['an account not owned by Squads', { account: { owner: LINKED, data: vaultAccount() } }, /not a Squads account/],
    ['not a vault transaction', { account: { owner: SQUADS, data: 'AAAAAAAAAAA=' } }, /Not a Squads vault transaction/],
  ])('mismatch (refuse): %s', async (_n, o, msg) => {
    const out = await readVaultTransfer(plan(), rpc(o).fetchImpl);
    expect(out.state).toBe('mismatch');
    expect(out.state === 'mismatch' && out.reason).toMatch(msg);
  });

  it.each<[string, Rpc, RegExp]>([
    ['the endpoint is not devnet (mainnet genesis)', { genesis: MAINNET }, /isn’t Solana devnet/],
    ['no vault transaction yet', { account: null }, /not on Solana devnet yet/],
    ['network error', { fail: 'network' }, /couldn’t reach Solana devnet/],
    ['rate limited', { fail: 'http' }, /couldn’t reach Solana devnet/],
  ])('unavailable (stays described): %s', async (_n, o, msg) => {
    const out = await readVaultTransfer(plan(), rpc(o).fetchImpl);
    expect(out.state).toBe('unavailable');
    expect(out.state === 'unavailable' && out.reason).toMatch(msg);
  });

  it('a mainnet endpoint is never asked for the account', async () => {
    const r = rpc({ genesis: MAINNET });
    await readVaultTransfer(plan(), r.fetchImpl);
    expect(r.calls.map((c) => c.body.method)).toEqual(['getGenesisHash']);
  });
});
