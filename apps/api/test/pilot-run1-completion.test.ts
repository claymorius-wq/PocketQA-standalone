import { base58 } from '@scure/base';
import { Keypair, TransactionMessage, VersionedTransaction, type Connection } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { sendAndClassify, sendLine, type CompletionRecord } from '../test-live/run1Completion';

// Offline tests of the run 1 completion's single send (pqa-qa harness delta r1, P2-1 and P2-2).
const payer = Keypair.generate();
function signedTx() {
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [] }).compileToV0Message());
  tx.sign([payer]);
  return tx;
}
const fresh = (): CompletionRecord => ({ send: null, outcome: 'incomplete', reason: null });
const noSleep = async () => {};
function conn(over: { send?: () => Promise<string>; status?: () => Promise<unknown>; tx?: () => Promise<unknown> } = {}) {
  const status = (err: unknown, confirmationStatus = 'finalized') => async () => ({ context: { slot: 9 }, value: [{ slot: 507_800_000, confirmations: null, err, confirmationStatus }] });
  return {
    c: {
      sendTransaction: over.send ?? (async () => 'ignored'),
      getSignatureStatuses: over.status ?? status(null),
      getTransaction: over.tx ?? (async () => ({ meta: { fee: 5000 } })),
    } as unknown as Pick<Connection, 'sendTransaction' | 'getSignatureStatuses' | 'getTransaction'>,
    status,
  };
}
const statusWith = (err: unknown, confirmationStatus = 'finalized') => conn().status(err, confirmationStatus);

describe('P2-1: only Squads InvalidProposalStatus (6008) is the expected refusal', () => {
  it('exactly {InstructionError:[0,{Custom:6008}]} → refused-as-expected', async () => {
    const out = await sendAndClassify(conn({ status: statusWith({ InstructionError: [0, { Custom: 6008 }] }) }).c, signedTx(), fresh(), { sleep: noSleep });
    expect(out).toMatchObject({ outcome: 'refused-as-expected', send: { state: 'landed', confirmation: 'finalized', feeLamports: 5000, slot: 507_800_000 } });
  });
  it.each([
    ['a token-program failure (insufficient funds in the inner transfer)', { InstructionError: [0, { Custom: 1 }] }],
    ['another Squads error', { InstructionError: [0, { Custom: 6009 }] }],
    ['6008 on another instruction', { InstructionError: [1, { Custom: 6008 }] }],
    ['a non-instruction error', 'AccountNotFound'],
  ])('%s → unexpected-error, never a pass', async (_, err) => {
    const out = await sendAndClassify(conn({ status: statusWith(err) }).c, signedTx(), fresh(), { sleep: noSleep });
    expect(out.outcome).toBe('unexpected-error');
    expect(out.reason).toMatch(/other than Squads InvalidProposalStatus/);
  });
  it('finalized without an error → NOT-refused', async () => {
    expect((await sendAndClassify(conn().c, signedTx(), fresh(), { sleep: noSleep })).outcome).toBe('NOT-refused');
  });
});

describe('P2-2: the signature is recorded before broadcast; no exception after an attempt reads as "nothing sent"', () => {
  it('the signature is derived from the signed transaction', async () => {
    const tx = signedTx();
    const out = await sendAndClassify(conn().c, tx, fresh(), { sleep: noSleep });
    expect(out.send!.signature).toBe(base58.encode(tx.signatures[0]!));
  });
  it.each([
    ['sendTransaction throws (it may still have been broadcast)', { send: async () => Promise.reject(new Error('fetch failed')) }],
    ['getSignatureStatuses throws', { status: async () => Promise.reject(new Error('429')) }],
    ['getTransaction throws', { status: statusWith({ InstructionError: [0, { Custom: 6008 }] }), tx: async () => Promise.reject(new Error('429')) }],
    ['the status never reaches finalized', { status: statusWith(null, 'confirmed') }],
  ])('%s → unknown, with the signature, and never "Nothing was sent"', async (_, over) => {
    const tx = signedTx();
    const out = await sendAndClassify(conn(over).c, tx, fresh(), { sleep: noSleep, polls: 3 });
    expect(out.outcome).toBe('unknown');
    expect(out.send!.signature).toBe(base58.encode(tx.signatures[0]!));
    expect(out.reason).toMatch(/inspect|never retry/);
    expect(sendLine(out)).not.toMatch(/Nothing was sent/);
    expect(sendLine(out)).toContain(out.send!.signature.slice(0, 12));
  });
  it('an unsigned transaction is refused before anything is attempted', async () => {
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [] }).compileToV0Message());
    const out = fresh();
    await expect(sendAndClassify(conn().c, tx, out, { sleep: noSleep })).rejects.toThrow(/signed before/);
    expect(out.send).toBeNull();
    expect(sendLine(out)).toBe('Nothing was sent (stopped before the send).');
  });
});
