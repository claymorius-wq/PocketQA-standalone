import type { Page } from '@playwright/test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { createSignInMessageText } from '@solana/wallet-standard-util';

// A fake Wallet Standard wallet for the web E2E (moved from wallet-login.spec.ts): it builds the
// SIWS text itself with the standard formatter, refuses a domain other than the page's, signs with
// an ed25519 key held in the test process, and records signMessage.
export const ORIGIN_HOST = 'localhost:8090';

export async function installWallet(page: Page, opts: { signIn: boolean; sk?: Uint8Array; allowSignMessage?: boolean; name?: string }) {
  const tag = (opts.name ?? 'Test Wallet').replace(/\W/g, '');
  const sk = opts.sk ?? ed25519.utils.randomSecretKey();
  const address = base58.encode(ed25519.getPublicKey(sk));
  const log = { signIn: [] as Record<string, string>[], signMessage: 0, disconnect: 0 };
  await page.exposeFunction(`pqaWalletDisconnect${tag}`, () => {
    log.disconnect += 1;
  });
  await page.exposeFunction(`pqaWalletSignIn${tag}`, (input: Record<string, string>) => {
    log.signIn.push(input);
    if (input.domain !== ORIGIN_HOST) throw new Error(`domain mismatch: ${input.domain}`); // what a real wallet checks
    const text = createSignInMessageText(input as never);
    const bytes = new TextEncoder().encode(text);
    return { address, message: Buffer.from(bytes).toString('base64'), signature: Buffer.from(ed25519.sign(bytes, sk)).toString('base64') };
  });
  await page.exposeFunction(`pqaWalletSignMessage${tag}`, (messageB64: string) => {
    log.signMessage += 1;
    if (!opts.allowSignMessage) throw new Error('signMessage must not be used for login');
    const bytes = Buffer.from(messageB64, 'base64');
    // Like Phantom: SIWS-formatted text is checked against the requesting page's domain.
    const m = /^(.+) wants you to sign in with your Solana account:/.exec(bytes.toString('utf8'));
    if (m && m[1] !== ORIGIN_HOST) throw new Error(`domain mismatch: ${m[1]}`);
    return { signature: Buffer.from(ed25519.sign(bytes, sk)).toString('base64') };
  });
  await page.addInitScript(
    ({ address, withSignIn, name, tag }) => {
      const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
      const account = { address, publicKey: new Uint8Array(32), chains: ['solana:devnet'], features: ['solana:signIn', 'solana:signMessage'] };
      const fns = window as unknown as Record<string, (...a: unknown[]) => Promise<never>>;
      const w = {
        pqaWalletSignIn: (i: unknown) => fns[`pqaWalletSignIn${tag}`]!(i) as Promise<{ address: string; message: string; signature: string }>,
        pqaWalletSignMessage: (m: string) => fns[`pqaWalletSignMessage${tag}`]!(m) as Promise<{ signature: string }>,
        pqaWalletDisconnect: () => fns[`pqaWalletDisconnect${tag}`]!(),
      };
      const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
      const features: Record<string, unknown> = {
        'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [account] }) },
        'standard:events': { version: '1.0.0', on: () => () => {} },
        'standard:disconnect': { version: '1.0.0', disconnect: async () => void (await w.pqaWalletDisconnect()) },
        'solana:signMessage': {
          version: '1.0.0',
          signMessage: async ({ message }: { message: Uint8Array }) => {
            const out = await w.pqaWalletSignMessage(toB64(message));
            return [{ signedMessage: message, signature: b64(out.signature) }];
          },
        },
      };
      if (withSignIn) {
        features['solana:signIn'] = {
          version: '1.0.0',
          signIn: async (input: unknown) => {
            const out = await w.pqaWalletSignIn(input);
            return [{ account, signedMessage: b64(out.message), signature: b64(out.signature) }];
          },
        };
      }
      const wallet = { version: '1.0.0', name, icon: 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E', chains: ['solana:devnet'], features, accounts: [] };
      const register = (api: { register: (w: unknown) => unknown }) => api.register(wallet);
      window.addEventListener('wallet-standard:app-ready', (e) => register((e as CustomEvent).detail));
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
    },
    { address, withSignIn: opts.signIn, name: opts.name ?? 'Test Wallet', tag },
  );
  return { address, log, sk };
}
