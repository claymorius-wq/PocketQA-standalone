import { expect, test, type Page } from '@playwright/test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { createSignInMessageText } from '@solana/wallet-standard-util';

// Web wallet-first login against the real local API (ADR 0005 §2/§4). A fake Wallet
// Standard wallet behaves like a real one: it builds the SIWS text itself with the
// standard formatter, refuses a domain other than the page's, and signs with an ed25519
// key held in the test process. It also records signMessage, which login must never use.
const ORIGIN_HOST = 'localhost:8090';

async function installWallet(page: Page, opts: { signIn: boolean; sk?: Uint8Array; allowSignMessage?: boolean; name?: string }) {
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

test('wallet sign-in: first time creates an account (two signIn signatures), then signs straight in', async ({ page }) => {
  const { address, log, sk } = await installWallet(page, { signIn: true });
  await page.goto('/sign-in');
  await page.getByTestId('sign-in-wallet').click();
  // No account uses this wallet yet: offered to create one.
  await expect(page.getByTestId('finish-account')).toContainText('Create an account with this wallet');
  await page.getByTestId('finish-name').fill('Wally Wallet');
  await page.getByTestId('finish-submit').click();
  await expect(page.getByTestId('discover-screen')).toBeVisible();
  expect(log.signIn).toHaveLength(2);
  for (const input of log.signIn) {
    expect(input).toMatchObject({ domain: ORIGIN_HOST, uri: 'http://localhost:8090', address, chainId: 'solana:devnet', version: '1' });
    expect(input.statement).toMatch(/Only sign this on localhost:8090/);
  }
  expect(new Set(log.signIn.map((i) => i.nonce)).size).toBe(2); // fresh challenge each time
  expect(log.signMessage).toBe(0);

  // Returning user, fresh browser context, same wallet key: one signature, straight in.
  const ctx2 = await page.context().browser()!.newContext({ baseURL: 'http://localhost:8090' });
  const page2 = await ctx2.newPage();
  const again = await installWallet(page2, { signIn: true, sk });
  expect(again.address).toBe(address);
  await page2.goto('/sign-in');
  await page2.getByTestId('sign-in-wallet').click();
  await expect(page2.getByTestId('discover-screen')).toBeVisible();
  expect(again.log.signIn).toHaveLength(1);
  expect(again.log.signMessage).toBe(0);
  await ctx2.close();
});

test('a wallet without Sign In With Solana is refused honestly (no signMessage fallback)', async ({ page }) => {
  const { log } = await installWallet(page, { signIn: false });
  await page.goto('/sign-in');
  await page.getByTestId('sign-in-wallet').click();
  await expect(page.getByTestId('sign-in-error')).toContainText('doesn’t support Sign In With Solana');
  expect(log.signMessage).toBe(0);
  expect(log.signIn).toHaveLength(0);
});

test('web wallet linking: the link message carries this origin, so a domain-checking wallet signs it', async ({ page, request }) => {
  const email = `link-${Date.now()}@example.test`;
  const pw = 'correct horse battery staple';
  const reg = await request.post('http://127.0.0.1:8787/auth/register', { data: { email, password: pw, displayName: 'Linda Link', role: 'tester' } });
  expect(reg.status()).toBe(200);
  const { address, log } = await installWallet(page, { signIn: true, allowSignMessage: true });
  await page.goto('/sign-in');
  await page.getByTestId('sign-in-email').fill(email);
  await page.getByTestId('sign-in-password').fill(pw);
  await page.getByTestId('sign-in-submit').click();
  await expect(page.getByTestId('discover-screen')).toBeVisible();
  await page.getByTestId('tab-settings').click();
  await page.getByTestId('wallet-link').click();
  await expect(page.getByTestId('wallet-address')).toContainText(address);
  expect(log.signMessage).toBe(1);
  expect(log.signIn).toHaveLength(0); // linking never uses the login feature
});

test('wallet chooser: with two wallets installed, the user picks one; only that wallet signs, then it is disconnected (ledger W1)', async ({ page }) => {
  const first = await installWallet(page, { signIn: true, name: 'Alpha Wallet' });
  const second = await installWallet(page, { signIn: true, name: 'Beta Wallet' });
  await page.goto('/sign-in');
  await expect(page.getByText('Continue with Alpha Wallet')).toBeVisible();
  await page.getByText('Continue with Beta Wallet').click();
  await expect(page.getByTestId('finish-account')).toContainText('Create an account with this wallet');
  await page.getByTestId('finish-name').fill('Bea Beta');
  await page.getByTestId('finish-submit').click();
  await expect(page.getByTestId('discover-screen')).toBeVisible();
  // Both signatures (lookup, then create) came from the chosen wallet; the other was never asked.
  expect(second.log.signIn).toHaveLength(2);
  expect(first.log.signIn).toHaveLength(0);
  expect(second.log.disconnect).toBe(2);
  expect(first.log.disconnect).toBe(0);
  // Settings shows the account's linked wallet and the protected unlink rule (wallet-only account).
  await page.getByTestId('tab-settings').click();
  await expect(page.getByTestId('wallet-address')).toContainText(second.address);
  await page.getByTestId('wallet-unlink').click();
  await expect(page.getByTestId('wallet-error')).toBeVisible();
  await expect(page.getByTestId('wallet-address')).toContainText(second.address);
});
