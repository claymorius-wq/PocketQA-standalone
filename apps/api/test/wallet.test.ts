import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { buildSiwsMessage, WALLET_NONCE_TTL_SECONDS, type SiwsInput } from '@pocket-qa/contracts';
import type { ParsedTx } from '@pocket-qa/domain';
import { makeApp, seeded, type TestApp } from './helpers';

let t: TestApp;
beforeEach(async () => {
  t = await makeApp();
});
afterEach(async () => t.close());

function keypair() {
  const sk = ed25519.utils.randomSecretKey();
  return { sk, address: base58.encode(ed25519.getPublicKey(sk)) };
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

function signIn(input: SiwsInput, sk: Uint8Array, text = buildSiwsMessage(input)) {
  const bytes = new TextEncoder().encode(text);
  return { address: input.address, nonce: input.nonce, signedMessage: b64(bytes), signature: b64(ed25519.sign(bytes, sk)) };
}

async function link(token: string, kp = keypair()) {
  const { input } = (await t.req('POST', '/wallet/nonce', token, { address: kp.address })).body;
  return { kp, input: input as SiwsInput, res: await t.req('POST', '/wallet/link', token, signIn(input, kp.sk)) };
}

describe('wallet link (SIWS, devnet)', () => {
  it('issues a devnet-bound, expiring SIWS input and links on a valid signature', async () => {
    const u = await t.register('tester');
    const { input, res, kp } = await link(u.token);
    expect(input.chainId).toBe('solana:devnet');
    expect(input.domain).toBe('pocketqa.local');
    expect(Date.parse(input.expirationTime) - Date.parse(input.issuedAt)).toBe(WALLET_NONCE_TTL_SECONDS * 1000);
    expect(res.status).toBe(200);
    expect(res.body.wallet).toMatchObject({ address: kp.address, cluster: 'devnet' });
  });

  it('rejects replay of a used nonce', async () => {
    const u = await t.register('tester');
    const kp = keypair();
    const { input } = (await t.req('POST', '/wallet/nonce', u.token, { address: kp.address })).body;
    const body = signIn(input, kp.sk);
    expect((await t.req('POST', '/wallet/link', u.token, body)).status).toBe(200);
    const replay = await t.req('POST', '/wallet/link', u.token, body);
    expect(replay.status).toBe(400);
    expect(replay.body.code).toBe('NONCE_INVALID');
  });

  it('burns the nonce even when the first attempt fails', async () => {
    const u = await t.register('tester');
    const kp = keypair();
    const { input } = (await t.req('POST', '/wallet/nonce', u.token, { address: kp.address })).body;
    const bad = signIn(input, keypair().sk);
    expect((await t.req('POST', '/wallet/link', u.token, bad)).body.code).toBe('NONCE_INVALID');
    expect((await t.req('POST', '/wallet/link', u.token, signIn(input, kp.sk))).body.code).toBe('NONCE_INVALID');
  });

  it('rejects cross-account use, expiry, wrong domain and wrong network', async () => {
    const a = await t.register('tester');
    const b = await t.register('tester');
    const kp = keypair();
    const { input } = (await t.req('POST', '/wallet/nonce', a.token, { address: kp.address })).body;
    expect((await t.req('POST', '/wallet/link', b.token, signIn(input, kp.sk))).body.code).toBe('NONCE_INVALID');

    const n2 = (await t.req('POST', '/wallet/nonce', a.token, { address: kp.address })).body.input;
    expect((await t.req('POST', '/wallet/link', a.token, signIn(n2, kp.sk, buildSiwsMessage({ ...n2, domain: 'evil.example' })))).body.code).toBe('NONCE_INVALID');
    const n3 = (await t.req('POST', '/wallet/nonce', a.token, { address: kp.address })).body.input;
    expect((await t.req('POST', '/wallet/link', a.token, signIn(n3, kp.sk, buildSiwsMessage({ ...n3, chainId: 'solana:mainnet' })))).body.code).toBe('NONCE_INVALID');

    const n4 = (await t.req('POST', '/wallet/nonce', a.token, { address: kp.address })).body.input;
    t.clock.now += WALLET_NONCE_TTL_SECONDS * 1000;
    expect((await t.req('POST', '/wallet/link', a.token, signIn(n4, kp.sk))).body.code).toBe('NONCE_INVALID');
    expect((await t.req('GET', '/me', a.token)).body.wallet).toBeNull();
  });

  it('one address links to one account; unlink works', async () => {
    const a = await t.register('tester');
    const b = await t.register('builder');
    const { kp } = await link(a.token);
    const second = await link(b.token, kp);
    expect(second.res.status).toBe(409);
    const un = await t.req('DELETE', '/wallet', a.token);
    expect(un.body.wallet).toBeNull();
    expect((await link(b.token, kp)).res.status).toBe(200);
  });
});

describe('devnet demo transfer', () => {
  async function approvedWithWallets() {
    const s = await seeded(t);
    await t.req('POST', `/participations/${s.participationId}/submit`, s.tester.token);
    await t.req('POST', `/participations/${s.participationId}/approve`, s.builder.token, {});
    const bw = await link(s.builder.token);
    const tw = await link(s.tester.token);
    return { ...s, sender: bw.kp.address, recipient: tw.kp.address };
  }

  const SIG = '4'.repeat(88);
  function tx(sender: string, recipient: string, lamports: number, blockTime: number | null, err: unknown = null): ParsedTx {
    return {
      slot: 1,
      blockTime,
      meta: { err },
      transaction: {
        signatures: [SIG],
        message: { instructions: [{ program: 'system', parsed: { type: 'transfer', info: { source: sender, destination: recipient, lamports } } }] },
      },
    };
  }

  it('refuses to start if the RPC is not devnet', async () => {
    const s = await approvedWithWallets();
    t.rpc.genesis = '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d';
    const r = await t.req('POST', '/devnet/transfers', s.builder.token, { participationId: s.participationId });
    expect(r.status).toBe(503);
    expect(r.body.code).toBe('CHAIN_UNAVAILABLE');
  });

  it('server fixes sender/recipient/amount; signature stays pending until the chain confirms', async () => {
    const s = await approvedWithWallets();
    const intent = (await t.req('POST', '/devnet/transfers', s.builder.token, { participationId: s.participationId, recipient: s.sender, lamports: 1 })).body;
    expect(intent).toMatchObject({ status: 'awaiting_signature', sender: s.sender, recipient: s.recipient, lamports: 1_000_000, explorerUrl: null });

    const pending = (await t.req('POST', `/devnet/transfers/${intent.id}/signature`, s.builder.token, { signature: SIG })).body;
    expect(pending.status).toBe('pending');
    expect(pending.explorerUrl).toBe(`https://explorer.solana.com/tx/${SIG}?cluster=devnet`);

    t.rpc.txs.set(SIG, tx(s.sender, s.recipient, 1_000_000, t.clock.now / 1000 + 5));
    const confirmed = (await t.req('GET', `/devnet/transfers/${intent.id}`, s.tester.token)).body;
    expect(confirmed.status).toBe('confirmed');
    expect(confirmed.verifiedAt).not.toBeNull();
  });

  it('marks a mismatched transaction failed, and refuses signature reuse', async () => {
    const s = await approvedWithWallets();
    const intent = (await t.req('POST', '/devnet/transfers', s.builder.token, { participationId: s.participationId })).body;
    t.rpc.txs.set(SIG, tx(s.sender, s.recipient, 5, t.clock.now / 1000 + 5));
    const r = (await t.req('POST', `/devnet/transfers/${intent.id}/signature`, s.builder.token, { signature: SIG })).body;
    expect(r.status).toBe('failed');
    expect(r.failureReason).toMatch(/expected sender, recipient and amount/);
    // A failed intent frees the slot for a new one, but the same signature can't be reused.
    const intent2 = (await t.req('POST', '/devnet/transfers', s.builder.token, { participationId: s.participationId })).body;
    const reuse = await t.req('POST', `/devnet/transfers/${intent2.id}/signature`, s.builder.token, { signature: SIG });
    expect(reuse.status).toBe(409);
  });

  it('expires when nothing lands on chain in time, and stays pending while RPC is down', async () => {
    const s = await approvedWithWallets();
    const intent = (await t.req('POST', '/devnet/transfers', s.builder.token, { participationId: s.participationId })).body;
    await t.req('POST', `/devnet/transfers/${intent.id}/signature`, s.builder.token, { signature: SIG });
    t.rpc.fail = true;
    const down = await t.req('GET', `/devnet/transfers/${intent.id}`, s.builder.token);
    expect(down.status).toBe(503);
    const stored = t.db.prepare('SELECT status FROM devnet_transfers WHERE id = ?').get(intent.id) as { status: string };
    expect(stored.status).toBe('pending');
    t.rpc.fail = false;
    t.clock.now += 4 * 60 * 1000;
    expect((await t.req('GET', `/devnet/transfers/${intent.id}`, s.builder.token)).body.status).toBe('expired');
  });

  it('only for approved work, and only when both wallets are linked', async () => {
    const s = await seeded(t);
    const r = await t.req('POST', '/devnet/transfers', s.builder.token, { participationId: s.participationId });
    expect(r.status).toBe(409);
  });
});
