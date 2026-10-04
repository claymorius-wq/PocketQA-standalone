import { describe, expect, it } from 'vitest';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { buildSiwsMessage, type SiwsInput } from '@pocket-qa/contracts';
import { DomainError } from './errors';
import { verifyWalletLink, verifyWalletLogin, type LoginChallengeRecord, type NonceRecord } from './wallet';
import { utf8Bytes } from './utf8';

const sk = ed25519.utils.randomSecretKey();
const address = base58.encode(ed25519.getPublicKey(sk));
const otherSk = ed25519.utils.randomSecretKey();
const issued = Date.parse('2026-10-02T12:00:00.000Z');

const input: SiwsInput = {
  domain: 'pocketqa.local',
  address,
  statement: 'Link this devnet wallet to your Pocket QA account. This is not a payment.',
  uri: 'https://pocketqa.local',
  version: '1',
  chainId: 'solana:devnet',
  nonce: 'abcDEF1234567890xyz',
  issuedAt: new Date(issued).toISOString(),
  expirationTime: new Date(issued + 300_000).toISOString(),
};
const record: NonceRecord = { userId: 'u1', address, nonce: input.nonce, input, expiresAtMs: issued + 300_000, usedAtMs: null };

function signed(text = buildSiwsMessage(input), key = sk) {
  const bytes = utf8Bytes(text);
  return { signedMessage: bytes, signature: ed25519.sign(bytes, key) };
}

function expectNonceInvalid(fn: () => unknown, why: RegExp) {
  let err: unknown;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe('NONCE_INVALID');
  expect((err as DomainError).message).toMatch(why);
}

describe('verifyWalletLink', () => {
  const now = issued + 10_000;
  const req = () => ({ userId: 'u1', address, nonce: input.nonce, ...signed() });

  it('accepts the exact server-issued SIWS message signed by the address', () => {
    expect(verifyWalletLink({ record, request: req(), nowMs: now })).toEqual({ address });
  });

  it('rejects an unknown nonce', () => {
    expectNonceInvalid(() => verifyWalletLink({ record: null, request: req(), nowMs: now }), /unknown/);
  });

  it('rejects replay of a used nonce', () => {
    expectNonceInvalid(() => verifyWalletLink({ record: { ...record, usedAtMs: now - 1 }, request: req(), nowMs: now }), /used/);
  });

  it('rejects an expired nonce', () => {
    expectNonceInvalid(() => verifyWalletLink({ record, request: req(), nowMs: record.expiresAtMs }), /expired/);
  });

  it('rejects cross-account use', () => {
    expectNonceInvalid(() => verifyWalletLink({ record, request: { ...req(), userId: 'attacker' }, nowMs: now }), /account/);
  });

  it('rejects a different address or nonce than the one issued', () => {
    const otherAddr = base58.encode(ed25519.getPublicKey(otherSk));
    expectNonceInvalid(() => verifyWalletLink({ record, request: { ...req(), address: otherAddr }, nowMs: now }), /address/);
    expectNonceInvalid(() => verifyWalletLink({ record, request: { ...req(), nonce: 'zzzzzzzzzzzzzzzzzz' }, nowMs: now }), /nonce/i);
  });

  it('rejects a message with the wrong domain or network', () => {
    expectNonceInvalid(() => verifyWalletLink({ record, request: { ...req(), ...signed(buildSiwsMessage({ ...input, domain: 'evil.example' })) }, nowMs: now }), /message/);
    expectNonceInvalid(() => verifyWalletLink({ record, request: { ...req(), ...signed(buildSiwsMessage({ ...input, chainId: 'solana:mainnet' })) }, nowMs: now }), /message/);
  });

  it('rejects a signature from another key', () => {
    expectNonceInvalid(() => verifyWalletLink({ record, request: { ...req(), ...signed(undefined, otherSk) }, nowMs: now }), /signature/);
  });

  it('rejects malformed signature bytes or a non-32-byte address', () => {
    expectNonceInvalid(() => verifyWalletLink({ record, request: { ...req(), signature: new Uint8Array(10) }, nowMs: now }), /signature/);
    const shortAddr = base58.encode(new Uint8Array(31).fill(7));
    expectNonceInvalid(
      () => verifyWalletLink({ record: { ...record, address: shortAddr }, request: { ...req(), address: shortAddr }, nowMs: now }),
      /address/,
    );
  });
});

describe('verifyWalletLogin (ADR 0005 §2)', () => {
  const loginInput: SiwsInput = { ...input, statement: 'Sign in to Pocket QA with this devnet wallet. This is not a payment and sends nothing.' };
  const login: LoginChallengeRecord = { address, nonce: loginInput.nonce, input: loginInput, expiresAtMs: issued + 300_000, usedAtMs: null };
  const req = (over: Partial<{ address: string; nonce: string }> = {}, s = signed(buildSiwsMessage(loginInput))) => ({ address, nonce: loginInput.nonce, ...s, ...over });

  it('accepts the exact challenge signed by the wallet', () => {
    expect(verifyWalletLogin({ record: login, request: req(), nowMs: issued + 1 })).toEqual({ address });
  });

  it('rejects unknown, used, expired, mismatched and wrongly signed attempts', () => {
    expectNonceInvalid(() => verifyWalletLogin({ record: null, request: req(), nowMs: issued }), /unknown/);
    expectNonceInvalid(() => verifyWalletLogin({ record: { ...login, usedAtMs: issued }, request: req(), nowMs: issued }), /already used/);
    expectNonceInvalid(() => verifyWalletLogin({ record: login, request: req(), nowMs: issued + 300_000 }), /expired/);
    expectNonceInvalid(() => verifyWalletLogin({ record: login, request: req({ nonce: 'zzzzzzzzzzzzzzzzzz' }), nowMs: issued }), /does not match/);
    expectNonceInvalid(() => verifyWalletLogin({ record: { ...login, address: 'x' }, request: req(), nowMs: issued }), /address/);
    // The link statement is a different message, so a link signature can't log in.
    expectNonceInvalid(() => verifyWalletLogin({ record: login, request: req({}, signed(buildSiwsMessage(input))), nowMs: issued }), /does not match the issued/);
    expectNonceInvalid(() => verifyWalletLogin({ record: login, request: req({}, signed(buildSiwsMessage(loginInput), otherSk)), nowMs: issued }), /signature is invalid/);
    const bogus = { ...loginInput, address: 'not-base58-0OIl' };
    expectNonceInvalid(
      () => verifyWalletLogin({ record: { ...login, address: bogus.address, input: bogus }, request: { ...req({ address: bogus.address }, signed(buildSiwsMessage(bogus))) }, nowMs: issued }),
      /not valid base58/,
    );
  });
});
