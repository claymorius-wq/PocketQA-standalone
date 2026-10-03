// Seeds an approved participation whose tester has a linked devnet wallet (a throwaway
// ed25519 key, linked through the real SIWS flow), and prints the builder's sign-in plus
// the participation id for the on-device transfer flow. Local only.
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { createSignInMessageText } from '@solana/wallet-standard-util';

const API = process.env.API ?? 'http://127.0.0.1:8787';
const run = Date.now().toString(36);
const pw = `pqa-${run}-${Math.random().toString(36).slice(2)}`; // check-secrets: allow (generated per run)

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const b = await call('POST', '/auth/register', null, { email: `tbuilder-${run}@example.test`, password: pw, displayName: 'Tia Builder', role: 'builder' });
const t = await call('POST', '/auth/register', null, { email: `ttester-${run}@example.test`, password: pw, displayName: 'Theo Tester', role: 'tester' });
await call('POST', '/me/credits/test-topup', b.token, { amount: 1000 });
const s = await call('POST', '/studies', b.token, {
  title: `Transfer demo ${run}`,
  objective: 'Approved work used to exercise the devnet demo transfer screen.',
  tasks: [{ instruction: 'Open the app and reach the home screen' }],
  deviceCriteria: { platforms: ['android', 'web'], minAndroidApi: null, languages: [] },
  rewardCredits: 50,
  slots: 2,
  consentText: 'I agree to record my screen only while doing these tasks, and to review clips first.',
});
await call('POST', `/studies/${s.id}/publish`, b.token);
await call('PUT', '/me/device', t.token, { platform: 'android', osVersion: '16', androidApiLevel: 36, model: 'Emulator', languages: ['en'] });
const p = await call('POST', `/studies/${s.id}/consent`, t.token, { consentVersion: s.consentVersion, accepted: true });
await call('POST', `/participations/${p.id}/start`, t.token);
await call('POST', `/participations/${p.id}/submit`, t.token);
await call('POST', `/participations/${p.id}/approve`, b.token, {});
const sk = ed25519.utils.randomSecretKey();
const address = base58.encode(ed25519.getPublicKey(sk));
const { input } = await call('POST', '/wallet/nonce', t.token, { address });
const bytes = new TextEncoder().encode(createSignInMessageText(input));
await call('POST', '/wallet/link', t.token, { address, nonce: input.nonce, signedMessage: Buffer.from(bytes).toString('base64'), signature: Buffer.from(ed25519.sign(bytes, sk)).toString('base64') });
console.log(`EMAIL=${b.user.email}`);
console.log(`PASSWORD=${pw}`); // check-secrets: allow (throwaway local test account)
console.log(`PARTICIPATION=${p.id}`);
console.log(`BUILDER_TOKEN=${b.token}`); // check-secrets: allow (local session for the runner's server-side check)
