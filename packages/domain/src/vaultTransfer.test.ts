import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as squads from '@sqds/multisig';
import { PublicKey } from '@solana/web3.js';
import { base58 } from '@scure/base';
import { associatedTokenAddress } from './pda';
import { decodeVaultTransaction, squadsTransactionPda, squadsVaultPda, VAULT_TRANSACTION_DISCRIMINATOR, verifyVaultTransfer } from './vaultTransfer';

// pqa-qa CS3: a vote's bytes can't prove the payment's amount or recipient; the Squads vault
// transaction at (multisig, index) holds them. The client reads that account on devnet and checks
// it against an exact template (be3's createVaultTransfer: TransferChecked from the vault's token
// account, then a Memo with the operation id). The decoder is pinned against @sqds/multisig's own
// serializer (resolved through the workspace: apps/api depends on it).

const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const SYSTEM = '11111111111111111111111111111111';
const MULTISIG = 'Mu1tisig11111111111111111111111111111111111';
const CREATOR = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
const RECIPIENT = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const OTHER = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';
const OP = `pqa-op1:${'ab'.repeat(32)}`;
const VAULT = squadsVaultPda(MULTISIG, 0);
const VAULT_ATA = associatedTokenAddress(VAULT, MINT);
const RECIPIENT_ATA = associatedTokenAddress(RECIPIENT, MINT);

type Ix = { program: string; accounts: string[]; data: Uint8Array };
const u64 = (n: bigint) => {
  const b = new Uint8Array(9);
  b[0] = 12;
  new DataView(b.buffer).setBigUint64(1, n, true);
  return b;
};
const transfer = (o: { amount?: bigint; source?: string; mint?: string; dest?: string; authority?: string; decimals?: number; extra?: string } = {}): Ix => ({
  program: TOKEN,
  accounts: [o.source ?? VAULT_ATA, o.mint ?? MINT, o.dest ?? RECIPIENT_ATA, o.authority ?? VAULT, ...(o.extra ? [o.extra] : [])],
  data: Uint8Array.from([...u64(o.amount ?? 1_500_000n), o.decimals ?? 6]),
});
const memo = (text = OP, program = MEMO): Ix => ({ program, accounts: [], data: new TextEncoder().encode(text) });

/** A VaultTransaction account's data, serialized by @sqds/multisig itself. */
function account(ixs: Ix[], o: { multisig?: string; index?: bigint; vaultIndex?: number; lookups?: boolean } = {}): Uint8Array {
  const keys: string[] = [];
  for (const ix of ixs) for (const k of [...ix.accounts, ix.program]) if (!keys.includes(k)) keys.push(k);
  const vt = squads.accounts.VaultTransaction.fromArgs({
    multisig: new PublicKey(o.multisig ?? MULTISIG),
    creator: new PublicKey(CREATOR),
    index: Number(o.index ?? 4n),
    bump: 254,
    vaultIndex: o.vaultIndex ?? 0,
    vaultBump: 255,
    ephemeralSignerBumps: new Uint8Array(),
    message: {
      numSigners: 1,
      numWritableSigners: 1,
      numWritableNonSigners: 2,
      accountKeys: keys.map((k) => new PublicKey(k)),
      instructions: ixs.map((ix) => ({ programIdIndex: keys.indexOf(ix.program), accountIndexes: Uint8Array.from(ix.accounts.map((a) => keys.indexOf(a))), data: ix.data })),
      addressTableLookups: o.lookups ? [{ accountKey: new PublicKey(OTHER), writableIndexes: Uint8Array.of(0), readonlyIndexes: new Uint8Array() }] : [],
    },
  });
  const [buf] = vt.serialize();
  return new Uint8Array(buf);
}
const plan = { multisig: MULTISIG, txIndex: 4, recipient: RECIPIENT, amountUnits: 1_500_000, opId: OP };
const check = (data: Uint8Array, over: Partial<typeof plan> = {}) => verifyVaultTransfer(decodeVaultTransaction(data), { ...plan, ...over });

describe('Squads addresses', () => {
  it('the transaction and vault PDAs equal @sqds/multisig', () => {
    for (const i of [1n, 4n, 255n, 256n, 70_000n]) {
      expect(squadsTransactionPda(MULTISIG, i)).toBe(squads.getTransactionPda({ multisigPda: new PublicKey(MULTISIG), index: i })[0].toBase58());
    }
    expect(VAULT).toBe(squads.getVaultPda({ multisigPda: new PublicKey(MULTISIG), index: 0 })[0].toBase58());
  });
  it('the account discriminator is sha256("account:VaultTransaction")[0..8], as @sqds/multisig', () => {
    expect(Array.from(VAULT_TRANSACTION_DISCRIMINATOR)).toEqual(Array.from(createHash('sha256').update('account:VaultTransaction').digest().subarray(0, 8)));
    expect(Array.from(VAULT_TRANSACTION_DISCRIMINATOR)).toEqual(squads.accounts.vaultTransactionDiscriminator);
  });
});

