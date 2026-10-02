import { describe, expect, it } from 'vitest';
import { SOLANA_DEVNET_GENESIS_HASH } from '@pocket-qa/contracts';
import { DomainError } from './errors';
import { verifyTransfer, type ParsedTx, type TransferExpectation } from './transfer';

const SENDER = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
const RECIPIENT = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const SIG = 'sig' + 'A'.repeat(84);
const createdAt = Date.parse('2026-10-02T12:00:00Z');
const expected: TransferExpectation = {
  sender: SENDER,
  recipient: RECIPIENT,
  lamports: 1_000_000,
  createdAtMs: createdAt,
  expiresAtMs: createdAt + 10 * 60_000,
  signature: SIG,
};

function tx(over: Partial<{ err: unknown; blockTime: number | null; source: string; destination: string; lamports: number; type: string; program: string; sig: string }> = {}): ParsedTx {
  return {
    slot: 1,
    blockTime: over.blockTime === undefined ? createdAt / 1000 + 30 : over.blockTime,
    meta: { err: over.err ?? null },
    transaction: {
      signatures: [over.sig ?? SIG],
      message: {
        instructions: [
          { program: 'spl-memo', parsed: 'demo' },
          {
            program: over.program ?? 'system',
            parsed: {
              type: over.type ?? 'transfer',
              info: { source: over.source ?? SENDER, destination: over.destination ?? RECIPIENT, lamports: over.lamports ?? 1_000_000 },
            },
          },
        ],
      },
    },
  };
}

const run = (t: ParsedTx | null, now = createdAt + 60_000, genesis = SOLANA_DEVNET_GENESIS_HASH) =>
  verifyTransfer({ expected, tx: t, genesisHash: genesis, nowMs: now });

describe('verifyTransfer', () => {
  it('confirms only an exact devnet system transfer', () => {
    expect(run(tx())).toEqual({ status: 'confirmed', reason: null });
  });

  it('refuses any non-devnet cluster outright', () => {
    expect(() => run(tx(), undefined, '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')).toThrowError(DomainError);
  });

  it('stays pending while the transaction is unseen or unfinalized, then expires', () => {
    expect(run(null).status).toBe('pending');
    expect(run(tx({ blockTime: null })).status).toBe('pending');
    expect(run(null, expected.expiresAtMs + 1).status).toBe('expired');
  });

  it('fails a transaction that errored on chain', () => {
    expect(run(tx({ err: { InstructionError: [0, 'Custom'] } }))).toMatchObject({ status: 'failed' });
  });

  it.each([
    ['wrong recipient', { destination: SENDER }],
    ['wrong sender', { source: RECIPIENT }],
    ['wrong amount', { lamports: 999_999 }],
    ['not a transfer', { type: 'createAccount' }],
    ['not the system program', { program: 'spl-token' }],
    ['different signature', { sig: 'other' }],
  ])('fails on %s', (_label, over) => {
    expect(run(tx(over)).status).toBe('failed');
  });

  it('fails a transaction that predates the intent (replayed old transfer)', () => {
    expect(run(tx({ blockTime: createdAt / 1000 - 3600 })).status).toBe('failed');
  });

  it('handles a transaction with no parsed instructions', () => {
    const bare: ParsedTx = { ...tx(), transaction: { signatures: [SIG], message: { instructions: [] } } };
    expect(run(bare).status).toBe('failed');
  });
});
