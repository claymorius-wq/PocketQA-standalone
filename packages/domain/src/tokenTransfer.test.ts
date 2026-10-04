import { describe, expect, it } from 'vitest';
import { CLASSIC_TOKEN_PROGRAM, DEVNET_USDC_MINT, observeTokenTransfer, type ParsedTokenTx } from './tokenTransfer';

// Fixtures in the shape of getTransaction(sig, { encoding: 'jsonParsed', commitment: 'finalized' }).
const VAULT = 'Vau1tTokenAccount1111111111111111111111111';
const FUNDER_ATA = 'FunderTokenAccount111111111111111111111111';
const FUNDER = 'FunderWa11et11111111111111111111111111111111';
const REF = 'Ref1111111111111111111111111111111111111111';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PE9n9TZTnQ27fDZ';

function tx(over: { pre?: [number, string][]; post?: [number, string][]; mint?: string; programId?: string; err?: unknown; keys?: string[]; blockTime?: number | null } = {}): ParsedTokenTx {
  const keys = over.keys ?? [FUNDER, FUNDER_ATA, VAULT, REF, CLASSIC_TOKEN_PROGRAM];
  const bal = (list: [number, string][]) =>
    list.map(([accountIndex, amount]) => ({
      accountIndex,
      mint: over.mint ?? DEVNET_USDC_MINT,
      owner: accountIndex === 1 ? FUNDER : 'VaultAuthority1111111111111111111111111111',
      programId: over.programId ?? CLASSIC_TOKEN_PROGRAM,
      uiTokenAmount: { amount, decimals: 6 },
    }));
  return {
    blockTime: over.blockTime === undefined ? 1_800_000 : over.blockTime,
    meta: {
      err: over.err ?? null,
      preTokenBalances: bal(over.pre ?? [[1, '20000000'], [2, '0']]),
      postTokenBalances: bal(over.post ?? [[1, '9000000'], [2, '11000000']]),
    },
    transaction: { message: { accountKeys: keys.map((pubkey) => ({ pubkey })) } },
  };
}
const want = { vault: VAULT, mint: DEVNET_USDC_MINT, reference: REF, network: 'solana:devnet' };

describe('observeTokenTransfer: amounts only from finalized pre/post token balance deltas', () => {
  it('reads the vault credit, its source wallet and the reference', () => {
    expect(observeTokenTransfer(tx(), want)).toEqual({
      transfer: { status: 'finalized', network: 'solana:devnet', mint: DEVNET_USDC_MINT, destination: VAULT, amountUnits: 11_000_000, reference: REF, blockTimeMs: 1_800_000_000 },
      source: FUNDER,
    });
  });

  it('a transaction that failed is reported failed, whatever its balances', () => {
    expect(observeTokenTransfer(tx({ err: { InstructionError: [0, 'Custom'] } }), want).transfer.status).toBe('failed');
  });

  it('a Token-2022 look-alike with the same mint string and decimals is not the vault credit', () => {
    const seen = observeTokenTransfer(tx({ programId: TOKEN_2022 }), want).transfer;
    expect(seen.amountUnits).toBe(0);
  });

  it('a different mint credits nothing for the pinned mint', () => {
    expect(observeTokenTransfer(tx({ mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' }), want).transfer.amountUnits).toBe(0);
  });

  it('a transfer whose balances did not change the vault (e.g. a top-level instruction that failed silently) credits nothing', () => {
    expect(observeTokenTransfer(tx({ post: [[1, '20000000'], [2, '0']] }), want).transfer.amountUnits).toBe(0);
  });

  it('a credit made by an inner (CPI) instruction is still seen: only the balances count', () => {
    // No transfer instruction is inspected at all; the vault balance rose by 11 USDC.
    expect(observeTokenTransfer(tx(), want).transfer.amountUnits).toBe(11_000_000);
  });

  it('a vault that did not exist before the transaction counts from zero', () => {
    expect(observeTokenTransfer(tx({ pre: [[1, '20000000']] }), want).transfer.amountUnits).toBe(11_000_000);
  });

  it('a vault debit, or a credit too large for safe integers, is not a funding', () => {
    expect(observeTokenTransfer(tx({ pre: [[1, '0'], [2, '5']], post: [[1, '5'], [2, '0']] }), want).transfer.amountUnits).toBe(0);
    expect(() => observeTokenTransfer(tx({ post: [[1, '0'], [2, '99999999999999999999']] }), want)).toThrow(/too large/);
  });

  it('without the reference key, or without the vault in the transaction, nothing matches', () => {
    expect(observeTokenTransfer(tx({ keys: [FUNDER, FUNDER_ATA, VAULT, 'Other111111111111111111111111111111111111111', CLASSIC_TOKEN_PROGRAM] }), want).transfer.reference).toBe('');
    expect(observeTokenTransfer(tx({ keys: [FUNDER, FUNDER_ATA, 'Elsewhere11111111111111111111111111111111', REF, CLASSIC_TOKEN_PROGRAM] }), want).transfer.destination).toBe('');
  });

  it('a missing block time is carried as null (the verifier then refuses it)', () => {
    expect(observeTokenTransfer(tx({ blockTime: null }), want).transfer.blockTimeMs).toBeNull();
  });
});
