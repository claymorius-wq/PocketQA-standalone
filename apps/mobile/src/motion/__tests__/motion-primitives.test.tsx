import { act, render, renderHook, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Animated as RNAnimated, Text } from 'react-native';
import { FULL_MOTION, MotionProvider, REDUCED_MOTION, type Motion } from '../../theme/motion';
import {
  BreathingCore,
  causticDelay,
  canRoll,
  entranceDelay,
  ENTRANCE_WINDOW,
  jsStackScreenOptions,
  joinWave,
  LiveLed,
  liveLevels,
  NumberRoll,
  planRoll,
  useLiveBreath,
  useSheetMotion,
  type RollColumn,
} from '..';

const withMotion = (motion: Motion) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MotionProvider value={motion}>{children}</MotionProvider>;
  };

// Reads the current value of a React Native Animated node built by a navigator preset.
const valueOf = (node: unknown) => (node as { __getValue(): number }).__getValue();

describe('entrance choreography (§11.3)', () => {
  it('schedules the header, then content 40ms apart from 80, capped at the fifth step', () => {
    expect(entranceDelay(FULL_MOTION, 'title')).toBe(0);
    expect(entranceDelay(FULL_MOTION, 'subtitle')).toBe(40);
    expect([0, 1, 2, 3, 4, 5, 9].map((i) => entranceDelay(FULL_MOTION, i))).toEqual([80, 120, 160, 200, 240, 240, 240]);
  });

  it('finishes every step and the primary caustic within 700ms', () => {
    for (const step of ['title', 'subtitle', 0, 1, 2, 3, 4, 7] as const) {
      expect(entranceDelay(FULL_MOTION, step) + FULL_MOTION.entrance.duration).toBeLessThanOrEqual(ENTRANCE_WINDOW);
      expect(causticDelay(FULL_MOTION, step) + 320).toBeLessThanOrEqual(ENTRANCE_WINDOW);
    }
    // The caustic waits for the button: a title-row button ends at 320, so its caustic starts there.
    expect(causticDelay(FULL_MOTION, 'title')).toBe(320);
  });

  it('reduced motion: no stagger and no caustic wait', () => {
    expect([entranceDelay(REDUCED_MOTION, 'subtitle'), entranceDelay(REDUCED_MOTION, 3), causticDelay(REDUCED_MOTION, 3)]).toEqual([0, 0, 0]);
  });

  it('starts a new wave for content that mounts after the window', () => {
    const wave = { start: 1000 };
    expect(joinWave(wave, 1050)).toBe(50);
    expect(joinWave(wave, 1700)).toBe(700);
    expect(joinWave(wave, 2500)).toBe(0);
    expect(wave.start).toBe(2500);
    expect(joinWave(wave, 2540)).toBe(40);
  });
});

