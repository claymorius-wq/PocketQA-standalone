import { expect, test } from '@playwright/test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58, base64 } from '@scure/base';
import { decodeVaultTransaction, squadsTransactionPda, verifyVaultTransfer } from '@pocket-qa/domain';
import { encodeV0, MULTISIG, OP, ATTACKER, transferCheckedIx, approveIx, VAULT } from '../test-support/devnetTx';
import { associatedTokenAddress, PILOT_MINT } from '@pocket-qa/domain';
import { installDevnetWallet } from './devnetWallet';
import { routeDevnetRpc, vaultTransactionAccount, type FakeDevnet } from './fakeDevnetRpc';

// Self-test of the devnet journey harness with a THROWAWAY key on a route-only page: the test
// wallet signs exactly the fee-payer slot of real v0 bytes and hands them to `send`; it refuses
// other chains, other accounts and a policy refusal; the fake devnet RPC answers the client's
// pinned endpoint with a VaultTransaction the domain check accepts.
const HOST = 'pqa-harness.test';

test('test wallet + fake devnet RPC', async ({ page }) => {
  const sk = ed25519.utils.randomSecretKey();
  const address = base58.encode(ed25519.getPublicKey(sk));
  const sent: Uint8Array[] = [];
  const wallet = await installDevnetWallet(page, {
    secretKey: sk,
    originHost: HOST,
    send: async (signed) => {
      sent.push(signed);
      return base58.encode(signed.subarray(1, 65));
    },
    approve: (req) => !(req.programs ?? []).includes('11111111111111111111111111111111'),
  });
  const index = 4n;
  const devnet: FakeDevnet = {
    requests: [],
    account: (a) =>
      a === squadsTransactionPda(MULTISIG, index)
        ? vaultTransactionAccount(MULTISIG, index, { creator: address, operation: OP, source: associatedTokenAddress(VAULT, PILOT_MINT), mint: PILOT_MINT, destination: associatedTokenAddress(ATTACKER, PILOT_MINT), authority: VAULT, amount: 1_500_000n, decimals: 6 })
        : null,
  };
  await routeDevnetRpc(page, devnet);
  await page.route(`https://${HOST}/**`, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>harness</title><p>harness</p>' }));
  await page.goto(`https://${HOST}/`);

  const funding = Array.from(base64.decode(encodeV0([transferCheckedIx()], address)));
  const vote = Array.from(base64.decode(encodeV0([approveIx()], address)));
  const system = Array.from(base64.decode(encodeV0([{ program: '11111111111111111111111111111111', accounts: [address, ATTACKER], data: [2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0] }], address)));
  const notMine = Array.from(base64.decode(encodeV0([transferCheckedIx()])));
  const out = await page.evaluate(
    async ({ funding, vote, system, notMine, pda }) => {
      const wallets: { name: string; chains: string[]; features: Record<string, Record<string, (...a: unknown[]) => Promise<unknown>>> }[] = [];
      const reg = { register: (...ws: never[]) => wallets.push(...ws) };
      window.addEventListener('wallet-standard:register-wallet', (e) => (e as CustomEvent).detail(reg));
      window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: reg }));
      const w = wallets.find((x) => x.chains.includes('solana:devnet'))!;
      const { accounts } = (await w.features['standard:connect']!.connect!()) as { accounts: { address: string }[] };
      const send = (tx: number[], chain = 'solana:devnet', account = accounts[0]) =>
        w.features['solana:signAndSendTransaction']!.signAndSendTransaction!({ account, chain, transaction: Uint8Array.from(tx) }).then(
          (r) => Array.from((r as { signature: Uint8Array }[])[0]!.signature),
          (e: Error) => e.message,
        );
      const rpc = async (method: string, params: unknown[]) =>
        (await (await fetch('https://api.devnet.solana.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json()) as { result: unknown };
      return {
        name: w.name,
        address: accounts[0]!.address,
        funding: await send(funding),
        vote: await send(vote),
        mainnet: await send(funding, 'solana:mainnet'),
        otherAccount: await send(funding, 'solana:devnet', { ...accounts[0]!, address: 'Mu1tisig11111111111111111111111111111111111' }),
        system: await send(system),
        notFeePayer: await send(notMine),
        genesis: (await rpc('getGenesisHash', [])).result,
        account: (await rpc('getAccountInfo', [pda, { encoding: 'base64', commitment: 'finalized' }])).result as { value: { owner: string; data: [string, string] } },
        missing: (await rpc('getAccountInfo', ['11111111111111111111111111111111', { encoding: 'base64' }])).result as { value: null },
        secretInPage: Object.keys(window).some((k) => /secret/i.test(k)),
      };
    },
    { funding, vote, system, notMine, pda: squadsTransactionPda(MULTISIG, index) },
  );

  expect(out.address).toBe(address);
  // Funding and vote: signed exactly in the fee-payer slot, sent, and the signature verifies over the message.
  expect(sent).toHaveLength(2);
  for (const [i, s] of sent.entries()) {
    expect(Array.isArray(i === 0 ? out.funding : out.vote)).toBe(true);
    expect(ed25519.verify(s.subarray(1, 65), s.subarray(65), base58.decode(address))).toBe(true);
    expect(Array.from(s.subarray(65))).toEqual((i === 0 ? funding : vote).slice(65));
  }
  expect(out.mainnet).toMatch(/chain solana:mainnet is not solana:devnet/);
  expect(out.otherAccount).toMatch(/not this wallet’s account/);
  expect(out.system).toMatch(/User rejected/);
  expect(out.notFeePayer).toMatch(/not the fee payer/);
  expect(out.genesis).toBe('EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
  expect(out.account.value.owner).toBe('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
  expect(verifyVaultTransfer(decodeVaultTransaction(base64.decode(out.account.value.data[0])), { multisig: MULTISIG, txIndex: 4, recipient: ATTACKER, amountUnits: 1_500_000, opId: OP })).toMatchObject({ amountUnits: 1_500_000 });
  expect(out.missing.value).toBeNull();
  expect(out.secretInPage).toBe(false);
  expect(wallet.log.filter((l) => !l.approved).map((l) => l.refused)).toEqual(['chain solana:mainnet is not solana:devnet', 'not this wallet’s account', 'policy']);
  expect(devnet.requests!.map((r) => r.method)).toEqual(['getGenesisHash', 'getAccountInfo', 'getAccountInfo']);
});
