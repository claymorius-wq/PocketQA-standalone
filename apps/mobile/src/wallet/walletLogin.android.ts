// Android-only (not .native): MWA's native module doesn't exist on iOS and loading it there crashes.
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol';
import { base58, base64 } from '@scure/base';
import { appIdentityUri, buildSiwsMessage, DEFAULT_SIWS_DOMAIN, SOLANA_DEVNET_CHAIN, type WalletLoginResponse } from '@pocket-qa/contracts';
import { utf8Bytes } from '@pocket-qa/domain';
import { api } from '../api/client';
import { decodeWalletBase64, extractSignature } from './signature';

const identity = { name: 'Pocket QA', uri: appIdentityUri(DEFAULT_SIWS_DOMAIN), icon: 'favicon.ico' };

/**
 * Android wallet-first login over Mobile Wallet Adapter (docs/production/wallet-login-design.md).
 * One MWA session, like linking: authorize → server challenge for that address bound to the
 * app identity (`surface: 'mwa'`) → the wallet signs the exact server-built SIWS text, which
 * shows the domain and says it is not a payment → the server verifies its own stored text,
 * burns the challenge and returns a session. Never a transaction; keys stay in the wallet.
 */
export async function walletLoginFlow(opts: { newAccount?: { role: 'tester' | 'builder'; displayName: string } } = {}): Promise<WalletLoginResponse> {
  const signed = await transact(async (w) => {
    const auth = await w.authorize({ chain: SOLANA_DEVNET_CHAIN, identity });
    const account = auth.accounts[0];
    if (!account) throw new Error('The wallet did not share an account.');
    const address = base58.encode(decodeWalletBase64(account.address));
    const { input } = await api('walletLoginChallenge', { body: { address, surface: 'mwa' }, token: null });
    const message = utf8Bytes(buildSiwsMessage(input));
    const res = await w.signMessages({ addresses: [account.address], payloads: [base64.encode(message)] });
    const sig = extractSignature(decodeWalletBase64(res.signed_payloads[0] ?? ''), message);
    return { address, nonce: input.nonce, signedMessage: base64.encode(message), signature: base64.encode(sig) };
  });
  return api('walletLogin', { body: { ...signed, ...(opts.newAccount ? { newAccount: opts.newAccount } : {}) }, token: null });
}
