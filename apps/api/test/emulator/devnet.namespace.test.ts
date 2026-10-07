// CH-D2 (devnet-phase-contract.md amendments r1): devnet data lives ONLY under the namespace. The
// whole escrow suite (fund, consent, approve, settle, refund, export, delete) runs with every repo
// over devnetFirestore, and after EVERY test the raw emulator is read: nothing may exist outside
// `pocketqaNamespaces/devnet`. The full devnet journey (adapter, receipts, leases) gets the same
// check in its own file once the step machine lands.
import { afterEach, expect, it } from 'vitest';
import { DEVNET_ROOT } from '../../src/firestore/namespace';
import { emulatorFirestore } from './fs';

process.env.PQA_TEST_BACKEND = 'firestore';
process.env.PQA_TEST_NAMESPACE = 'devnet';
const raw = emulatorFirestore();
let checked = 0;

afterEach(async () => {
  const top = (await raw.listCollections()).map((c) => c.id);
  expect(top.filter((id) => id !== 'pocketqaNamespaces')).toEqual([]);
  const roots = top.length ? (await raw.collection('pocketqaNamespaces').listDocuments()).map((d) => d.path) : [];
  expect(roots.filter((p) => p !== DEVNET_ROOT)).toEqual([]);
  checked += 1;
});

await import('../escrow.test');

it('the isolation check really ran after the suite’s tests (and the namespace held data)', async () => {
  expect(checked).toBeGreaterThan(20);
  expect((await raw.doc(DEVNET_ROOT).listCollections()).length).toBeGreaterThan(0);
});
export {};
