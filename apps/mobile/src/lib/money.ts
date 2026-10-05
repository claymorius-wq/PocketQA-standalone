import type { StudyReward } from '@pocket-qa/contracts';
import { credits } from './format';

/**
 * Token amounts (ADR 0007) are whole base units everywhere; USDC has 6 decimals. Formatting and
 * parsing use string arithmetic only, so no floating point ever touches money. Every label names
 * its settlement: the local SIMULATION (no funds move), or the Squads DEVNET PILOT (ADR 0007 §10:
 * devnet test USDC with no value, test keys simulate every role). Never an unqualified asset name.
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

export type Settlement = 'simulated' | 'squads_devnet';
export const unitName = (s: Settlement = 'simulated') => (s === 'squads_devnet' ? 'devnet test USDC' : 'simulated USDC');
export const tokenAmount = (units: number, s: Settlement = 'simulated') => `${formatUnits(units)} ${unitName(s)}`;
/** The short qualifier every money label carries. */
export const settlementTag = (s: Settlement = 'simulated') => (s === 'squads_devnet' ? 'devnet pilot, no value' : 'simulation');
/** The pilot's standing disclosure (ADR 0007 §10). */
export const PILOT_DISCLOSURE =
  'Devnet test USDC, no value. Pilot: test keys simulate all roles (builder, Pocket QA, arbiter); this is not independent custody. A release needs two of three signers.';
export const devnetExplorerTx = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

export function rewardText(reward: StudyReward): string {
  return reward.kind === 'token' ? tokenAmount(reward.units, reward.settlement) : credits(reward.credits);
}

export type PaymentStatus = 'pending' | 'submitted' | 'confirmed' | 'failed';
/** One wording for every payment state, everywhere, always qualified by its settlement. */
export function paymentState(p: { status: PaymentStatus; failureReason: string | null; settlement?: Settlement }): { label: string; detail: string; tone: 'info' | 'success' | 'danger' } {
  if (p.settlement === 'squads_devnet') {
    switch (p.status) {
      case 'pending':
        return { label: 'Payment pending · devnet pilot', detail: 'Approved. Two of three signers will release devnet test USDC (no value) from the study vault to the frozen wallet.', tone: 'info' };
      case 'submitted':
        return { label: 'Payment submitted · devnet pilot', detail: 'Waiting for the devnet transaction to finalize.', tone: 'info' };
      case 'confirmed':
        return { label: 'Settled on devnet · test USDC, no value', detail: 'Finalized on Solana devnet. Pilot: test keys simulate all roles; not independent custody.', tone: 'success' };
      case 'failed':
        return { label: 'Payment failed · devnet pilot', detail: `${p.failureReason ?? 'The devnet transfer failed.'} No funds moved; it is retried automatically.`, tone: 'danger' };
    }
  }
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
