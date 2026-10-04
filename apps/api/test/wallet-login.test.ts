import { afterEach, describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { buildSiwsMessage, WALLET_NONCE_TTL_SECONDS, WalletLoginResponse, type SiwsInput } from '@pocket-qa/contracts';
import { makeApp, type TestApp } from './helpers';

// ADR 0005 §2: wallet-first login. A separate, purpose-bound, single-use challenge; the
// wallet resolves only to its linked account; accounts are created only on request.
let t: TestApp;
afterEach(async () => t.close());

function wallet() {
  const sk = ed25519.utils.randomSecretKey();
  return { sk, address: base58.encode(ed25519.getPublicKey(sk)) };
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

function signed(w: { sk: Uint8Array; address: string }, input: SiwsInput, tamper?: (m: string) => string) {
  const text = tamper ? tamper(buildSiwsMessage(input)) : buildSiwsMessage(input);
  const bytes = new TextEncoder().encode(text);
  return { address: w.address, nonce: input.nonce, signedMessage: b64(bytes), signature: b64(ed25519.sign(bytes, w.sk)) };
}

async function challenge(w: { address: string }) {
  const r = await t.req('POST', '/auth/wallet/challenge', undefined, { address: w.address });
  expect(r.status).toBe(200);
  return r.body.input as SiwsInput;
}

async function walletLogin(w: { sk: Uint8Array; address: string }, newAccount?: { role: 'tester' | 'builder'; displayName: string }) {
  const input = await challenge(w);
  return t.req('POST', '/auth/wallet/login', undefined, { ...signed(w, input), ...(newAccount ? { newAccount } : {}) });
}

describe('wallet-first login (local auth mode)', () => {
  it('creates an account only on request, then signs the same account in', async () => {
    t = await makeApp({ walletLogin: true });
    const w = wallet();
    const none = await walletLogin(w);
    expect(none.status).toBe(404);
    const created = await walletLogin(w, { role: 'tester', displayName: 'Wally' });
    expect(created.status).toBe(200);
    const body = WalletLoginResponse.parse(created.body);
    expect(body.user).toMatchObject({ role: 'tester', displayName: 'Wally', wallet: { address: w.address } });
    expect(body.session.kind).toBe('local');
    const token = body.session.kind === 'local' ? body.session.token : '';
    expect((await t.req('GET', '/me', token)).body.id).toBe(body.user.id);
    // Returning user: same account; a newAccount request is ignored for a linked wallet.
    const again = WalletLoginResponse.parse((await walletLogin(w, { role: 'builder', displayName: 'Other' })).body);
    expect(again.user.id).toBe(body.user.id);
    expect(again.user.role).toBe('tester');
  });

  it('the challenge is bound to the real public origin and says sign-in, not payment (review r1 P2)', async () => {
    t = await makeApp({ walletLogin: true });
    const input = await challenge(wallet());
    // Domain and URI are the deployment's real origin, so a solana:signIn wallet can check them.
    expect(input.domain).toBe('app.pocketqa.example');
    expect(input.uri).toBe('https://app.pocketqa.example');
    expect(input.statement).toMatch(/Sign in to Pocket QA at https:\/\/app\.pocketqa\.example/);
    expect(input.statement).toMatch(/Only sign this on app\.pocketqa\.example/);
    expect(input.statement).toMatch(/not a payment/);
    expect(input.chainId).toBe('solana:devnet');
  });

  it('a signature over another domain (a phishing origin) is refused (review r1 P2)', async () => {
    t = await makeApp({ walletLogin: true });
    const w = wallet();
    await walletLogin(w, { role: 'tester', displayName: 'W' });
    const input = await challenge(w);
    const phished = { ...input, domain: 'evil.example', uri: 'https://evil.example' };
    expect((await t.req('POST', '/auth/wallet/login', undefined, signed(w, phished))).body.code).toBe('NONCE_INVALID');
  });

  it('admin accounts cannot sign in with a wallet (review r1 P3)', async () => {
    t = await makeApp({ walletLogin: true });
    const adm = await t.admin();
    const w = wallet();
    const linkInput = (await t.req('POST', '/wallet/nonce', adm.token, { address: w.address })).body.input as SiwsInput;
    expect((await t.req('POST', '/wallet/link', adm.token, signed(w, linkInput))).status).toBe(200);
    const r = await walletLogin(w);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('FORBIDDEN_ROLE');
  });

  it('is single use: replay, tampered message, wrong key and wrong address all fail, and burn the challenge', async () => {
    t = await makeApp({ walletLogin: true });
    const w = wallet();
    await walletLogin(w, { role: 'tester', displayName: 'W' });
    const input = await challenge(w);
    const good = signed(w, input);
    expect((await t.req('POST', '/auth/wallet/login', undefined, good)).status).toBe(200);
    expect((await t.req('POST', '/auth/wallet/login', undefined, good)).body.code).toBe('NONCE_INVALID'); // replay

    const i2 = await challenge(w);
    const tampered = signed(w, i2, (m) => m.replace('Sign in to Pocket QA', 'Sign in to Evil QA'));
    expect((await t.req('POST', '/auth/wallet/login', undefined, tampered)).body.code).toBe('NONCE_INVALID');
    expect((await t.req('POST', '/auth/wallet/login', undefined, signed(w, i2))).body.code).toBe('NONCE_INVALID'); // burnt

    const i3 = await challenge(w);
    const other = wallet();
    expect((await t.req('POST', '/auth/wallet/login', undefined, { ...signed(other, i3), address: w.address })).body.code).toBe('NONCE_INVALID');
    const i4 = await challenge(w);
    expect((await t.req('POST', '/auth/wallet/login', undefined, { ...signed(w, i4), address: other.address })).body.code).toBe('NONCE_INVALID');
  });

  it('expires', async () => {
    t = await makeApp({ walletLogin: true });
    const w = wallet();
    const input = await challenge(w);
    t.clock.now += WALLET_NONCE_TTL_SECONDS * 1000;
    expect((await t.req('POST', '/auth/wallet/login', undefined, { ...signed(w, input), newAccount: { role: 'tester', displayName: 'W' } })).body.code).toBe('NONCE_INVALID');
  });

  it('link nonces and login challenges are not interchangeable', async () => {
    t = await makeApp({ walletLogin: true });
    const user = await t.register('tester');
    const w = wallet();
    const linkInput = (await t.req('POST', '/wallet/nonce', user.token, { address: w.address })).body.input as SiwsInput;
    expect((await t.req('POST', '/auth/wallet/login', undefined, { ...signed(w, linkInput), newAccount: { role: 'tester', displayName: 'W' } })).body.code).toBe('NONCE_INVALID');
    const loginInput = await challenge(w);
    expect((await t.req('POST', '/wallet/link', user.token, signed(w, loginInput))).body.code).toBe('NONCE_INVALID');
  });

  it('a wallet linked to an existing account signs in to that account only', async () => {
    t = await makeApp({ walletLogin: true });
    const owner = await t.register('builder');
    const w = wallet();
    const linkInput = (await t.req('POST', '/wallet/nonce', owner.token, { address: w.address })).body.input as SiwsInput;
    expect((await t.req('POST', '/wallet/link', owner.token, signed(w, linkInput))).status).toBe(200);
    const r = WalletLoginResponse.parse((await walletLogin(w, { role: 'tester', displayName: 'Hijack' })).body);
    expect(r.user.id).toBe(owner.id);
    expect(r.user.role).toBe('builder');
  });

  it('a wallet-only account cannot unlink its only sign-in method', async () => {
    t = await makeApp({ walletLogin: true });
    const w = wallet();
    const r = WalletLoginResponse.parse((await walletLogin(w, { role: 'tester', displayName: 'W' })).body);
    const token = r.session.kind === 'local' ? r.session.token : '';
    const unlink = await t.req('DELETE', '/wallet', token);
    expect(unlink.status).toBe(409);
    expect((await t.req('GET', '/me', token)).body.wallet.address).toBe(w.address);
    // A password account can still unlink its wallet as before.
    const pw = await t.register('tester');
    expect((await t.req('DELETE', '/wallet', pw.token)).status).toBe(200);
  });

  it('rate-limits challenges per address and client, so another client cannot lock the owner out (review r1 P3)', async () => {
    t = await makeApp({ walletLogin: true });
    const w = wallet();
    const ask = (ip: string) => t.req('POST', '/auth/wallet/challenge', undefined, { address: w.address }, {}, ip);
    for (let i = 0; i < 5; i += 1) expect((await ask('203.0.113.9')).status).toBe(200);
    expect((await ask('203.0.113.9')).status).toBe(429);
    expect((await ask('198.51.100.20')).status).toBe(200); // the wallet's owner, elsewhere
    t.clock.now += 61_000;
    expect((await ask('203.0.113.9')).status).toBe(200);
  });

  it('is off unless enabled', async () => {
    t = await makeApp();
    expect((await t.req('POST', '/auth/wallet/challenge', undefined, { address: wallet().address })).status).toBe(409);
    expect((await t.req('GET', '/config')).body.walletLogin).toBe(false);
  });
});

describe('wallet-first login (firebase mode)', () => {
  it('returns a Firebase custom token for the account; only the exchanged ID token works as a bearer', async () => {
    t = await makeApp({ authMode: 'firebase', walletLogin: true });
    const w = wallet();
    const r = WalletLoginResponse.parse((await walletLogin(w, { role: 'builder', displayName: 'Fb' })).body);
    expect(r.session.kind).toBe('firebase_custom_token');
    const custom = r.session.kind === 'firebase_custom_token' ? r.session.customToken : '';
    expect((await t.req('GET', '/me', custom)).status).toBe(401);
    const idToken = t.identity.exchangeCustomToken(custom);
    expect((await t.req('GET', '/me', idToken)).body.id).toBe(r.user.id);
    expect((await t.req('GET', '/config')).body.walletLogin).toBe(true);
    // Wallet-only: a custom (wallet) sign-in is not a recovery method, so unlink is refused.
    expect((await t.req('DELETE', '/wallet', idToken)).status).toBe(409);
  });

  it('signing in to an email account with its linked wallet uses that account’s UID', async () => {
    t = await makeApp({ authMode: 'firebase', walletLogin: true });
    const google = t.identity.idToken({ uid: 'g-uid', email: 'g@example.test', email_verified: true, provider: 'google.com' });
    const acct = (await t.req('POST', '/auth/identity/session', google, { newAccount: { role: 'tester', displayName: 'G' } })).body.user;
    const w = wallet();
    const linkInput = (await t.req('POST', '/wallet/nonce', google, { address: w.address })).body.input as SiwsInput;
    expect((await t.req('POST', '/wallet/link', google, signed(w, linkInput))).status).toBe(200);
    const r = WalletLoginResponse.parse((await walletLogin(w)).body);
    const custom = r.session.kind === 'firebase_custom_token' ? r.session.customToken : '';
    const idToken = t.identity.exchangeCustomToken(custom);
    expect((await t.req('GET', '/me', idToken)).body.id).toBe(acct.id);
    // This account has a verified Google sign-in, so unlinking the wallet is allowed.
    expect((await t.req('DELETE', '/wallet', google)).status).toBe(200);
  });
});
