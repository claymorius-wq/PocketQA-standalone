import { createContext, useContext } from 'react';
import type { SharedValue } from 'react-native-reanimated';

/**
 * The screen's key light (§2): one permanent pool from the top-left whose exposure is
 * 1 at rest, 0.72 while an Uplight moment is lit and 0.4 behind any sheet. Ground owns it;
 * every useUplight registers its intensity and the pool follows the brightest one, so a dark
 * or unmounting moment never overrides one that is still lit. A sheet writes `sheet`.
 */
export type KeyLight = {
  /** Adds one Uplight moment's intensity u; returns its release (call on unmount). */
  register: (u: SharedValue<number>) => () => void;
  /** Sheet progress, 0 closed → 1 open; it follows the sheet's own open/close timing. */
  sheet: SharedValue<number>;
};

export const KeyLightContext = createContext<KeyLight | null>(null);

/** The enclosing Ground's key light, or null outside a Ground (nothing to dim). */
export function useKeyLight(): KeyLight | null {
  return useContext(KeyLightContext);
}

// "Lit" for the key light means at least the lowest resting grade (Pilot, 0.35): any shown moment
// dims the pool fully to 0.72, a Commit pass dims it while it is bright and releases it as it leaves.
const LIT_AT = 0.35;

/** Key-pool opacity for the current uplight and sheet levels (worklet; plain numbers so nothing captures token objects). */
export function keyExposure(rest: number, uplitLevel: number, sheetLevel: number, uplight: number, sheet: number): number {
  'worklet';
  const lit = Math.min(1, Math.max(0, uplight / LIT_AT));
  const s = Math.min(1, Math.max(0, sheet));
  const uplit = rest + (uplitLevel - rest) * lit;
  const behindSheet = rest + (sheetLevel - rest) * s;
  return Math.min(uplit, behindSheet);
}
