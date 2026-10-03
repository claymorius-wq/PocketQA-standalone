import { useEffect, useRef, useState } from 'react';
import { Easing, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { DUR, MOTION_DISTANCE, MOTION_LEVEL, useMotion, type Motion } from '../theme/motion';

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

// ---------- Arrivals (§11.3 round 4, CONSISTENCY §M3) ----------
//
// Which entrance a screen plays depends on how it was reached. Only Sign in plays the full launch
// above (light dip + header + staggered content). Every other arrival moves the content root
// (header, content and dock together) as one, with no light dip and no stagger:
//   push     24 in from the right, 0 → 1, 320ms ease-lens (stack links)
//   back     from −12 and 0.85 → 1, 240ms ease-lens (the screen a pop returns to)
//   tab      opacity + 6 up, 240ms ease-lens (the light and the tab bar never re-enter)
//   replace  opacity + 6 up, 320ms (Sign in / Sign up → the role's first tab; the bar fades in once)
// Reduced motion: every arrival is a 120ms linear fade in place (M1); launch keeps its 120ms step
// fades, light at 1.
//
// RN adaptation: the navigators run no scene animation of their own (the native stack and the tabs
// are set to `animation: 'none'`), so the boards' page arrivals are reproduced exactly by the
// arriving screen on the UI thread. A native-stack cross-fade would dip the key pool mid-way (two
// identical grounds at partial opacity) and Android ignores its duration; react-native-screens has
// no 24dp push. The outgoing screen's 0.85 / −12 drift is not visible: the native swap is instant.
// iOS: with `animation: 'none'` the interactive swipe-back gesture still pops, but without its
// sliding animation (verify on a device; ADR 0005).

export type Arrival = 'launch' | 'push' | 'back' | 'tab' | 'replace';
/** The arrivals a screen can open with ('back' only ever happens on a return). */
export type InitialArrival = Exclude<Arrival, 'back'>;

export type ArrivalPlan = {
  arrival: Arrival;
  /** Start pose of the content root; it settles to opacity 1 and no translate. */
  opacity: number;
  x: number;
  y: number;
  /** ms, ease-lens. 0: the root does not move (launch staggers its steps instead). */
  duration: number;
  /** Launch only: per-step stagger and the light dip instead of a root move. */
  staggered: boolean;
};

const ROOT_FROM: Record<Exclude<Arrival, 'launch'>, { opacity: number; x: number; y: number; duration: number }> = {
  push: { opacity: 0, x: MOTION_DISTANCE.pushIn, y: 0, duration: DUR.enter },
  back: { opacity: MOTION_LEVEL.pushOutDim, x: -MOTION_DISTANCE.pushOutDrift, y: 0, duration: DUR.swap },
  tab: { opacity: 0, x: 0, y: MOTION_DISTANCE.tabContentRise, duration: DUR.swap },
  replace: { opacity: 0, x: 0, y: MOTION_DISTANCE.tabContentRise, duration: DUR.enter },
};

/** The content-root motion for an arrival, resolved for reduced motion. */
export function arrivalPlan(motion: Motion, arrival: Arrival): ArrivalPlan {
  if (arrival === 'launch') return { arrival, opacity: 1, x: 0, y: 0, duration: 0, staggered: true };
  const from = ROOT_FROM[arrival];
  if (motion.reduced) return { arrival, opacity: from.opacity, x: 0, y: 0, duration: DUR.tick, staggered: false };
  return { arrival, ...from, staggered: false };
}

type NavState = { type?: string; index: number; routes: readonly { key: string }[] };

/**
 * How a screen that just lost focus will arrive when it regains it: a tab screen whose navigator
 * moved to another tab comes back as a tab switch; anything covered by a push comes back as back.
 * Decided at blur from the navigator's state, so it covers tab presses and `router.push('/tab')` alike.
 */
export function refocusArrival(state: NavState | undefined, routeKey: string | undefined): Arrival {
  if (state?.type === 'tab' && routeKey && state.routes[state.index]?.key !== routeKey) return 'tab';
  return 'back';
}

/**
 * A light moment the arriving screen finishes for the one it replaced (§M3). `u1`: Sign in's
 * Commit pass, whose 700ms tail plays on the first tab's floor.
 */
export type Handoff = 'u1';

/** How long a stamp waits for the screen it announces (the redirect chain takes a few renders). */
export const ARRIVAL_STAMP_TTL = 2000;
export type ArrivalStamp = { arrival: Arrival; handoff?: Handoff };
let stamp: (ArrivalStamp & { at: number }) | null = null;

/**
 * Announces how the next navigator will be reached (the boards' `LQ.stamp`), with the light
 * moment it hands off. Only arrivals that no navigator state can tell apart are stamped: today,
 * `replace` (with the U1 hand-off) from the auth flow. Call it from an effect, never during render.
 */
export function stampArrival(arrival: Arrival, options: { handoff?: Handoff } = {}, now = Date.now()): void {
  stamp = { arrival, handoff: options.handoff, at: now };
}

/** Reads the pending stamp once (the boards' `LQ.arrive`); null when none, or it went stale. */
export function takeArrival(now = Date.now()): ArrivalStamp | null {
  const s = stamp;
  stamp = null;
  if (!s || now - s.at > ARRIVAL_STAMP_TTL) return null;
  return s.handoff ? { arrival: s.arrival, handoff: s.handoff } : { arrival: s.arrival };
}

/** The slice of a navigation object the arrival needs (absent outside a navigator, and in tests). */
export type ArrivalNavigation = {
  addListener?: (event: 'focus' | 'blur', cb: () => void) => () => void;
  getState?: () => NavState | undefined;
} | null | undefined;

/**
 * Drives one content root through its arrivals on the UI thread: `arrival` on mount, then on every
 * return to focus the arrival `refocusArrival` decided at blur. The start pose is set while the
 * screen is hidden (at blur), so its first visible frame is already the start pose. Screen and the
 * stack header both call this with the same navigation, so the header pushes with its content.
 */
export function useArrival(arrival: Arrival, navigation: ArrivalNavigation, routeKey?: string) {
  const motion = useMotion();
  const [plan] = useState(() => arrivalPlan(motion, arrival));
  const opacity = useSharedValue(plan.opacity);
  const x = useSharedValue(plan.x);
  const y = useSharedValue(plan.y);
  const motionRef = useRef(motion);
  motionRef.current = motion;

  useEffect(() => {
    const settle = (p: ArrivalPlan) => {
      if (p.duration === 0) return;
      // Reduced motion (M1): a 120ms linear fade; every other arrival settles on ease-lens.
      const easing = motionRef.current.reduced ? Easing.linear : motionRef.current.ease.lens;
      const cfg = { duration: p.duration, easing, reduceMotion: ReduceMotion.Never };
      opacity.value = withTiming(1, cfg);
      x.value = withTiming(0, cfg);
      y.value = withTiming(0, cfg);
    };
    settle(plan);
    if (!navigation?.addListener) return;
    let next: ArrivalPlan | null = null;
    const offBlur = navigation.addListener('blur', () => {
      next = arrivalPlan(motionRef.current, refocusArrival(navigation.getState?.(), routeKey));
      opacity.value = next.opacity;
      x.value = next.x;
      y.value = next.y;
    });
    const offFocus = navigation.addListener('focus', () => {
      if (next) settle(next);
      next = null;
    });
    return () => {
      offBlur();
      offFocus();
    };
    // The mount plan plays once; listeners follow the navigation object.
  }, [navigation, routeKey]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateX: x.value }, { translateY: y.value }] }));
  return { plan, style };
}
