import type { Page } from '@playwright/test';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { createSignInMessageText } from '@solana/wallet-standard-util';
import { decodeServerTx } from '@pocket-qa/domain';

// A Wallet Standard TEST wallet for the devnet browser journey (test tooling, never app code).
// - The key lives in this Node process only (a throwaway key for local runs; for a hosted run the
//   fixture is loaded in memory by the caller and never printed). The page holds the public key.
// - Chain must be solana:devnet; only this wallet's account signs; every request is logged.
// - signAndSendTransaction signs a v0/legacy message's fee-payer slot here, then hands the signed
//   bytes to `send` (local: the fake devnet behind the connectors seam; hosted: a devnet RPC).
export const DEVNET = 'solana:devnet';

export type WalletLogEntry = { kind: string; chain?: string; bytes?: number; approved: boolean; refused?: string; signature?: string };
export type DevnetWalletOptions = {
  secretKey: Uint8Array;
  name?: string;
  /** The page's host, as a real wallet checks a sign-in request's domain against it. */
  originHost: string;
  send: (signed: Uint8Array) => Promise<string>;
  /** Refuse a request (reported to the app as a user rejection). */
  approve?: (req: { kind: string; bytes?: number; programs?: string[] }) => boolean;
};

/** Signs the first signature slot (the fee payer) of a serialized transaction; refuses any other signer layout. */
export function signFeePayerSlot(tx: Uint8Array, secretKey: Uint8Array): { signed: Uint8Array; signature: Uint8Array } {
  const decoded = decodeServerTx(Buffer.from(tx).toString('base64'));
  const address = base58.encode(ed25519.getPublicKey(secretKey));
  if (decoded.feePayer !== address) throw new Error('refusing: this wallet is not the fee payer');
  if (decoded.requiredSignatures !== 1 || tx[0] !== 1) throw new Error('refusing: the transaction needs other signers');
  const message = tx.subarray(1 + 64);
  const signature = ed25519.sign(message, secretKey);
  const signed = Uint8Array.from(tx);
  signed.set(signature, 1);
  return { signed, signature };
}

