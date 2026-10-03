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

describe('copy scopes', () => {
  // Study content describes the app under test (shops, payments, wallets): only earnings
  // promises are banned there. Reviewer text to testers and app UI ban payment claims too.
  const taskText = [
    'Upgrade to the paid plan and check the receipt',
    'Buy the $5 item and reach checkout',
    'Check the price shows $19.99',
    'Send 0.1 SOL to the test address on devnet',
    'Verify the payment is successful',
  ];

  it('allows payment and currency wording in study content', () => {
    for (const t of taskText) expect(lintCopy(t, 'study'), t).toEqual([]);
  });

  it('still blocks earnings promises in study content', () => {
    for (const t of ['Earn money while you test', 'Guaranteed rewards!', 'Get paid for every session', 'Free crypto airdrop']) {
      expect(lintCopy(t, 'study').length, t).toBeGreaterThan(0);
    }
  });

  // Review r1 P2: the study scope must still block money promised to testers, which they
  // read on Discover and the study page, while allowing text about the app under test.
  const testerMoney = [
    'Payout: 20 USDC per tester',
    'Testers receive $25 each',
    'Bonus: $20 for completing this flow',
    'You will get 5 SOL after the session',
    '$10 per participant',
    'Compensation of 15 EUR',
    'Each tester gets $5',
    'Payouts weekly',
    // Review r2 P3: natural phrasings that slipped through.
    'Complete this study to receive 10 USDC',
    '20 USDC for joining',
    'Top 3 testers win $100',
    "We'll send you 5 SOL after the session",
  ];

  it('blocks money promised to testers in study content', () => {
    for (const t of testerMoney) expect(lintCopy(t, 'study').length, t).toBeGreaterThan(0);
  });

  it('still allows app-describing money wording next to tester-facing words', () => {
    for (const t of ['Check that you can buy the $5 item', 'Each item costs $3; add two to the cart', 'Send 0.1 SOL on devnet to the address shown', 'No payouts: rewards are test credits', 'The receipt shows $5. Testers receive a confirmation email afterwards.', 'Add the $5 item to the cart to get free shipping', 'Pay $5 to unlock the premium plan']) {
      expect(lintCopy(t, 'study'), t).toEqual([]);
    }
  });

  it('blocks payment claims in reviewer text (the default scope)', () => {
    for (const t of ['You’ve been paid', 'Payout processed', 'We transferred 0.5 SOL to your wallet', 'Bonus $20', 'Your payment is complete']) {
      expect(lintCopy(t, 'reviewer').length, t).toBeGreaterThan(0);
      expect(lintCopy(t).length, t).toBeGreaterThan(0);
    }
  });

  it('assertCleanCopy applies the requested scope', () => {
    expect(() => assertCleanCopy({ tasks: 'Buy the $5 item' }, 'study')).not.toThrow();
    expect(() => assertCleanCopy({ note: 'Bonus $5 sent' }, 'reviewer')).toThrowError(/note/);
  });
});
