import { describe, expect, it } from 'vitest';
import {
  AccountRole,
  address,
  appendTransactionMessageInstruction,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from '@solana/kit';
import { base64 } from '@scure/base';
import { decodeServerTx } from './serverTx';

// Server-built devnet transactions (escrow funding, the builder's Squads approval) are decoded on
// the client before the wallet is asked to sign: who pays and signs, whether it is unsigned, and
// which programs it calls. The decoder is hand-written; @solana/kit's encoder pins the layout.

const wallet = address('7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV');
const other = address('9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin');
const squads = address('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
const blockhash = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi' as Blockhash;
const lifetime = { blockhash, lastValidBlockHeight: 1000n };

function tx(version: 0 | 'legacy', programs: string[] = [squads], feePayer = wallet) {
  const ixs = programs.map((p) => ({ programAddress: address(p), accounts: [{ address: other, role: AccountRole.WRITABLE }], data: Uint8Array.of(1, 2, 3) }));
  return compileTransaction(
    pipe(createTransactionMessage({ version }), (x) => setTransactionMessageFeePayer(feePayer, x), (x) => setTransactionMessageLifetimeUsingBlockhash(lifetime, x), (x) => appendTransactionMessageInstructions(ixs, x)),
  );
}
const b64 = (t: ReturnType<typeof compileTransaction>) => base64.encode(new Uint8Array(getTransactionEncoder().encode(t)));

describe('decodeServerTx', () => {
  it('decodes an unsigned v0 transaction: version, fee payer, signer count, unsigned slots, programs, blockhash', () => {
    const d = decodeServerTx(b64(tx(0)));
    expect(d).toEqual({
      version: 0,
      requiredSignatures: 1,
      signed: [false],
      feePayer: wallet,
      programIds: [squads],
      recentBlockhash: blockhash,
      lookupTables: 0,
      instructions: [{ programId: squads, accounts: [other], data: Uint8Array.of(1, 2, 3) }],
    });
  });

  it('decodes a legacy transaction too', () => {
    const d = decodeServerTx(b64(tx('legacy')));
    expect(d.version).toBe('legacy');
    expect(d.feePayer).toBe(wallet);
    expect(d.programIds).toEqual([squads]);
  });

  it('reports a filled signature slot as signed', () => {
    const t = tx(0);
    const bytes = new Uint8Array(getTransactionEncoder().encode({ ...t, signatures: { ...t.signatures, [wallet]: new Uint8Array(64).fill(7) } } as typeof t));
    expect(decodeServerTx(base64.encode(bytes)).signed).toEqual([true]);
  });

  it('lists every program called, in instruction order', () => {
    expect(decodeServerTx(b64(tx(0, [squads, 'ComputeBudget111111111111111111111111111111']))).programIds).toEqual([squads, 'ComputeBudget111111111111111111111111111111']);
  });

  it('refuses a program reached through an address lookup table (it cannot be checked offline)', () => {
    const lookup = address('AddressLookupTab1e1111111111111111111111111');
    const m = pipe(createTransactionMessage({ version: 0 }), (x) => setTransactionMessageFeePayer(wallet, x), (x) => setTransactionMessageLifetimeUsingBlockhash(lifetime, x), (x) =>
      appendTransactionMessageInstruction({ programAddress: squads, accounts: [{ address: other, role: AccountRole.READONLY }], data: Uint8Array.of(1) }, x),
    );
    const compressed = compressTransactionMessageUsingAddressLookupTables(m, { [lookup]: [other] });
    const bytes = b64(compileTransaction(compressed));
    // An instruction account from a lookup table can't be checked offline: refused.
    expect(() => decodeServerTx(bytes)).toThrow(/lookup table/);
    // A lookup-table account as a PROGRAM is never allowed (the static keys must name every program).
    const t = compileTransaction(m);
    const raw = new Uint8Array(getTransactionEncoder().encode(t));
    // Point the instruction's program index past the static keys. Offset from the wire layout:
    // sig count 1 + signature 64, version 1, header 3, key count 1, 3 keys x 32, blockhash 32, ix count 1.
    const ixProgramIndexAt = 1 + 64 + 1 + 3 + 1 + 3 * 32 + 32 + 1;
    expect(raw[ixProgramIndexAt]).toBe(2); // the program is the third static key
    raw[ixProgramIndexAt] = 9;
    expect(() => decodeServerTx(base64.encode(raw))).toThrow(/program/i);
  });

  it('refuses truncated, oversized-version and non-base64 input', () => {
    const full = base64.decode(b64(tx(0)));
    expect(() => decodeServerTx(base64.encode(full.subarray(0, full.length - 5)))).toThrow();
    const v1 = full.slice();
    v1[1 + 64] = 0x81; // message version 1
    expect(() => decodeServerTx(base64.encode(v1))).toThrow(/version/i);
    expect(() => decodeServerTx('not base64 !!')).toThrow();
    expect(() => decodeServerTx('')).toThrow();
  });
});
