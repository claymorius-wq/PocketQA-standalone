import { recordingCapability, walletCapability, transferSignCapability } from '../src/lib/capability';

describe('capability matrix', () => {
  it('records only on Android 10+ builds with the recorder module', () => {
    expect(recordingCapability('android', 34, () => true)).toEqual({ available: true });
    expect(recordingCapability('android', 34, () => false).available).toBe(false);
    expect(recordingCapability('android', 28, () => true).available).toBe(false);
    expect(recordingCapability('ios', '18.0', () => true).available).toBe(false);
    expect(recordingCapability('web', 0, () => true).available).toBe(false);
  });
  it('explains every unavailable state', () => {
    for (const c of [recordingCapability('web', 0), recordingCapability('ios', '18'), recordingCapability('android', 28, () => true)]) {
      expect(c.available ? '' : c.reason).toMatch(/\w+/);
    }
  });
  it('wallet linking (MWA) is Android only', () => {
    expect(walletCapability('android').available).toBe(true);
    expect(walletCapability('web').available).toBe(false);
    expect(walletCapability('ios').available).toBe(false);
    // Web links through a Wallet Standard extension when one is installed (ADR 0005 §4).
    expect(walletCapability('web', () => 1).available).toBe(true);
    expect(walletCapability('web', () => 0)).toMatchObject({ available: false, reason: expect.stringMatching(/wallet extension/) });
    // Never on the shared demo preview, even with a wallet installed (increment-4 review r1 P2).
    expect(walletCapability('web', () => 1, true)).toMatchObject({ available: false, reason: expect.stringMatching(/shared preview/) });
    // Transfers are signed only through MWA on Android.
    expect(transferSignCapability('android').available).toBe(true);
    expect(transferSignCapability('web').available).toBe(false);
  });
});
