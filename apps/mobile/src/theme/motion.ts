import { createContext, useContext, useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import {
  Easing,
  ReduceMotion,
  useReducedMotion,
  type EasingFunctionFactory,
  type WithSpringConfig,
  type WithTimingConfig,
} from 'react-native-reanimated';

// Lens motion system (Direction A v2 §11; docs/decisions/0005-lens-visual-system.md).
// Light is constant; glass moves under it. Everything here runs on the UI thread through
// Reanimated: only transform, opacity and shadow-layer opacity animate, never gradients, blur or
// shadow radii.

/** Named cubic-bezier easings, as CSS `cubic-bezier(x1, y1, x2, y2)` parameters. */
export const EASE = {
  lens: [0.22, 1, 0.36, 1], // default out: entrances, settles, sheet rise, uplight settle
  press: [0.2, 0, 0.4, 1], // press in
  release: [0.3, 1.5, 0.5, 1], // press release (transform) only: the 1px overshoot back; never opacity, never the tab tile
  exit: [0.5, 0, 0.75, 0], // exits, sheet close, back, the light cut
  refract: [0.65, 0, 0.35, 1], // light travelling: lens glint, caustic sweep
  uplight: [0.12, 0.8, 0.28, 1], // Uplight rise: warms fast, long tail
  roll: [0.2, 0.85, 0.25, 1.06], // credit digits settle with a 6% overshoot
  breathe: [0.37, 0, 0.63, 1], // live loops only
} as const satisfies Record<string, readonly [number, number, number, number]>;
export type EaseName = keyof typeof EASE;

/** Duration tokens (ms). Nothing in the product is shorter than tick or longer than settle per segment. */
export const DUR = { tick: 120, release: 180, swap: 240, enter: 320, sheet: 420, rise: 560, settle: 700 } as const;
/**
 * Loop periods (ms): the live breath, the rib drift while recording, and `cycle-spin` (§11.2, round 4):
 * every spinner turns once per 800ms, linear; reduced motion slows it to 1600ms and never freezes it
 * (a frozen spinner reads as a hang).
 */
export const CYCLE = { breathe: 1400, drift: 5600, spin: 800, spinReduced: 1600 } as const;
/** Entrance choreography: content starts at 80ms, 40ms apart, at most five steps (later items join the fifth). */
export const STAGGER = { step: 40, maxSteps: 5, contentStart: 80, subtitleDelay: 40 } as const;
/**
 * Springs (RN), round 4: both near critical damping (tab ζ ≈ 0.87, sheet ζ ≈ 0.92), so the tile
 * lands in its slot and the sheet does not bounce past its rest. Tab ≈ 320ms, sheet ≈ 420ms.
 */
export const SPRING = {
  tab: { damping: 30, stiffness: 300, mass: 1 },
  sheet: { damping: 32, stiffness: 300, mass: 1 },
} as const;
/** Distances (dp) and levels the signature motions use. */
export const MOTION_DISTANCE = {
  entranceRise: 10,
  headerRise: 6,
  tabContentRise: 6,
  pushIn: 24,
  pushOutDrift: 12,
  press: 1,
  shimmerSlide: 16,
  ribDrift: 6,
  moteRise: 6,
} as const;
export const MOTION_LEVEL = {
  pushOutDim: 0.85,
  pressCausticScale: 0.6,
  coreScale: 1.06,
  glowFrom: 0.8,
  ledFrom: 0.55,
  coreIdle: 0.3, // the record core's unlit body (the motion board's recorder at rest)
  reducedSteady: 0.9,
  backdrop: 0.62,
  motePeak: 0.6,
} as const;
/** Uplight grades (intensity u over time), §10.4. */
export const UPLIGHT = {
  commit: { rise: DUR.rise, hold: 120, fall: DUR.settle, rest: 0 }, // 1380ms pass, then gone
  earned: { rise: DUR.rise, settle: DUR.settle, rest: 0.45 },
  live: { from: 0.72, to: 1, cycle: CYCLE.breathe, reducedRest: 0.86 },
  pilot: { signIn: 0.35, sheet: 0.55, delay: 260, rise: DUR.rise },
  // lq-land (C4): a Commit pass's tail landing on its subject's uplit layer, 0 → 0.6 over 240 ease-lens, → 0 over 700 ease-lens.
  land: { peak: 0.6, rise: DUR.swap, fall: DUR.settle },
  cut: DUR.release, // the light cut on stop / sheet close: never a gentle fade
  floorScaleFrom: 0.3,
  moteDuration: DUR.settle, // 700: no segment is longer than dur-settle (§11.1)
} as const;
/** Signature-motion timings that are not plain duration tokens. */
export const SIGNATURE = {
  glintDelay: 220,
  sweepBandWidth: 0.34,
  sweepAngle: 105,
  sweepFrom: -1.4,
  sweepTo: 3.3,
  /** S4 never plays twice in a row: a sweep within this long of the last one is skipped (C4, §11.5). */
  sweepGuard: 1200,
  rollColumnDelay: 40,
  rollLedgerDelay: 600,
  lockStep: 40,
} as const;

const bezier = (name: EaseName): EasingFunctionFactory => {
  const [x1, y1, x2, y2] = EASE[name];
  return Easing.bezier(x1, y1, x2, y2);
};
const EASINGS: Record<EaseName, EasingFunctionFactory> = {
  lens: bezier('lens'),
  press: bezier('press'),
  release: bezier('release'),
  exit: bezier('exit'),
  refract: bezier('refract'),
  uplight: bezier('uplight'),
  roll: bezier('roll'),
  breathe: bezier('breathe'),
};

// Every config opts out of Reanimated's own reduced-motion handling: the policy below already
// resolved the reduced variant (a 120ms fade, a steady level), and ReduceMotion.System would turn
// those into instant jumps.
const timing = (duration: number, ease: EaseName): WithTimingConfig => ({ duration, easing: EASINGS[ease], reduceMotion: ReduceMotion.Never });
const spring = (c: { damping: number; stiffness: number; mass: number }): WithSpringConfig => ({ ...c, reduceMotion: ReduceMotion.Never });

export type Motion = {
  reduced: boolean;
  ease: Record<EaseName, EasingFunctionFactory>;
  timing: {
    pressIn: WithTimingConfig;
    release: WithTimingConfig;
    tick: WithTimingConfig;
    swap: WithTimingConfig;
    enter: WithTimingConfig;
    exit: WithTimingConfig;
    back: WithTimingConfig;
    sheetOpen: WithTimingConfig; // web and the backdrop / key-pool dim
    sheetClose: WithTimingConfig;
    rise: WithTimingConfig; // Uplight rise, number roll, caustic sweep, glint
    settle: WithTimingConfig;
    refract: WithTimingConfig;
    roll: WithTimingConfig;
    breatheHalf: WithTimingConfig; // one direction of a live loop; repeat with reverse
    cut: WithTimingConfig;
  };
  /** null: jump to the end value (reduced motion). */
  spring: { tab: WithSpringConfig | null; sheet: WithSpringConfig | null };
  entrance: {
    duration: number;
    rise: number;
    headerRise: number;
    /** Delay (ms) for the i-th content item, capped at the fifth step. */
    delay: (index: number) => number;
    subtitleDelay: number;
  };
  press: { translate: number };
  /** Signature motions that are dropped entirely under reduced motion. */
  play: { shimmer: boolean; causticSweep: boolean; motes: boolean; ribDrift: boolean; numberRoll: boolean; breathe: boolean; uplightCommit: boolean };
  /** Live loops (record core, LED): null breathes, a number holds that level. */
  liveSteady: number | null;
  /** Uplight Live grade: null breathes, a number holds that level. */
  uplightLiveSteady: number | null;
};

function resolveMotion(reduced: boolean): Motion {
  const fade = timing(DUR.tick, 'lens');
  return {
    reduced,
    ease: EASINGS,
    timing: {
      pressIn: timing(DUR.tick, 'press'),
      release: timing(DUR.release, 'release'),
      tick: timing(DUR.tick, 'lens'),
      swap: timing(DUR.swap, 'lens'),
      enter: reduced ? fade : timing(DUR.enter, 'lens'),
      exit: reduced ? fade : timing(DUR.swap, 'exit'),
      back: reduced ? fade : timing(DUR.swap, 'exit'),
      sheetOpen: reduced ? fade : timing(DUR.sheet, 'lens'),
      sheetClose: reduced ? fade : timing(DUR.swap, 'exit'),
      rise: timing(DUR.rise, 'uplight'),
      settle: timing(DUR.settle, 'lens'),
      refract: timing(DUR.rise, 'refract'),
      roll: timing(DUR.rise, 'roll'),
      breatheHalf: timing(CYCLE.breathe / 2, 'breathe'),
      cut: timing(DUR.release, 'exit'),
    },
    spring: reduced ? { tab: null, sheet: null } : { tab: spring(SPRING.tab), sheet: spring(SPRING.sheet) },
    entrance: {
      duration: reduced ? DUR.tick : DUR.enter,
      rise: reduced ? 0 : MOTION_DISTANCE.entranceRise,
      headerRise: reduced ? 0 : MOTION_DISTANCE.headerRise,
      delay: reduced ? () => 0 : (i) => STAGGER.contentStart + Math.min(Math.max(0, i), STAGGER.maxSteps - 1) * STAGGER.step,
      subtitleDelay: reduced ? 0 : STAGGER.subtitleDelay,
    },
    press: { translate: reduced ? 0 : MOTION_DISTANCE.press },
    play: {
      shimmer: !reduced,
      causticSweep: !reduced,
      motes: !reduced,
      ribDrift: !reduced,
      numberRoll: !reduced,
      breathe: !reduced,
      uplightCommit: !reduced,
    },
    liveSteady: reduced ? MOTION_LEVEL.reducedSteady : null,
    uplightLiveSteady: reduced ? UPLIGHT.live.reducedRest : null,
  };
}

export const FULL_MOTION: Motion = resolveMotion(false);
export const REDUCED_MOTION: Motion = resolveMotion(true);

/** Reads the OS reduce-motion setting and follows changes while `active`. */
export function useReduceMotionSetting(active = true): boolean {
  // Reanimated reads the setting synchronously at startup, so the first frame is already right;
  // AccessibilityInfo then tracks changes made while the app runs.
  const atStartup = useReducedMotion();
  const [reduced, setReduced] = useState(atStartup);
  useEffect(() => {
    if (!active) return;
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (live) setReduced(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduced(v));
    return () => {
      live = false;
      sub.remove();
    };
  }, [active]);
  return reduced;
}

const MotionContext = createContext<Motion | null>(null);
/** ThemeProvider provides the resolved motion once for the whole tree. */
export const MotionProvider = MotionContext.Provider;

/** Motion tokens resolved for the current reduce-motion setting. */
export function useMotion(): Motion {
  const provided = useContext(MotionContext);
  const reduced = useReduceMotionSetting(provided === null);
  return provided ?? (reduced ? REDUCED_MOTION : FULL_MOTION);
}
