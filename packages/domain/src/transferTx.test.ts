import { describe, expect, it } from 'vitest';
import { getCompiledTransactionMessageDecoder, getTransactionDecoder } from '@solana/kit';
import { base58 } from '@scure/base';
import { buildDevnetTransferTx } from './transferTx';

const sender = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
const recipient = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const blockhash = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';

describe('buildDevnetTransferTx', () => {
  it('produces an unsigned legacy system transfer that @solana/kit decodes exactly', () => {
    const bytes = buildDevnetTransferTx({ sender, recipient, lamports: 1_000_000, blockhash });
    const tx = getTransactionDecoder().decode(bytes);
    expect(Object.keys(tx.signatures)).toEqual([sender]);
    expect(tx.signatures[sender as keyof typeof tx.signatures]).toBeNull(); // unsigned: the wallet signs
    const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
    expect(msg.version).toBe('legacy');
    if (msg.version !== 'legacy') throw new Error('expected a legacy message');
    expect(msg.header).toEqual({ numSignerAccounts: 1, numReadonlySignerAccounts: 0, numReadonlyNonSignerAccounts: 1 });
    expect(msg.staticAccounts).toEqual([sender, recipient, '11111111111111111111111111111111']);
    expect(msg.lifetimeToken).toBe(blockhash);
    expect(msg.instructions).toHaveLength(1);
    const ix = msg.instructions[0]!;
    expect(ix.programAddressIndex).toBe(2);
    expect(ix.accountIndices).toEqual([0, 1]);
    // System program Transfer = u32 LE 2, then u64 LE lamports.
    expect(Array.from(ix.data!)).toEqual([2, 0, 0, 0, 0x40, 0x42, 0x0f, 0, 0, 0, 0, 0]);
  });

  it('refuses self-transfers, bad keys and non-positive amounts', () => {
    expect(() => buildDevnetTransferTx({ sender, recipient: sender, lamports: 1, blockhash })).toThrow();
    expect(() => buildDevnetTransferTx({ sender: base58.encode(new Uint8Array(31)), recipient, lamports: 1, blockhash })).toThrow();
    expect(() => buildDevnetTransferTx({ sender, recipient, lamports: 0, blockhash })).toThrow();
    expect(() => buildDevnetTransferTx({ sender, recipient, lamports: 1.5, blockhash })).toThrow();
  });
});
