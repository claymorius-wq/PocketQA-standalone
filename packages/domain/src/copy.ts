import { DomainError } from './errors';

/**
 * Blocks earnings promises, fake-payment and fake-AI language. Rewards are test credits
 * that are never guaranteed.
 *
 * Two scopes:
 * - 'study': builder-entered study content (title, objective, tasks, consent). It may
 *   describe the app under test — prices, checkouts, devnet SOL, "paid plan" — so plain
 *   currency and payment wording is allowed. Testers read this text, though, so earnings
 *   promises, fake-AI claims, payouts, and money tied to testers ("$10 per tester",
 *   "testers receive $25", "bonus $20") stay banned.
 * - 'reviewer' (default): text Pocket QA or a reviewer addresses to testers (approve and
 *   reject notes, findings, dispute resolutions) and all app UI copy. Payment, payout and
 *   currency claims are banned here too, because they would read as real money moving.
 */
export type CopyScope = 'study' | 'reviewer';

// Money aimed at testers, matched by proximity (either order, same clause) so app text such
// as "Check that you can buy the $5 item" or "Each item costs $3" still passes.
const CURRENCY = String.raw`\$\s?\d|\b\d+(?:\.\d+)?\s*(?:usdc|usdt|usd|eur|sol|skr|btc|eth)\b|\b(?:usdc|usdt|usd|eur|sol)\s?\d`;
const TO_TESTERS = [
  String.raw`\b(?:per|for\s+each|each)\s+(?:tester|participant|person|session|test|completion|submission)s?\b`,
  String.raw`\b(?:testers?|participants?|you)\s+(?:will\s+|can\s+)?(?:get|gets|receive|receives|earn|win|wins|be\s+(?:paid|given|rewarded|compensated))\b`,
  // "to receive 10 USDC", "send you 5 SOL", "$20 for joining", "testers win $100". Not "to get",
  // which shopping tasks use ("to get free shipping").
  String.raw`\bto\s+(?:receive|earn|win)\b`,
  String.raw`\b(?:send|pay|give)s?\s+you\b`,
  String.raw`\bfor\s+(?:joining|completing|participating|taking\s+part|your\s+(?:time|feedback|participation))\b`,
].join('|');
const REWARD_WORD = String.raw`\b(?:bonus(?:es)?|rewards?|compensation|stipends?|incentives?|prizes?)\b`;
const near = (a: string, b: string) => new RegExp(`(?:${a})[^.;\n]{0,40}(?:${b})|(?:${b})[^.;\n]{0,40}(?:${a})`, 'i');

const BANNED: { id: string; re: RegExp; reviewerOnly?: true }[] = [
  { id: 'money-to-testers', re: near(CURRENCY, TO_TESTERS) },
  { id: 'reward-amount', re: near(CURRENCY, REWARD_WORD) },
  { id: 'earn-money', re: /\b(earn|make)\s+(real\s+)?(money|cash|\$|usd|income)/i },
  { id: 'dollar-rate', re: /\bmake\s+\$\d+/i },
  { id: 'earnings', re: /\bearnings?\b/i },
  { id: 'passive-income', re: /\bpassive\s+income\b/i },
  { id: 'get-paid', re: /\bget(ting)?\s+paid\b/i },
  { id: 'cash-out', re: /\bcash[\s-]?out\b/i },
  { id: 'free-money', re: /\bfree\s+(money|crypto|tokens?)\b/i },
  { id: 'airdrop', re: /\bairdrops?\b/i },
  { id: 'payment-complete', re: /\bpayment\s+(is\s+)?(complete|completed|sent|successful)\b/i, reviewerOnly: true },
  { id: 'ai-insights', re: /\bAI[-\s]?(generated|powered)\s+(insights?|analysis|findings?)\b/i },
  { id: 'sent-to-wallet', re: /\b(sent|transferred|paid)\b[^.]{0,40}\bto\s+your\s+wallet\b/i, reviewerOnly: true },
  { id: 'currency-amount', re: /\$\s?\d|\b\d+(\.\d+)?\s*(usdc|usdt|usd|eur|sol|skr|btc|eth)\b/i, reviewerOnly: true },
];

// "paid" and "payout" claim real money moved; rewards here are test credits and Pocket QA
// never pays. Negated forms ("not paid out", "No payouts", "not a reward payout") are the
// honest disclaimers the app itself uses, so they're stripped before matching.
const NEGATED_PAY = /\b(not|never|no)\s+(a\s+)?(reward\s+)?(paid|pay-?outs?)\b/gi;
const PAY = /\b(paid|pay-?outs?)\b/i;
const PAYOUT = /\bpay-?outs?\b/i;

// Negated forms ("Not guaranteed", "no guarantee") are honest and allowed. Stripped first
// instead of using lookbehind, which not every JS engine the app runs on supports.
const NEGATED_GUARANTEE = /\b(not|never|no)\s+guarantee(d|s)?\b/gi;
const GUARANTEE = /\bguarantee(d|s)?\b/i;

export function lintCopy(text: string, scope: CopyScope = 'reviewer'): string[] {
  const hits = BANNED.filter((b) => (scope === 'reviewer' || !b.reviewerOnly) && b.re.test(text)).map((b) => b.id);
  if (GUARANTEE.test(text.replace(NEGATED_GUARANTEE, ''))) hits.unshift('guarantee');
  if (scope === 'reviewer' && PAY.test(text.replace(NEGATED_PAY, ''))) hits.push('paid-payout');
  // Study text may say "paid plan" (the app under test), but never promise a payout.
  if (scope === 'study' && PAYOUT.test(text.replace(NEGATED_PAY, ''))) hits.push('payout');
  return hits;
}

export function assertCleanCopy(fields: Record<string, string | undefined>, scope: CopyScope = 'reviewer'): void {
  for (const [field, value] of Object.entries(fields)) {
    if (!value) continue;
    const hits = lintCopy(value, scope);
    if (hits.length) {
      throw new DomainError('VALIDATION', `${field} contains wording that promises earnings or payment (${hits.join(', ')}).`);
    }
  }
}