describe('decodeVaultTransaction', () => {
  it('reads what @sqds/multisig serialized', () => {
    const vt = decodeVaultTransaction(account([transfer(), memo()], { index: 300n }));
    expect(vt.multisig).toBe(MULTISIG);
    expect(vt.creator).toBe(CREATOR);
    expect(vt.index).toBe(300n);
    expect(vt.vaultIndex).toBe(0);
    expect(vt.lookupTables).toBe(0);
    expect(vt.instructions.map((i) => i.programId)).toEqual([TOKEN, MEMO]);
    expect(vt.instructions[0]!.accounts).toEqual([VAULT_ATA, MINT, RECIPIENT_ATA, VAULT]);
    expect(new TextDecoder().decode(vt.instructions[1]!.data)).toBe(OP);
  });
  it.each([
    ['another account type (wrong discriminator)', (d: Uint8Array) => Uint8Array.from([0, ...d.subarray(1)]), /Not a Squads vault transaction/],
    ['truncated', (d: Uint8Array) => d.subarray(0, d.length - 3), /truncated/],
    ['empty', () => new Uint8Array(), /truncated|Not a Squads/],
  ])('refuses %s', (_n, mutate, msg) => {
    expect(() => decodeVaultTransaction(mutate(account([transfer(), memo()])))).toThrow(msg);
  });
});

describe('verifyVaultTransfer (exact template, every value from the account bytes)', () => {
  it('the planned payment: amount, recipient and their token accounts are read from the vault transaction', () => {
    expect(check(account([transfer(), memo()]))).toEqual({ amountUnits: 1_500_000, recipient: RECIPIENT, destination: RECIPIENT_ATA, source: VAULT_ATA });
  });
  it.each<[string, Uint8Array, Partial<typeof plan>, RegExp]>([
    ['another amount on chain', account([transfer({ amount: 9_000_000n }), memo()]), {}, /amount/],
    ['another recipient on chain', account([transfer({ dest: associatedTokenAddress(OTHER, MINT) }), memo()]), {}, /recipient/],
    ['the recipient wallet itself instead of its token account', account([transfer({ dest: RECIPIENT }), memo()]), {}, /recipient/],
    ['another mint', account([transfer({ mint: OTHER }), memo()]), {}, /mint/],
    ['decimals not 6', account([transfer({ decimals: 9 }), memo()]), {}, /decimals/],
    ['another source than the vault’s token account', account([transfer({ source: OTHER }), memo()]), {}, /source/],
    ['another authority than the vault', account([transfer({ authority: OTHER }), memo()]), {}, /authority/],
    ['a fifth account in the transfer', account([transfer({ extra: OTHER }), memo()]), {}, /accounts/],
    ['another multisig', account([transfer(), memo()], { multisig: OTHER }), {}, /multisig/],
    ['another index', account([transfer(), memo()], { index: 5n }), {}, /index/],
    ['another vault index', account([transfer(), memo()], { vaultIndex: 1 }), {}, /vault/],
    ['address lookup tables', account([transfer(), memo()], { lookups: true }), {}, /lookup/],
    ['no memo', account([transfer()]), {}, /exactly a TransferChecked and the operation memo/],
    ['another operation id in the memo', account([transfer(), memo(`pqa-op1:${'cd'.repeat(32)}`)]), {}, /operation id/],
    ['a memo from another program', account([transfer(), memo(OP, SYSTEM)]), {}, /operation id|memo/],
    ['an extra instruction', account([transfer(), memo(), { program: SYSTEM, accounts: [VAULT, OTHER], data: Uint8Array.of(2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0) }]), {}, /exactly a TransferChecked and the operation memo/],
    ['two transfers', account([transfer(), transfer({ amount: 1n })]), {}, /exactly a TransferChecked and the operation memo|operation id/],
    ['a System transfer instead of the token transfer', account([{ program: SYSTEM, accounts: [VAULT, OTHER], data: Uint8Array.of(2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0) }, memo()]), {}, /TransferChecked/],
    ['the plan names another recipient', account([transfer(), memo()]), { recipient: OTHER }, /recipient/],
    ['the plan names another amount', account([transfer(), memo()]), { amountUnits: 1 }, /amount/],
  ])('refuses: %s', (_n, data, over, msg) => {
    expect(() => check(data, over)).toThrow(msg);
    expect(() => check(data, over)).toThrow(/^The payment on Solana devnet doesn’t match/);
  });
  it('a non-base58 recipient is refused, not derived', () => {
    expect(() => check(account([transfer(), memo()]), { recipient: base58.encode(new Uint8Array(5)) })).toThrow(/recipient/);
  });
});
