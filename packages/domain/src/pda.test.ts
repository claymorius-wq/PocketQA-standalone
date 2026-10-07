import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { address, getProgramDerivedAddress } from '@solana/kit';
import { base58 } from '@scure/base';
import { associatedTokenAddress, findProgramAddress, isOnCurve, sha256, squadsProposalPda } from './pda';

// The client derives the addresses a server-built transaction must use (the linked wallet's token
// account, the Squads proposal of exactly this payment) itself. sha256 is pure JS (no native
// module in the app); both are pinned against Node's crypto and @solana/kit.

describe('sha256', () => {
  it('equals node:crypto for empty, short, block-boundary and long inputs', () => {
    for (const n of [0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000, 4096]) {
      const b = randomBytes(n);
      expect(Buffer.from(sha256(b)).toString('hex')).toBe(createHash('sha256').update(b).digest('hex'));
    }
    expect(Buffer.from(sha256(new TextEncoder().encode('abc'))).toString('hex')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SQUADS = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';

describe('program-derived addresses', () => {
  it('findProgramAddress equals @solana/kit for many random seed sets (exercising non-255 bumps)', async () => {
    for (let i = 0; i < 40; i++) {
      const seeds = [randomBytes(32), randomBytes(1 + (i % 20))];
      const program = base58.encode(randomBytes(32));
      const [kitAddr, kitBump] = await getProgramDerivedAddress({ programAddress: address(program), seeds });
      expect(findProgramAddress(seeds, program)).toEqual({ address: kitAddr, bump: kitBump });
    }
  });

  it('the associated token account equals @solana/kit', async () => {
    for (let i = 0; i < 10; i++) {
      const owner = base58.encode(randomBytes(32));
      const [ata] = await getProgramDerivedAddress({ programAddress: address(ATA_PROGRAM), seeds: [base58.decode(owner), base58.decode(TOKEN), base58.decode(MINT)] });
      expect(associatedTokenAddress(owner, MINT)).toBe(ata);
    }
  });

  it('the Squads proposal of (multisig, index) equals @solana/kit with the SDK seeds', async () => {
    const multisig = base58.encode(randomBytes(32));
    for (const index of [1n, 2n, 300n, 2n ** 40n]) {
      const le = new Uint8Array(8);
      new DataView(le.buffer).setBigUint64(0, index, true);
      const enc = new TextEncoder();
      const [kit] = await getProgramDerivedAddress({ programAddress: address(SQUADS), seeds: [enc.encode('multisig'), base58.decode(multisig), enc.encode('transaction'), le, enc.encode('proposal')] });
      expect(squadsProposalPda(multisig, index)).toBe(kit);
    }
  });

  it('isOnCurve: real public keys are on the curve; PDAs are not', async () => {
    expect(isOnCurve(base58.decode('7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV'))).toBe(true);
    const [pda] = await getProgramDerivedAddress({ programAddress: address(SQUADS), seeds: [new Uint8Array([1])] });
    expect(isOnCurve(base58.decode(pda))).toBe(false);
  });
});
