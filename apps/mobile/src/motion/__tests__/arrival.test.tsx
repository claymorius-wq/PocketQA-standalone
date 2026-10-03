import { act, render, renderHook, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import Animated, { getAnimatedStyle } from 'react-native-reanimated';
import { FULL_MOTION, MotionProvider, REDUCED_MOTION, type Motion } from '../../theme/motion';
import { ARRIVAL_STAMP_TTL, arrivalPlan, refocusArrival, stampArrival, takeArrival, useArrival, type ArrivalNavigation } from '../entrance';
import { SHEET_FOCUS_DELAY, useSheetFocus } from '../sheet';

const withMotion = (motion: Motion) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MotionProvider value={motion}>{children}</MotionProvider>;
  };

describe('arrivals (§11.3 round 4, CONSISTENCY §M3)', () => {
  it('push comes 24 in from the right over 320ms; back from −12 and 0.85 over 240ms', () => {
    expect(arrivalPlan(FULL_MOTION, 'push')).toMatchObject({ opacity: 0, x: 24, y: 0, duration: 320, staggered: false });
    expect(arrivalPlan(FULL_MOTION, 'back')).toMatchObject({ opacity: 0.85, x: -12, y: 0, duration: 240, staggered: false });
  });

  it('tab rises 6 over 240ms; replace rises 6 over 320ms', () => {
    expect(arrivalPlan(FULL_MOTION, 'tab')).toMatchObject({ opacity: 0, x: 0, y: 6, duration: 240, staggered: false });
    expect(arrivalPlan(FULL_MOTION, 'replace')).toMatchObject({ opacity: 0, x: 0, y: 6, duration: 320, staggered: false });
  });

  it('only launch staggers (and dips the light); its root never moves', () => {
    expect(arrivalPlan(FULL_MOTION, 'launch')).toMatchObject({ opacity: 1, x: 0, y: 0, duration: 0, staggered: true });
    for (const a of ['push', 'back', 'tab', 'replace'] as const) expect(arrivalPlan(FULL_MOTION, a).staggered).toBe(false);
  });

  it('reduced motion: every arrival is a 120ms fade in place', () => {
    for (const a of ['push', 'back', 'tab', 'replace'] as const) {
      expect(arrivalPlan(REDUCED_MOTION, a)).toMatchObject({ x: 0, y: 0, duration: 120 });
    }
    expect(arrivalPlan(REDUCED_MOTION, 'back').opacity).toBe(0.85);
    expect(arrivalPlan(REDUCED_MOTION, 'launch').staggered).toBe(true);
  });

  it('a screen returns as a tab switch only when its tab navigator moved to another tab', () => {
    const tabs = (index: number) => ({ type: 'tab', index, routes: [{ key: 'discover-1' }, { key: 'work-1' }] });
    expect(refocusArrival(tabs(1), 'discover-1')).toBe('tab');
    // Pushed over (study/[id] on the root stack): the tab state still points at this tab.
    expect(refocusArrival(tabs(0), 'discover-1')).toBe('back');
    expect(refocusArrival({ type: 'stack', index: 1, routes: [{ key: 'a' }, { key: 'b' }] }, 'a')).toBe('back');
    expect(refocusArrival(undefined, undefined)).toBe('back');
  });

  it('a stamp is read once, carries its hand-off, and goes stale', () => {
    stampArrival('replace', {}, 1000);
    expect(takeArrival(1500)).toEqual({ arrival: 'replace' });
    expect(takeArrival(1500)).toBeNull();
    stampArrival('replace', { handoff: 'u1' }, 1000);
    expect(takeArrival(1500)).toEqual({ arrival: 'replace', handoff: 'u1' });
    stampArrival('replace', { handoff: 'u1' }, 1000);
    expect(takeArrival(1000 + ARRIVAL_STAMP_TTL + 1)).toBeNull();
  });
});

