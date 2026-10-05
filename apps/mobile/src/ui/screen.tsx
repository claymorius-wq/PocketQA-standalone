import { NavigationContext } from 'expo-router/react-navigation';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { appOffScreen } from '../motion/visible';
import { causticDelay, ENTRANCE_WINDOW, entranceDelay, joinWave, type EntranceStep, type Wave } from '../motion';
import type { Handoff, InitialArrival } from '../motion/entrance';
import { useMotion } from '../theme/motion';

/** What the kit needs to know about the Screen it renders in. */
export type ScreenInfo = {
  /** The screen's entrance wave (§11.3): items mounting within its window share its schedule. */
  wave: Wave;
  /** When the screen mounted: anything mounting after its entrance window animates in by itself. */
  mountedAt: number;
  /** A stack screen under the Lens stack header (titles use display-stack, §5). */
  stack: boolean;
  /**
   * Launch (Sign in only) staggers each step and dips the light. Every other arrival moves the
   * content root as one (src/motion/entrance.ts), so steps that mount with it stay still.
   * Absent: staggered (a bare ScreenContext, as in tests).
   */
  staggered?: boolean;
  /** Date.now() until which a mounting step is part of the root's arrival (no motion of its own). */
  settledAt?: number;
  /** Date.now() at which a primary's caustic arrives on a root arrival (+320 on a push, §M3). */
  causticAt?: number;
};

export const ScreenContext = createContext<ScreenInfo | null>(null);

/**
 * How the screens under a layout open (§M3). Layouts set it where the route alone decides (the
 * auth stack gives Sign in `launch`; the role tabs give the first tab after sign-in `replace`,
 * with the U1 hand-off). A Screen's own `entrance` prop wins. Without either, a Screen in the
 * tabs opens with `tab` and any other with `push`.
 */
export type ArrivalSpec = InitialArrival | { arrival: InitialArrival; handoff?: Handoff };
export const ArrivalContext = createContext<ArrivalSpec | null>(null);

/** The arrival an ArrivalContext value names. */
export function arrivalOf(spec: ArrivalSpec | null): InitialArrival | null {
  return typeof spec === 'string' ? spec : (spec?.arrival ?? null);
}

/** The entrance step a component renders in (Card distance dimming, the primary's caustic arrival). */
export type EnterInfo = {
  step: EntranceStep;
  /** Date.now() at which a primary's caustic in this step starts to arrive (§11.3.4). */
  causticAt: number;
};

export const EnterContext = createContext<EnterInfo | null>(null);

/**
 * One step of the screen entrance (§11.3): fade in and rise (header 6, content 10) over dur-enter
 * ease-lens on the stagger schedule; reduced motion is a 120ms fade in place. Mount only.
 *
 * Driven by a shared value rather than a Reanimated `entering` layout animation: on web, layout
 * animations inside a tab scene were left absolutely positioned at their start snapshot (the
 * header and content stacked on top of each other), and opacity + transform behave the same on
 * every platform.
 *
 * `collapse` is applied while the step lays out empty (a child that renders null, or only a
 * Modal host): it cancels the column gap the empty wrapper would otherwise still take.
 */
export function Enter({ step, delay, children, style, collapse }: {
  step: EntranceStep;
  delay?: number;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  collapse?: ViewStyle;
}) {
  const motion = useMotion();
  const screen = useContext(ScreenContext);
  const [plan] = useState(() => {
    const now = Date.now();
    // Mounting with a root arrival: the root carries this step, which only reports its caustic time.
    if (screen && screen.staggered === false && delay === undefined && now <= (screen.settledAt ?? 0)) {
      return { still: true, delay: 0, rise: 0, duration: 0, causticAt: screen.causticAt ?? now };
    }
    // Mounting while Pocket QA is off screen (a notice after a recording the system stopped while the
    // tester was in another app): render settled, since nobody can see the entrance.
    if (appOffScreen()) return { still: true, delay: 0, rise: 0, duration: 0, causticAt: now };
    const elapsed = screen ? joinWave(screen.wave, now) : 0;
    const header = step === 'title' || step === 'subtitle';
    return {
      still: false,
      delay: Math.max(0, (delay ?? entranceDelay(motion, step)) - elapsed),
      rise: header ? motion.entrance.headerRise : motion.entrance.rise,
      duration: motion.entrance.duration,
      // Outside a Screen there is no entrance, so nothing waits for it.
      causticAt: screen ? now - elapsed + (delay ?? causticDelay(motion, step)) : 0,
    };
  });
  const progress = useSharedValue(plan.still ? 1 : 0);
  useEffect(() => {
    if (plan.still) return;
    progress.value = withDelay(plan.delay, withTiming(1, { duration: plan.duration, easing: motion.ease.lens, reduceMotion: ReduceMotion.Never }));
    // Mount only: entrances never replay on re-render.
  }, []);
  const rise = plan.rise;
  const animated = useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateY: (1 - progress.value) * rise }] }));
  const [empty, setEmpty] = useState(false);
  const onLayout = collapse
    ? (e: LayoutChangeEvent) => {
        const none = e.nativeEvent.layout.height === 0;
        setEmpty((prev) => (prev === none ? prev : none));
      }
    : undefined;
  const info = useMemo<EnterInfo>(() => ({ step, causticAt: plan.causticAt }), [step, plan.causticAt]);
  return (
    <EnterContext.Provider value={info}>
      <Animated.View onLayout={onLayout} style={[style, empty ? collapse : null, animated]}>
        {children}
      </Animated.View>
    </EnterContext.Provider>
  );
}

/** True when this component mounted after its screen's entrance window (a notice after a mutation). */
export function useMountedLate(): boolean {
  const screen = useContext(ScreenContext);
  const [late] = useState(() => !!screen && Date.now() - screen.mountedAt > ENTRANCE_WINDOW);
  return late;
}

/**
 * Whether the enclosing navigation screen is focused (true outside a navigator). Tab scenes stay
 * mounted while unfocused, so live loops gate on this to let the UI thread go idle.
 */
export function useScreenFocused(): boolean {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);
  useEffect(() => {
    if (!navigation) return;
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);
  return focused;
}