describe('number roll (§11.5 S5)', () => {
  const digits = (from: number, to: number) => planRoll(from, to).parts.filter((p): p is RollColumn => p.kind === 'digit');

  it('rolls 0 → 50 like the board: tens from blank to 5, ones one full turn, ones first', () => {
    const plan = planRoll(0, 50);
    expect(plan.text).toBe('50');
    const [tens, ones] = digits(0, 50);
    expect(tens).toMatchObject({ place: 1, cells: ['', '1', '2', '3', '4', '5', '6'], start: 0, end: 5 });
    expect(ones).toMatchObject({ place: 0, cells: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '1'], start: 0, end: 10 });
    expect(plan.duration).toBe(40 + 560);
  });

  it('keeps separators static and staggers 40ms per column leftwards', () => {
    const plan = planRoll(999, 1000);
    expect(plan.text).toBe('1,000');
    expect(plan.parts[1]).toEqual({ kind: 'char', char: ',' });
    const [thousands, hundreds, , ones] = digits(999, 1000);
    expect(thousands).toMatchObject({ cells: ['', '1', '2'], start: 0, end: 1 });
    expect(hundreds).toMatchObject({ cells: ['9', '0', '1'], start: 0, end: 1 });
    expect(ones).toMatchObject({ cells: ['9', '0', '1'], start: 0, end: 1 });
    expect(plan.duration).toBe(3 * 40 + 560);
  });

  it('rolls the other way when the value drops, and leaves unchanged columns still', () => {
    const [tens, ones] = digits(50, 20);
    expect(tens).toMatchObject({ cells: ['1', '2', '3', '4', '5'], start: 4, end: 1 });
    // The ones column passes 30 times, so it turns once (down), as an odometer would.
    expect(ones).toMatchObject({ start: 11, end: 1 });
    expect(ones!.cells[1]).toBe('0');
    const [thousands, hundreds, tensStill, onesUp] = digits(1000, 1005);
    for (const still of [thousands, hundreds, tensStill]) expect(still!.start).toBe(still!.end);
    expect(onesUp).toMatchObject({ cells: ['0', '1', '2', '3', '4', '5', '6'], start: 0, end: 5 });
    expect(planRoll(1000, 1005).duration).toBe(560);
    expect(planRoll(7, 7).duration).toBe(0);
  });

  it('caps a long run at one revolution plus the remainder', () => {
    const ones = digits(0, 1234).at(-1)!;
    expect(ones.end - ones.start).toBe(14);
    expect(ones.cells[ones.end]).toBe('4');
  });

  it('only rolls non-negative integers that changed', () => {
    expect(canRoll(0, 50)).toBe(true);
    expect([canRoll(5, 5), canRoll(-1, 3), canRoll(1.5, 3)]).toEqual([false, false, false]);
  });

  const style = { fontSize: 56, lineHeight: 56 };

  it('shows the final value on mount (no count-up) and labels it once', async () => {
    await render(<NumberRoll testID="credit-balance" value={0} suffix={(n) => (n === 1 ? ' test credit' : ' test credits')} style={style} />, {
      wrapper: withMotion(FULL_MOTION),
    });
    const balance = screen.getByTestId('credit-balance');
    expect(balance.props.accessibilityLabel).toBe('0 test credits');
    expect(screen.getByText('0')).toBeTruthy();
    expect(screen.getByText(' test credits')).toBeTruthy();
  });

  it('rolls on change, then rests on one Text with the final value', async () => {
    jest.useFakeTimers();
    try {
      const r = await render(<NumberRoll testID="credit-balance" value={0} suffix=" test credits" style={style} />, { wrapper: withMotion(FULL_MOTION) });
      await r.rerender(<NumberRoll testID="credit-balance" value={1000} suffix=" test credits" style={style} />);
      expect(screen.getByTestId('credit-balance').props.accessibilityLabel).toBe('1,000 test credits');
      expect(screen.queryByText('1,000')).toBeNull();
      // Mid-roll the strips are hidden from assistive tech; only the label speaks.
      expect(screen.queryByText(',')).toBeNull();
      expect(screen.getAllByText(',', { includeHiddenElements: true }).length).toBe(1);
      await act(async () => {
        jest.advanceTimersByTime(3 * 40 + 560);
      });
      expect(screen.getByText('1,000')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('reduced motion, or a style without lineHeight: the final value at once', async () => {
    const r = await render(<NumberRoll value={0} style={style} />, { wrapper: withMotion(REDUCED_MOTION) });
    await r.rerender(<NumberRoll value={50} style={style} />);
    expect(screen.getByText('50')).toBeTruthy();
    const s = await render(<NumberRoll value={0} style={{ fontSize: 56 }} />, { wrapper: withMotion(FULL_MOTION) });
    await s.rerender(<NumberRoll value={50} style={{ fontSize: 56 }} />);
    expect(screen.getByText('50')).toBeTruthy();
  });
});

describe('record core breathing (§11.5 S2, U3 Live)', () => {
  it('maps one breath to the core, glow, floor and LED ranges', () => {
    expect(liveLevels(0, 1, null, null)).toMatchObject({ scale: 1, coreOpacity: 0.8, glow: 0.8, floor: 0.72, led: 0.55, floorScale: 1 });
    const peak = liveLevels(1, 1, null, null);
    expect(peak.scale).toBeCloseTo(1.06, 10);
    expect([peak.coreOpacity, peak.glow, peak.floor, peak.led]).toEqual([1, 1, 1, 1]);
  });

  it('the light cut takes everything to 0; the core body falls back to unlit glass', () => {
    expect(liveLevels(0.7, 0, null, null)).toMatchObject({ scale: 1, coreOpacity: 0.3, glow: 0, floor: 0, led: 0, floorScale: 0.3 });
  });

  it('reduced motion holds the core and LED at 0.9 and the floor at 0.86', () => {
    const r = liveLevels(0.4, 1, REDUCED_MOTION.liveSteady, REDUCED_MOTION.uplightLiveSteady);
    expect(r).toMatchObject({ scale: 1, glow: 0.9, floor: 0.86, led: 0.9, floorScale: 1 });
    expect(r.coreOpacity).toBeCloseTo(0.9, 10);
  });

  it('starts, stops and unmounts without leaving work behind', async () => {
    function Recorder({ on }: { on: boolean }) {
      const live = useLiveBreath(on);
      return (
        <>
          <BreathingCore live={live} size={72} glow={<Text>glow</Text>} testID="core">
            <Text>core</Text>
          </BreathingCore>
          <LiveLed color="#6F9BFF" testID="led" />
        </>
      );
    }
    const r = await render(<Recorder on={false} />, { wrapper: withMotion(FULL_MOTION) });
    await r.rerender(<Recorder on />);
    await r.rerender(<Recorder on={false} />);
    expect(screen.getByTestId('core')).toBeTruthy();
    await r.unmount();
  });
});

describe('sheet motion (§11.4)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('stays mounted through the 240ms exit, with input disabled while closing', async () => {
    const { result, rerender } = await renderHook((p: { visible: boolean }) => useSheetMotion({ visible: p.visible }), {
      initialProps: { visible: false },
      wrapper: withMotion(FULL_MOTION),
    });
    expect(result.current.mounted).toBe(false);
    await rerender({ visible: true });
    expect(result.current).toMatchObject({ mounted: true, closing: false });
    await rerender({ visible: false });
    expect(result.current).toMatchObject({ mounted: true, closing: true });
    await act(async () => {
      jest.advanceTimersByTime(239);
    });
    expect(result.current.mounted).toBe(true);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current.mounted).toBe(false);
  });

  it('reopening mid-exit keeps the sheet', async () => {
    const { result, rerender } = await renderHook((p: { visible: boolean }) => useSheetMotion({ visible: p.visible }), {
      initialProps: { visible: true },
      wrapper: withMotion(FULL_MOTION),
    });
    await rerender({ visible: false });
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    await rerender({ visible: true });
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(result.current).toMatchObject({ mounted: true, closing: false });
  });

  it('reduced motion exits in 120ms; animateExit false unmounts at once', async () => {
    const reduced = await renderHook((p: { visible: boolean }) => useSheetMotion({ visible: p.visible }), {
      initialProps: { visible: true },
      wrapper: withMotion(REDUCED_MOTION),
    });
    await reduced.rerender({ visible: false });
    await act(async () => {
      jest.advanceTimersByTime(120);
    });
    expect(reduced.result.current.mounted).toBe(false);

    const instant = await renderHook((p: { visible: boolean }) => useSheetMotion({ visible: p.visible, animateExit: false }), {
      initialProps: { visible: true },
      wrapper: withMotion(FULL_MOTION),
    });
    await instant.rerender({ visible: false });
    expect(instant.result.current.mounted).toBe(false);
  });
});

