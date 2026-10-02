import { describe, expect, it } from 'vitest';
import { assertCleanCopy, lintCopy } from './copy';

describe('copy linter', () => {
  it('flags earnings promises and fake-payment language', () => {
    for (const text of [
      'Guaranteed rewards for every tester!',
      'Earn money while you test',
      'Make $50 an hour',
      'Passive income from your phone',
      'Get paid instantly',
      'Cash out your earnings',
      'Free money airdrop',
      'Your payment is complete',
      'AI-generated insights about your app',
      'You’ve been paid',
      "You've been paid — payout of 50 USDC sent to your wallet",
      'Payout processed',
      'Payouts every Friday',
      'We transferred 0.5 SOL to your wallet',
      'Bonus: $20 for this task',
      'Reward: 10 USDT',
    ]) {
      expect(lintCopy(text).length, text).toBeGreaterThan(0);
    }
  });

  it('allows honest product copy', () => {
    for (const text of [
      'Reward if approved · Not guaranteed',
      'Test credits · no cash value',
      'Analysis unavailable',
      'Devnet demo · no real value',
      'Record your screen only while doing the tasks below.',
      'Rejected: no evidence for task 2.',
      'Test credits are not paid out and have no cash value.',
      'No payouts: rewards are test credits only.',
      'Devnet demo transfer · not a reward payout',
    ]) {
      expect(lintCopy(text), text).toEqual([]);
    }
  });

  it('assertCleanCopy names the offending field', () => {
    expect(() => assertCleanCopy({ title: 'Fine', objective: 'Guaranteed payout' })).toThrowError(/objective/);
    expect(() => assertCleanCopy({ title: 'Fine', objective: 'Find onboarding friction.' })).not.toThrow();
  });
});
