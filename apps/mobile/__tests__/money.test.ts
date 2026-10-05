import { devnetExplorerTx, formatUnits, parseUnits, paymentState, PILOT_DISCLOSURE, rewardText, tokenAmount } from '../src/lib/money';

// Token amounts are whole base units end to end; the app formats and parses them with string
// arithmetic only, never floating point (pqa-qa matrix I2).
describe('formatUnits', () => {
  it.each([
    [1_000_000, '1.00'],
    [1_500_000, '1.50'],
    [1, '0.000001'],
    [123_456_789, '123.456789'],
    [0, '0.00'],
    [100_000_000_000, '100,000.00'],
  ])('%i units → %s', (units, text) => expect(formatUnits(units)).toBe(text));
});

describe('parseUnits', () => {
  it.each([
    ['1', 1_000_000],
    ['1.5', 1_500_000],
    ['0.000001', 1],
    ['0.1', 100_000],
    ['2.30', 2_300_000],
    ['100000', 100_000_000_000],
  ])('%s → %i units, exactly', (text, units) => expect(parseUnits(text)).toBe(units));

  it.each(['', '0', '0.0', '-1', '1.0000001', '1e3', '1,5', 'abc', '1.', '.5', '1000001'])('rejects %j', (text) => expect(parseUnits(text)).toBeNull());

  it('0.1 + 0.2 style inputs stay exact', () => {
    expect(parseUnits('0.3')).toBe(300_000);
    expect(formatUnits(parseUnits('0.3')!)).toBe('0.30');
  });
});

describe('labels say simulation, never paid', () => {
  it('names the asset as simulated', () => {
    expect(tokenAmount(1_000_000)).toBe('1.00 simulated USDC');
    expect(rewardText({ kind: 'token', asset: 'USDC', decimals: 6, units: 2_500_000, settlement: 'simulated' })).toBe('2.50 simulated USDC');
    expect(rewardText({ kind: 'test_credits', credits: 50 })).toBe('50 test credits');
  });

  it('every payment state is qualified and none says paid', () => {
    const states = (['pending', 'submitted', 'confirmed', 'failed'] as const).map((status) => paymentState({ status, failureReason: status === 'failed' ? 'No token account (simulated).' : null }));
    expect(states.map((s) => s.label)).toEqual(['Payment pending · simulation', 'Payment submitted · simulation', 'Settled · simulation, no funds moved', 'Payment failed · simulation']);
    for (const s of states) {
      expect(`${s.label} ${s.detail}`).not.toMatch(/\bpaid\b/i);
      expect(`${s.label} ${s.detail}`).toMatch(/simulat/i);
    }
    expect(states[3]!.detail).toContain('No token account');
  });
});

describe('the Squads devnet pilot (ADR 0007 §10): devnet test USDC, no value, never paid or trustless', () => {
  it('names the asset as devnet test USDC', () => {
    expect(tokenAmount(1_000_000, 'squads_devnet')).toBe('1.00 devnet test USDC');
    expect(rewardText({ kind: 'token', asset: 'USDC', decimals: 6, units: 2_500_000, settlement: 'squads_devnet' })).toBe('2.50 devnet test USDC');
  });

  it('every payment state says devnet, and the settled one says no value and the pilot disclosure', () => {
    const states = (['pending', 'submitted', 'confirmed', 'failed'] as const).map((status) => paymentState({ status, failureReason: null, settlement: 'squads_devnet' }));
    expect(states.map((s) => s.label)).toEqual(['Payment pending · devnet pilot', 'Payment submitted · devnet pilot', 'Settled on devnet · test USDC, no value', 'Payment failed · devnet pilot']);
    for (const s of states) expect(`${s.label} ${s.detail}`).not.toMatch(/\bpaid\b|trustless|simulation|simulated/i);
    expect(states[2]!.detail).toMatch(/test keys simulate all roles; not independent custody/);
    expect(PILOT_DISCLOSURE).toMatch(/Devnet test USDC, no value\. Pilot: test keys simulate all roles.*not independent custody.*two of three signers/);
    expect(devnetExplorerTx('Sig1')).toBe('https://explorer.solana.com/tx/Sig1?cluster=devnet');
  });
});
