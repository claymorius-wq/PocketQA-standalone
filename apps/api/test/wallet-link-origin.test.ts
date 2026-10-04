import { afterEach, describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { buildSiwsMessage, DEFAULT_SIWS_DOMAIN, type SiwsInput } from '@pocket-qa/contracts';
import { makeApp, type TestApp } from './helpers';

// Increment-4 review r1 P3 (origin binding): a web link message carries the app's real
// origin, so wallets that check SIWS domains see the page they are on. MWA keeps the fixed
// identity domain. The server verifies the exact stored text either way.
let t: TestApp;
afterEach(async () => t.close());

function key() {
  const sk = ed25519.utils.randomSecretKey();
  return { sk, address: base58.encode(ed25519.getPublicKey(sk)) };
}
const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const sign = (k: { sk: Uint8Array; address: string }, input: SiwsInput) => {
  const bytes = new TextEncoder().encode(buildSiwsMessage(input));
  return { address: k.address, nonce: input.nonce, signedMessage: b64(bytes), signature: b64(ed25519.sign(bytes, k.sk)) };
};

describe('link message origin', () => {
  it('web linking is bound to the public origin and links', async () => {
    t = await makeApp({ walletLogin: true }); // sets the public origin
    const u = await t.register('tester');
    const k = key();
    const input = (await t.req('POST', '/wallet/nonce', u.token, { address: k.address, surface: 'web' })).body.input as SiwsInput;
    expect(input).toMatchObject({ domain: 'app.pocketqa.example', uri: 'https://app.pocketqa.example' });
    expect((await t.req('POST', '/wallet/link', u.token, sign(k, input))).status).toBe(200);
  });

  it('MWA (default) keeps the fixed app identity domain', async () => {
    t = await makeApp({ walletLogin: true });
    const u = await t.register('tester');
    const input = (await t.req('POST', '/wallet/nonce', u.token, { address: key().address })).body.input as SiwsInput;
    expect(input.domain).toBe(DEFAULT_SIWS_DOMAIN);
  });

  it('web linking without a configured public origin is refused rather than using a domain no page has', async () => {
    t = await makeApp();
    const u = await t.register('tester');
    const r = await t.req('POST', '/wallet/nonce', u.token, { address: key().address, surface: 'web' });
    expect(r.status).toBe(409);
  });
});
