import { DUR, type Motion } from '../theme/motion';

// Entrance choreography (Direction A §11.3): light first, then the header (title t=0, subtitle
// t=40, rising 6), then content from t=80, 40ms apart, at most five steps, rising 10, 320ms
// ease-lens. Done by 700ms. The kit's Screen drives it with shared values (src/ui/screen.tsx
// Enter), never Reanimated `entering` layout animations, which broke inside web tab scenes.

/** `title` and `subtitle` are the header; a number is the content position, top to bottom. */
export type EntranceStep = 'title' | 'subtitle' | number;

/** Everything in a screen's entrance, the primary's caustic included, has finished by then. */
export const ENTRANCE_WINDOW = DUR.settle;

/** Delay (ms) of a step from the start of its wave. */
export function entranceDelay(motion: Motion, step: EntranceStep): number {
  if (motion.reduced) return 0;
  if (step === 'title') return 0;
  if (step === 'subtitle') return motion.entrance.subtitleDelay;
  return motion.entrance.delay(step);
}

/**
 * Delay (ms, from the wave start) at which the primary's caustic starts to fade in: when the
 * button's own entrance ends (§11.3.4), but never so late that it overruns ENTRANCE_WINDOW.
 * The two rules conflict for every content step (step 0 ends at 400, +320 = 720), so the window wins.
 */
export function causticDelay(motion: Motion, step: EntranceStep): number {
  if (motion.reduced) return 0;
  const buttonEnds = entranceDelay(motion, step) + motion.entrance.duration;
  return Math.min(buttonEnds, ENTRANCE_WINDOW - DUR.enter);
}

export type Wave = { start: number };

/**
 * Joins `wave` at time `now` and returns the ms since the wave started. A mount after the
 * entrance window starts a new wave at `now`, so a late list still staggers top to bottom.
 */
export function joinWave(wave: Wave, now: number): number {
  if (now - wave.start > ENTRANCE_WINDOW) wave.start = now;
  return now - wave.start;
}
