/* global CustomEvent, TextDecoder, window -- evidence copy: these run inside the page (Playwright evaluate/addInitScript) */
/* eslint-disable @typescript-eslint/no-unused-vars -- evidence copy kept verbatim (lint-only header; no code changed) */
// Self-test of devnet-test-wallet.mjs with a THROWAWAY in-memory key (never the fixture), a page
// served by Playwright routing (no network), and a dummy devnet transfer that is signed, never sent.
import { createPublicKey, verify } from 'node:crypto';
import { chromium } from '/Users/hamzadiaz/Projects/pocket-qa/node_modules/playwright-core/index.mjs';
import { Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { installTestWallet } from './devnet-test-wallet.mjs';

const kp = Keypair.generate();
const b = await chromium.launch();
const page = await (await b.newContext()).newPage();
await page.route('https://pqa-harness.test/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>harness</title><p>harness</p>' }));
const policy = (req) => !(req.kind === 'signMessage' && req.bytes > 1000);
const wallet = await installTestWallet(page, { keypair: kp, approve: policy });
await page.goto('https://pqa-harness.test/');
const tx = new Transaction({ feePayer: kp.publicKey, recentBlockhash: '11111111111111111111111111111111' }).add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey('11111111111111111111111111111112'), lamports: 1 }));
const unsigned = Array.from(tx.serialize({ requireAllSignatures: false, verifySignatures: false }));
const out = await page.evaluate(async (unsigned) => {
  // The Wallet Standard app side (what @wallet-standard/app does): collect registered wallets.
  const wallets = [];
  window.addEventListener('wallet-standard:register-wallet', ({ detail }) => detail({ register: (...ws) => wallets.push(...ws) }));
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: { register: (...ws) => wallets.push(...ws) } }));
  const w = wallets.find((x) => x.chains.includes('solana:devnet'));
  const { accounts } = await w.features['standard:connect'].connect();
  const msg = new TextEncoder().encode('pocket qa harness self-test');
  const [sm] = await w.features['solana:signMessage'].signMessage({ account: accounts[0], message: msg });
  const [st] = await w.features['solana:signTransaction'].signTransaction({ account: accounts[0], chain: 'solana:devnet', transaction: Uint8Array.from(unsigned) });
  const mainnet = await w.features['solana:signTransaction'].signTransaction({ account: accounts[0], chain: 'solana:mainnet', transaction: Uint8Array.from(unsigned) }).then(() => 'signed', (e) => String(e.message));
  const big = await w.features['solana:signMessage'].signMessage({ account: accounts[0], message: new Uint8Array(2000) }).then(() => 'signed', (e) => String(e.message));
  const [si] = await w.features['solana:signIn'].signIn({ domain: 'pqa-harness.test', address: accounts[0].address, statement: 'Sign in to Pocket QA (devnet test).', nonce: 'abc12345', chainId: 'devnet' });
  return { wallets: wallets.map((x) => x.name), features: Object.keys(w.features), address: accounts[0].address, msgSig: Array.from(sm.signature), signedTx: Array.from(st.signedTransaction), mainnet, big, signInText: new TextDecoder().decode(si.signedMessage), signInSig: Array.from(si.signature), secretInPage: JSON.stringify(Object.keys(window)).includes('secret') };
}, unsigned);
const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(kp.publicKey.toBytes()).toString('base64url') }, format: 'jwk' });
const res = {
  discovered: out.wallets,
  features: out.features,
  addressMatches: out.address === kp.publicKey.toBase58(),
  signMessageVerifies: verify(null, Buffer.from('pocket qa harness self-test'), pub, Buffer.from(out.msgSig)),
  signTransactionVerifies: Transaction.from(Buffer.from(out.signedTx)).verifySignatures(),
  mainnetRefused: out.mainnet,
  policyRefused: out.big,
  signInVerifies: verify(null, Buffer.from(out.signInText), pub, Buffer.from(out.signInSig)),
  signInFirstLine: out.signInText.split('\n')[0],
  noSecretInPage: !out.secretInPage,
  log: wallet.log.map(({ at, ...r }) => r),
};
await b.close();
console.log(JSON.stringify(res, null, 1));
const ok = res.addressMatches && res.signMessageVerifies && res.signTransactionVerifies && /not solana:devnet/.test(res.mainnetRefused) && /User rejected/.test(res.policyRefused) && res.signInVerifies;
console.log(ok ? 'SELF-TEST PASS' : 'SELF-TEST FAIL');
process.exitCode = ok ? 0 : 1;
