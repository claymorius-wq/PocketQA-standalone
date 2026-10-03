import { walletErrorText } from '../src/wallet/errors';

const declined = 'The wallet request was declined or closed. Nothing was linked.';

describe('walletErrorText', () => {
  it('maps the Android "association cancelled" rejection (code is a sentence)', () => {
    const e = Object.assign(new Error('Local association cancelled by user'), { code: 'Session not established: Local association cancelled by user' });
    expect(walletErrorText(e)).toBe(declined);
  });
  it('maps protocol declines (-1, -3) and session close/timeout', () => {
    for (const code of [-1, -3, 'ERROR_SESSION_CLOSED', 'ERROR_SESSION_TIMEOUT', 'ERROR_ASSOCIATION_CANCELLED']) {
      expect(walletErrorText({ code, message: 'x' })).toBe(declined);
    }
  });
  it('explains a missing wallet and an expired nonce', () => {
    expect(walletErrorText({ code: 'ERROR_WALLET_NOT_FOUND' })).toMatch(/No Mobile Wallet Adapter wallet/);
    expect(walletErrorText({ code: 'NONCE_INVALID', message: 'Nonce has expired.' })).toMatch(/expired or was already used/);
  });
  it('passes through other API messages (e.g. one-address-one-account)', () => {
    expect(walletErrorText({ code: 'CONFLICT_STATE', message: 'This wallet is already linked to another account.' })).toBe('This wallet is already linked to another account.');
  });
});

describe('walletErrorText: send failures', () => {
  it('explains a wallet that signed but could not submit (e.g. no devnet SOL for fees)', () => {
    for (const code of [-2, -4]) {
      expect(walletErrorText({ code, message: 'payloads invalid for signing' })).toBe(
        'The wallet could not send the transaction (it may have no devnet SOL for fees). Nothing was sent.',
      );
    }
  });
});