describe('navigator presets', () => {
  it('JS stack: push 24 in over 320ms, the screen below dims to 0.85 and drifts 12 left; back in 240ms', () => {
    const o = jsStackScreenOptions(FULL_MOTION);
    expect(o.transitionSpec).toMatchObject({ open: { config: { duration: 320 } }, close: { config: { duration: 240 } } });
    const card = (current: number, next?: number) => {
      const props = {
        current: { progress: new RNAnimated.Value(current) },
        next: next === undefined ? undefined : { progress: new RNAnimated.Value(next) },
      } as unknown as Parameters<NonNullable<typeof o.cardStyleInterpolator>>[0];
      const { cardStyle } = o.cardStyleInterpolator!(props) as { cardStyle: { opacity: unknown; transform: { translateX: unknown }[] } };
      return [valueOf(cardStyle.opacity), valueOf(cardStyle.transform[0]!.translateX) + valueOf(cardStyle.transform[1]!.translateX)];
    };
    expect(card(0)).toEqual([0, 24]);
    expect(card(1)).toEqual([1, 0]);
    expect(card(1, 1)).toEqual([0.85, -12]);
    expect(jsStackScreenOptions(REDUCED_MOTION).transitionSpec).toMatchObject({ open: { config: { duration: 120 } } });
  });
});
