// A Wallet Standard TEST wallet for Playwright: Solana DEVNET only (valueless test funds).
// Used for the hosted devnet browser journey (full E2E). It is test tooling, never app or server code.
//
// Key handling (lead's rule: "loaded in memory only in the test process; never print it; never put
// it in app/server env"):
//  - The fixture secret is read from ~/.config/pocketqa-devnet-pilot/<role>.json into this Node
//    process only, and checked against public-addresses.json. It is never logged, returned,
//    written, or sent to the page: the page-side wallet holds only the PUBLIC key.
//  - Every signature is made here, in Node, through a Playwright binding the page calls
//    (`window.__pqaTestWallet`). The page receives signatures and signed bytes, nothing else.
//
// Guards (refused before signing):
//  - Chain must be solana:devnet. The RPC used for signAndSend must be a devnet endpoint.
//  - Only the account this wallet exposes may sign.
//  - An optional `approve(request)` policy can refuse any request (e.g. unexpected programs or
//    amounts); a refusal is reported to the app as a user rejection.
// Every request is recorded (kind, chain, byte length, approved?) in `wallet.log` for evidence.
import { createPrivateKey, sign as edSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Connection, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';

export const DEVNET = 'solana:devnet';
const DEVNET_RPC = /^https:\/\/([a-z0-9-]+\.)*devnet\.[a-z0-9.-]+(\/.*)?$|^https:\/\/api\.devnet\.solana\.com\/?$/i;
const FIXTURE_DIR = join(homedir(), '.config', 'pocketqa-devnet-pilot');

/**
 * Loads a fixture keypair (e.g. 'builder') into memory. The file holds a solana-keygen secret
 * (a JSON array of 64 bytes). Its public key must equal the published one in public-addresses.json
 * when that file names this role. Returns a Keypair; callers must never print `secretKey`.
 */
export function loadFixtureKeypair(role) {
  if (!/^[a-z-]+$/.test(role)) throw new Error('fixture role must be a plain name');
  const raw = JSON.parse(readFileSync(join(FIXTURE_DIR, `${role}.json`), 'utf8'));
  const bytes = Uint8Array.from(Array.isArray(raw) ? raw : raw.secretKey ?? []);
  if (bytes.length !== 64) throw new Error(`fixture ${role}: expected a 64-byte secret key`);
  const kp = Keypair.fromSecretKey(bytes);
  bytes.fill(0);
  let published;
  try {
    published = JSON.parse(readFileSync(join(FIXTURE_DIR, 'public-addresses.json'), 'utf8'));
  } catch {
    published = null;
  }
  const expected = published && (published[role] ?? published[`${role}Address`]);
  if (expected && expected !== kp.publicKey.toBase58()) throw new Error(`fixture ${role}: public key does not match public-addresses.json`);
  return kp;
}

/** ed25519 over raw bytes with Node's crypto (the 32-byte seed as a JWK, never exported). */
function signBytes(kp, message) {
  const b64u = (u) => Buffer.from(u).toString('base64url');
  const key = createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', d: b64u(kp.secretKey.subarray(0, 32)), x: b64u(kp.publicKey.toBytes()) }, format: 'jwk' });
  return new Uint8Array(edSign(null, Buffer.from(message), key));
}

/** Signs a serialized legacy or versioned transaction as `kp`, returning the serialized signed bytes. */
function signSerializedTx(kp, bytes) {
  const buf = Buffer.from(bytes);
  // A versioned message starts with the high bit set after the signature section; try versioned first.
  try {
    const vtx = VersionedTransaction.deserialize(buf);
    vtx.sign([kp]);
    return { signed: vtx.serialize(), signature: vtx.signatures[vtx.message.staticAccountKeys.findIndex((k) => k.equals(kp.publicKey))] };
  } catch {
    const tx = Transaction.from(buf);
    tx.partialSign(kp);
    return { signed: tx.serialize({ requireAllSignatures: false, verifySignatures: false }), signature: tx.signatures.find((s) => s.publicKey.equals(kp.publicKey))?.signature };
  }
}

/**
 * Installs the test wallet into `page` (call before navigation). Returns a handle with `log`.
 * options: { keypair, name?, rpcUrl? (devnet only, needed for signAndSend), approve?(req) }.
 */
export async function installTestWallet(page, { keypair, name = 'Pocket QA Test Wallet (devnet)', rpcUrl, approve = () => true }) {
  if (rpcUrl && !DEVNET_RPC.test(rpcUrl)) throw new Error('refusing: the test wallet only sends to a devnet RPC');
  const address = keypair.publicKey.toBase58();
  const log = [];
  const record = (entry) => log.push({ at: new Date().toISOString(), ...entry });
  const guard = (kind, chain, account, extra = {}) => {
    const refuse = (why) => {
      record({ kind, chain: chain ?? DEVNET, ...extra, approved: false, refused: why });
      return new Error(`refusing ${kind}: ${why}`);
    };
    if (chain && chain !== DEVNET) throw refuse(`chain ${chain} is not ${DEVNET}`);
    if (account && account !== address) throw refuse("not this wallet's account");
    const req = { kind, chain: chain ?? DEVNET, ...extra };
    const ok = approve(req) !== false;
    record({ ...req, approved: ok });
    if (!ok) throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
  };

  await page.exposeBinding('__pqaTestWallet', async (_src, kind, payload) => {
    if (kind === 'connect') {
      record({ kind });
      return { address, publicKey: Array.from(keypair.publicKey.toBytes()) };
    }
    if (kind === 'signMessage') {
      const message = Uint8Array.from(payload.message);
      guard(kind, null, payload.account, { bytes: message.length });
      return { signedMessage: Array.from(message), signature: Array.from(signBytes(keypair, message)) };
    }
    if (kind === 'signIn') {
      // SIWS: the wallet builds the text from the server's fields (the app compares them).
      const i = payload.input ?? {};
      if (i.address && i.address !== address) throw new Error('refusing signIn: address is not this wallet');
      const lines = [`${i.domain} wants you to sign in with your Solana account:`, address];
      if (i.statement) lines.push('', i.statement);
      const fields = [['URI', i.uri], ['Version', i.version], ['Chain ID', i.chainId], ['Nonce', i.nonce], ['Issued At', i.issuedAt], ['Expiration Time', i.expirationTime], ['Not Before', i.notBefore], ['Request ID', i.requestId]].filter(([, v]) => v);
      if (fields.length) lines.push('', ...fields.map(([k, v]) => `${k}: ${v}`));
      if (Array.isArray(i.resources) && i.resources.length) lines.push('Resources:', ...i.resources.map((r) => `- ${r}`));
      const message = new TextEncoder().encode(lines.join('\n'));
      guard(kind, i.chainId ? (String(i.chainId).startsWith('solana:') ? i.chainId : `solana:${i.chainId}`) : DEVNET, null, { bytes: message.length, domain: i.domain });
      return { signedMessage: Array.from(message), signature: Array.from(signBytes(keypair, message)) };
    }
    if (kind === 'signTransaction' || kind === 'signAndSendTransaction') {
      const bytes = Uint8Array.from(payload.transaction);
      guard(kind, payload.chain, payload.account, { bytes: bytes.length });
      const { signed, signature } = signSerializedTx(keypair, bytes);
      if (kind === 'signTransaction') return { signedTransaction: Array.from(signed) };
      if (!rpcUrl) throw new Error('refusing signAndSendTransaction: no devnet rpcUrl configured');
      const sig = await new Connection(rpcUrl, 'confirmed').sendRawTransaction(signed, { skipPreflight: false });
      record({ kind: 'sent', chain: DEVNET, signature: sig });
      return { signature: Array.from(signature ?? []) };
    }
    if (kind === 'disconnect') {
      record({ kind });
      return null;
    }
    throw new Error(`unsupported wallet request ${kind}`);
  });

  await page.addInitScript(({ walletName }) => {
    const call = (kind, payload) => window.__pqaTestWallet(kind, payload);
    const u8 = (a) => Uint8Array.from(a);
    const icon = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="6" fill="#3640c8"/></svg>');
    const CHAINS = ['solana:devnet'];
    const FEATURES = ['solana:signIn', 'solana:signMessage', 'solana:signTransaction', 'solana:signAndSendTransaction'];
    let accounts = [];
    const listeners = new Set();
    const account = (a) => ({ address: a.address, publicKey: u8(a.publicKey), chains: CHAINS, features: FEATURES, label: walletName });
    const emit = () => listeners.forEach((l) => l({ accounts }));
    const wallet = {
      version: '1.0.0',
      name: walletName,
      icon,
      chains: CHAINS,
      get accounts() {
        return accounts;
      },
      features: {
        'standard:connect': {
          version: '1.0.0',
          connect: async () => {
            accounts = [account(await call('connect', {}))];
            emit();
            return { accounts };
          },
        },
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
          on: (event, listener) => {
            if (event !== 'change') return () => {};
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
        },
        'solana:signMessage': {
          version: '1.0.0',
          signMessage: async (...inputs) =>
            Promise.all(inputs.map(async (i) => {
              const r = await call('signMessage', { account: i.account.address, message: Array.from(i.message) });
              return { signedMessage: u8(r.signedMessage), signature: u8(r.signature) };
            })),
        },
        'solana:signIn': {
          version: '1.0.0',
          signIn: async (...inputs) =>
            Promise.all(inputs.map(async (input) => {
              if (!accounts.length) accounts = [account(await call('connect', {}))];
              const r = await call('signIn', { input });
              return { account: accounts[0], signedMessage: u8(r.signedMessage), signature: u8(r.signature), signatureType: 'ed25519' };
            })),
        },
        'solana:signTransaction': {
          version: '1.0.0',
          supportedTransactionVersions: ['legacy', 0],
          signTransaction: async (...inputs) =>
            Promise.all(inputs.map(async (i) => ({ signedTransaction: u8((await call('signTransaction', { account: i.account.address, chain: i.chain, transaction: Array.from(i.transaction) })).signedTransaction) }))),
        },
        'solana:signAndSendTransaction': {
          version: '1.0.0',
          supportedTransactionVersions: ['legacy', 0],
          signAndSendTransaction: async (...inputs) =>
            Promise.all(inputs.map(async (i) => ({ signature: u8((await call('signAndSendTransaction', { account: i.account.address, chain: i.chain, transaction: Array.from(i.transaction) })).signature) }))),
        },
      },
    };
    // Wallet Standard registration: announce now, and answer an app that becomes ready later.
    const register = ({ register: r }) => r(wallet);
    try {
      window.dispatchEvent(new CustomEvent('wallet-standard:register-wallet', { detail: register }));
    } catch {}
    window.addEventListener('wallet-standard:app-ready', ({ detail }) => register(detail));
  }, { walletName: name });

  return { address, log };
}
