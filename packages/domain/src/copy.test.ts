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
    ]) {
      expect(lintCopy(text), text).toEqual([]);
    }
  });

  it('assertCleanCopy names the offending field', () => {
    expect(() => assertCleanCopy({ title: 'Fine', objective: 'Guaranteed payout' })).toThrowError(/objective/);
    expect(() => assertCleanCopy({ title: 'Fine', objective: 'Find onboarding friction.' })).not.toThrow();
  });
});
