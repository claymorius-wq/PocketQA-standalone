import { DomainError } from './errors';

/**
 * Blocks earnings promises, fake-payment and fake-AI language in app copy and in
 * builder-entered study text. Rewards are test credits that are never guaranteed.
 */
const BANNED: { id: string; re: RegExp }[] = [
  { id: 'earn-money', re: /\b(earn|make)\s+(real\s+)?(money|cash|\$|usd|income)/i },
  { id: 'dollar-rate', re: /\bmake\s+\$\d+/i },
  { id: 'earnings', re: /\bearnings?\b/i },
  { id: 'passive-income', re: /\bpassive\s+income\b/i },
  { id: 'get-paid', re: /\bget(ting)?\s+paid\b/i },
  { id: 'cash-out', re: /\bcash[\s-]?out\b/i },
  { id: 'free-money', re: /\bfree\s+(money|crypto|tokens?)\b/i },
  { id: 'airdrop', re: /\bairdrops?\b/i },
  { id: 'payment-complete', re: /\bpayment\s+(is\s+)?(complete|completed|sent|successful)\b/i },
  { id: 'ai-insights', re: /\bAI[-\s]?(generated|powered)\s+(insights?|analysis|findings?)\b/i },
  { id: 'sent-to-wallet', re: /\b(sent|transferred|paid)\b[^.]{0,40}\bto\s+your\s+wallet\b/i },
  { id: 'currency-amount', re: /\$\s?\d|\b\d+(\.\d+)?\s*(usdc|usdt|usd|eur|sol|skr|btc|eth)\b/i },
];

// "paid" and "payout" claim real money moved; rewards here are test credits and Pocket QA
// never pays. Negated forms ("not paid out", "No payouts", "not a reward payout") are the
// honest disclaimers the app itself uses, so they're stripped before matching.
const NEGATED_PAY = /\b(not|never|no)\s+(a\s+)?(reward\s+)?(paid|pay-?outs?)\b/gi;
const PAY = /\b(paid|pay-?outs?)\b/i;

// Negated forms ("Not guaranteed", "no guarantee") are honest and allowed. Stripped first
// instead of using lookbehind, which not every JS engine the app runs on supports.
const NEGATED_GUARANTEE = /\b(not|never|no)\s+guarantee(d|s)?\b/gi;
const GUARANTEE = /\bguarantee(d|s)?\b/i;

export function lintCopy(text: string): string[] {
  const hits = BANNED.filter((b) => b.re.test(text)).map((b) => b.id);
  if (GUARANTEE.test(text.replace(NEGATED_GUARANTEE, ''))) hits.unshift('guarantee');
  if (PAY.test(text.replace(NEGATED_PAY, ''))) hits.push('paid-payout');
  return hits;
}

export function assertCleanCopy(fields: Record<string, string | undefined>): void {
  for (const [field, value] of Object.entries(fields)) {
    if (!value) continue;
    const hits = lintCopy(value);
    if (hits.length) {
      throw new DomainError('VALIDATION', `${field} contains wording that promises earnings or payment (${hits.join(', ')}).`);
    }
  }
}
