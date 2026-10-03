// Android-only (not .native): MWA's native module doesn't exist on iOS and loading it there crashes.
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol';
import { base58, base64 } from '@scure/base';
import { appIdentityUri, buildSiwsMessage, DEFAULT_SIWS_DOMAIN, SOLANA_DEVNET_CHAIN } from '@pocket-qa/contracts';
import { utf8Bytes } from '@pocket-qa/domain';
import { decodeWalletBase64, extractSignature } from './signature';
import { api } from '../api/client';

const identity = (domain: string) => ({ name: 'Pocket QA', uri: appIdentityUri(domain), icon: 'favicon.ico' });

/**
 * Links a devnet wallet with a Sign-In-With-Solana message over Mobile Wallet Adapter, in a
 * single MWA session: authorize → server nonce for that address → wallet signs the exact
 * server-built SIWS text (which shows the domain). Noncustodial: keys stay in the wallet;
 * Pocket QA only receives a signature over a single-use, devnet-bound message, which the
 * server verifies. Linking is not a payment.
 *
 * One session on purpose: a second back-to-back association (authorize, then re-authorize
 * with sign_in_payload) never connected on the Android emulator with Solana Mobile's mock
 * wallet and was cancelled after ~45 s (wallet log: new WebSocket server, no client).
 */
export async function linkWalletWithMwa(): Promise<void> {
  const signed = await transact(async (w) => {
    const auth = await w.authorize({ chain: SOLANA_DEVNET_CHAIN, identity: identity(DEFAULT_SIWS_DOMAIN) });
    const account = auth.accounts[0];
    if (!account) throw new Error('The wallet did not share an account.');
    const address = base58.encode(decodeWalletBase64(account.address));
    // Server-issued nonce, bound to this user, address, domain, devnet and an expiry.
    const { input } = await api('walletNonce', { body: { address } });
    const message = utf8Bytes(buildSiwsMessage(input));
    const res = await w.signMessages({ addresses: [account.address], payloads: [base64.encode(message)] });
    const sig = extractSignature(decodeWalletBase64(res.signed_payloads[0] ?? ''), message);
    return { address, nonce: input.nonce, signedMessage: base64.encode(message), signature: base64.encode(sig) };
  });
  // The server verifies the signature against its own stored message and consumes the nonce.
  await api('walletLink', { body: signed });
}