export async function installDevnetWallet(page: Page, opts: DevnetWalletOptions) {
  const address = base58.encode(ed25519.getPublicKey(opts.secretKey));
  const log: WalletLogEntry[] = [];
  const approve = opts.approve ?? (() => true);
  const guard = (kind: string, chain: string | null, account: string | null, extra: Omit<WalletLogEntry, 'kind' | 'approved'> & { programs?: string[] } = {}) => {
    const { programs, ...rest } = extra;
    const refuse = (why: string) => {
      log.push({ kind, chain: chain ?? DEVNET, ...rest, approved: false, refused: why });
      return new Error(`refusing ${kind}: ${why}`);
    };
    if (chain && chain !== DEVNET) throw refuse(`chain ${chain} is not ${DEVNET}`);
    if (account && account !== address) throw refuse('not this wallet’s account');
    if (approve({ kind, ...(rest.bytes !== undefined ? { bytes: rest.bytes } : {}), ...(programs ? { programs } : {}) }) === false) {
      log.push({ kind, chain: chain ?? DEVNET, ...rest, approved: false, refused: 'policy' });
      throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
    }
    log.push({ kind, chain: chain ?? DEVNET, ...rest, approved: true });
  };

  await page.exposeFunction('__pqaDevnetWallet', async (kind: string, payload: Record<string, unknown>) => {
    if (kind === 'connect') {
      log.push({ kind, approved: true });
      return { address, publicKey: Array.from(base58.decode(address)) };
    }
    if (kind === 'disconnect') {
      log.push({ kind, approved: true });
      return null;
    }
    if (kind === 'signIn') {
      const input = payload.input as Record<string, string>;
      if (input.domain !== opts.originHost) throw new Error(`refusing signIn: domain ${input.domain} is not ${opts.originHost}`);
      if (input.address && input.address !== address) throw new Error('refusing signIn: another address');
      const text = new TextEncoder().encode(createSignInMessageText({ ...input, address } as never));
      guard(kind, null, null, { bytes: text.length });
      return { signedMessage: Array.from(text), signature: Array.from(ed25519.sign(text, opts.secretKey)) };
    }
    if (kind === 'signMessage') {
      const message = Uint8Array.from(payload.message as number[]);
      guard(kind, null, payload.account as string, { bytes: message.length });
      return { signedMessage: Array.from(message), signature: Array.from(ed25519.sign(message, opts.secretKey)) };
    }
    if (kind === 'signAndSendTransaction') {
      const tx = Uint8Array.from(payload.transaction as number[]);
      const programs = decodeServerTx(Buffer.from(tx).toString('base64')).programIds;
      guard(kind, payload.chain as string, payload.account as string, { bytes: tx.length, programs });
      const { signed, signature } = signFeePayerSlot(tx, opts.secretKey);
      const sent = await opts.send(signed);
      if (sent !== base58.encode(signature)) throw new Error('the network returned another signature');
      log.push({ kind: 'sent', chain: DEVNET, signature: sent, approved: true });
      return { signature: Array.from(signature) };
    }
    throw new Error(`unsupported wallet request ${kind}`);
  });

  await page.addInitScript((walletName: string) => {
    type Bridge = (kind: string, payload: unknown) => Promise<Record<string, number[] | string> | null>;
    const call = (kind: string, payload: unknown) => (window as unknown as { __pqaDevnetWallet: Bridge }).__pqaDevnetWallet(kind, payload);
    const u8 = (a: unknown) => Uint8Array.from(a as number[]);
    const CHAINS = ['solana:devnet'];
    const FEATURES = ['solana:signIn', 'solana:signMessage', 'solana:signAndSendTransaction'];
    let accounts: unknown[] = [];
    const listeners = new Set<(e: unknown) => void>();
    const account = (a: Record<string, unknown>) => ({ address: a.address, publicKey: u8(a.publicKey), chains: CHAINS, features: FEATURES, label: walletName });
    const emit = () => listeners.forEach((l) => l({ accounts }));
    const connect = async () => {
      accounts = [account((await call('connect', {}))!)];
      emit();
      return { accounts };
    };
    const wallet = {
      version: '1.0.0',
      name: walletName,
      icon: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="#3640c8"/></svg>'),
      chains: CHAINS,
      get accounts() {
        return accounts;
      },
      features: {
        'standard:connect': { version: '1.0.0', connect },
        'standard:disconnect': {
          version: '1.0.0',
          disconnect: async () => {
            await call('disconnect', {});
            accounts = [];
            emit();
          },
        },
        'standard:events': {
          version: '1.0.0',
          on: (event: string, l: (e: unknown) => void) => {
            if (event !== 'change') return () => {};
            listeners.add(l);
            return () => listeners.delete(l);
          },
        },
        'solana:signIn': {
          version: '1.0.0',
          signIn: async (...inputs: unknown[]) =>
            Promise.all(
              inputs.map(async (input) => {
                if (!accounts.length) await connect();
                const r = (await call('signIn', { input }))!;
                return { account: accounts[0], signedMessage: u8(r.signedMessage), signature: u8(r.signature), signatureType: 'ed25519' };
              }),
            ),
        },
        'solana:signMessage': {
          version: '1.0.0',
          signMessage: async (...inputs: { account: { address: string }; message: Uint8Array }[]) =>
            Promise.all(
              inputs.map(async (i) => {
                const r = (await call('signMessage', { account: i.account.address, message: Array.from(i.message) }))!;
                return { signedMessage: u8(r.signedMessage), signature: u8(r.signature) };
              }),
            ),
        },
        'solana:signAndSendTransaction': {
          version: '1.0.0',
          supportedTransactionVersions: ['legacy', 0],
          signAndSendTransaction: async (...inputs: { account: { address: string }; chain: string; transaction: Uint8Array }[]) =>
            Promise.all(inputs.map(async (i) => ({ signature: u8((await call('signAndSendTransaction', { account: i.account.address, chain: i.chain, transaction: Array.from(i.transaction) }))!.signature) }))),
        },
      },
    };
    const register = ({ register: r }: { register: (w: unknown) => void }) => r(wallet);
    try {
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
    } catch {
      /* the app registers later */
    }
    window.addEventListener('wallet-standard:app-ready', (e) => register((e as CustomEvent).detail));
  }, opts.name ?? 'Pocket QA Test Wallet (devnet)');

  return { address, log };
}
