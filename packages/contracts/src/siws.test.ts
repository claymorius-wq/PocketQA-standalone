import { describe, expect, it } from 'vitest';
import { createSignInMessageText } from '@solana/wallet-standard-util';
import { buildSiwsMessage } from './siws';

const input = {
  domain: 'pocketqa.local',
  address: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV',
  statement: 'Link this devnet wallet to your Pocket QA account. This is not a payment.',
  uri: 'https://pocketqa.local',
  version: '1',
  chainId: 'solana:devnet',
  nonce: 'abcDEF1234567890',
  issuedAt: '2026-10-02T12:00:00.000Z',
  expirationTime: '2026-10-02T12:05:00.000Z',
};

describe('buildSiwsMessage', () => {
  it('is byte-identical to the wallet-standard reference', () => {
    expect(buildSiwsMessage(input)).toBe(createSignInMessageText(input));
  });
  it('matches without statement', () => {
    const { statement: _s, ...rest } = input;
    expect(buildSiwsMessage(rest)).toBe(createSignInMessageText(rest));
  });
  it('binds every security field into the text', () => {
    const text = buildSiwsMessage(input);
    for (const v of [input.domain, input.address, input.chainId, input.nonce, input.issuedAt, input.expirationTime]) {
      expect(text).toContain(v);
    }
  });
});