describe('useArrival', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /** A navigation double that records listeners and lets the test emit focus / blur. */
  function fakeNavigation(state: { type: string; index: number; routes: { key: string }[] }) {
    const listeners = { focus: new Set<() => void>(), blur: new Set<() => void>() };
    const nav = {
      state,
      addListener: (e: 'focus' | 'blur', cb: () => void) => {
        listeners[e].add(cb);
        return () => listeners[e].delete(cb);
      },
      getState: () => nav.state,
      emit: (e: 'focus' | 'blur') => listeners[e].forEach((cb) => cb()),
      count: () => listeners.focus.size + listeners.blur.size,
    };
    return nav;
  }
  type Pose = { opacity: number; transform: { translateX?: number; translateY?: number }[] };
  function Root({ arrival, navigation, routeKey }: { arrival: 'push' | 'tab'; navigation: ArrivalNavigation; routeKey?: string }) {
    const { style } = useArrival(arrival, navigation, routeKey);
    return <Animated.View testID="root" style={style} />;
  }
  const mount = (ui: ReactNode) => render(<MotionProvider value={FULL_MOTION}>{ui}</MotionProvider>);
  // The root's current animated style (Reanimated's Jest setup advances it on the fake timers).
  const pose = (): { opacity: number; x: number; y: number } => {
    const v = getAnimatedStyle(screen.getByTestId('root')) as unknown as Pose;
    return { opacity: v.opacity, x: v.transform[0]?.translateX ?? 0, y: v.transform[1]?.translateY ?? 0 };
  };

  it('pushes in on mount and settles at rest', async () => {
    const { result } = await renderHook(() => useArrival('push', null), { wrapper: withMotion(FULL_MOTION) });
    expect(result.current.plan.arrival).toBe('push');
    await mount(<Root arrival="push" navigation={null} />);
    expect(pose()).toEqual({ opacity: 0, x: 24, y: 0 });
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(pose()).toEqual({ opacity: 1, x: 0, y: 0 });
  });

  it('a tab screen left for another tab returns with the tab arrival; left for a push, with back', async () => {
    const nav = fakeNavigation({ type: 'tab', index: 0, routes: [{ key: 'discover-1' }, { key: 'work-1' }] });
    const { unmount } = await mount(<Root arrival="tab" navigation={nav as unknown as ArrivalNavigation} routeKey="discover-1" />);
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    // Tab switch: the start pose is set while the screen is hidden, then it rises on focus.
    nav.state = { ...nav.state, index: 1 };
    await act(async () => nav.emit('blur'));
    await act(async () => {
      jest.advanceTimersByTime(20);
    });
    expect(pose()).toEqual({ opacity: 0, x: 0, y: 6 });
    nav.state = { ...nav.state, index: 0 };
    await act(async () => nav.emit('focus'));
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(pose()).toEqual({ opacity: 1, x: 0, y: 0 });
    // Pushed over (the tab state still points here): back from −12 and 0.85.
    await act(async () => nav.emit('blur'));
    await act(async () => {
      jest.advanceTimersByTime(20);
    });
    expect(pose()).toEqual({ opacity: 0.85, x: -12, y: 0 });
    await act(async () => nav.emit('focus'));
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    expect(pose()).toEqual({ opacity: 1, x: 0, y: 0 });
    await unmount();
    expect(nav.count()).toBe(0);
  });

  it('the first focus after mount replays nothing', async () => {
    const nav = fakeNavigation({ type: 'stack', index: 0, routes: [{ key: 's' }] });
    await mount(<Root arrival="push" navigation={nav as unknown as ArrivalNavigation} routeKey="s" />);
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    await act(async () => nav.emit('focus'));
    expect(pose()).toEqual({ opacity: 1, x: 0, y: 0 });
  });
});

describe('sheet focus and close (CONSISTENCY C4)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('never closes while busy or closing', async () => {
    const onClose = jest.fn();
    const { result, rerender } = await renderHook((p: { busy: boolean; closing: boolean }) => useSheetFocus({ visible: true, busy: p.busy, closing: p.closing, onClose }), {
      initialProps: { busy: true, closing: false },
    });
    result.current.requestClose();
    expect(onClose).not.toHaveBeenCalled();
    await rerender({ busy: false, closing: true });
    result.current.requestClose();
    expect(onClose).not.toHaveBeenCalled();
    await rerender({ busy: false, closing: false });
    result.current.requestClose();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves accessibility focus to the title 60ms after opening', async () => {
    const send = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
    const { result, rerender } = await renderHook((p: { visible: boolean }) => useSheetFocus({ visible: p.visible, busy: false, closing: false, onClose: jest.fn() }), {
      initialProps: { visible: false },
    });
    const title = {};
    (result.current.titleRef as { current: unknown }).current = title;
    await rerender({ visible: true });
    await act(async () => {
      jest.advanceTimersByTime(SHEET_FOCUS_DELAY - 1);
    });
    expect(send).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(send).toHaveBeenCalledWith(title, 'focus');
  });
});
