import type { StudyReward } from '@pocket-qa/contracts';
import { credits } from './format';

/**
 * Token amounts (ADR 0007) are whole base units everywhere; USDC has 6 decimals. Formatting and
 * parsing use string arithmetic only, so no floating point ever touches money. Every label says
 * the settlement is a simulation: nothing in this phase moves funds.
 */
const DECIMALS = 6;
const MAX_UNITS = 1_000_000_000_000;

export function formatUnits(units: number, decimals = DECIMALS): string {
  const digits = String(units).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, '').padEnd(2, '0');
  return `${whole}.${frac}`;
}

/** Exact base units from text like "1.5"; null if it isn't a positive amount with ≤ 6 decimals. */
export function parseUnits(text: string, decimals = DECIMALS): number | null {
  const m = new RegExp(`^(\\d+)(?:\\.(\\d{1,${decimals}}))?$`).exec(text.trim());
  if (!m) return null;
  const n = Number(`${m[1]}${(m[2] ?? '').padEnd(decimals, '0')}`);
  return Number.isSafeInteger(n) && n > 0 && n <= MAX_UNITS ? n : null;
}

export const tokenAmount = (units: number) => `${formatUnits(units)} simulated USDC`;

export function rewardText(reward: StudyReward): string {
  return reward.kind === 'token' ? tokenAmount(reward.units) : credits(reward.credits);
}

export type PaymentStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';
/** One wording for every payment state, everywhere, always qualified as a simulation. */
export function paymentState(p: { status: PaymentStatus; failureReason: string | null }): { label: string; detail: string; tone: 'info' | 'success' | 'danger' } {
  switch (p.status) {
    case 'pending':
      return { label: 'Payment pending · simulation', detail: 'Approved. The simulated settlement will send the reward to the frozen wallet.', tone: 'info' };
    case 'submitted':
      return { label: 'Payment submitted · simulation', detail: 'Waiting for the simulated settlement to finalize.', tone: 'info' };
    case 'confirmed':
      return { label: 'Settled · simulation, no funds moved', detail: 'The simulated settlement finalized this transfer. No real asset was sent.', tone: 'success' };
    case 'failed':
      return { label: 'Payment failed · simulation', detail: `${p.failureReason ?? 'The simulated transfer failed.'} Nothing was sent; it is retried automatically.`, tone: 'danger' };
  }
}
