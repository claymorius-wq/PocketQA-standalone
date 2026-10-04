import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, Text as RNText } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BottomTabBarHeightContext } from 'expo-router/tabs';
import type { NativeStackHeaderProps } from 'expo-router/native-stack';
import { ThemeProvider, useTheme, type ThemePreference } from '../../theme/ThemeProvider';
import { dark as darkColors } from '../../theme/tokens';
import { ArrivalContext, Button, ConfirmSheet, focusRingCss, LensStackHeader, lensStackScreenOptions, Screen, Segmented, SHEET_PENDING_ESCAPE_MS } from '..';
import { ListRow } from '../patterns';

// Navigation choreography and the canonical chrome (CONSISTENCY C1, C2, C4, §M3).

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
// Records the Ground each Screen draws, to see whether its light dips on mount.
const groundEnter: (boolean | undefined)[] = [];
jest.mock('../../glass', () => {
  const actual = jest.requireActual('../../glass');
  return {
    ...actual,
    Ground: (props: { enter?: boolean }) => {
      groundEnter.push(props.enter);
      return actual.Ground(props);
    },
  };
});

beforeEach(() => {
  groundEnter.length = 0;
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

async function renderIn(ui: ReactNode, scheme: ThemePreference = 'dark') {
  let setPreference: ((p: ThemePreference) => void) | undefined;
  function Scheme({ children }: { children: ReactNode }) {
    setPreference = useTheme().setPreference;
    return <>{children}</>;
  }
  const r = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider fonts="system">
        <Scheme>{ui}</Scheme>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  await act(async () => setPreference?.(scheme));
  return r;
}

type Pose = { opacity: number; transform?: { translateX?: number; translateY?: number }[] };
const pose = (node: Parameters<typeof getAnimatedStyle>[0]) => {
  const v = getAnimatedStyle(node) as unknown as Pose;
  const t = Object.assign({}, ...(v.transform ?? [])) as { translateX?: number; translateY?: number };
  return { opacity: v.opacity, x: t.translateX ?? 0, y: t.translateY ?? 0 };
};
/** The nearest host ancestor of a node (the Screen's content root is the SafeAreaView's parent). */
const hostParent = (node: { parent: unknown }) => {
  let p = node.parent as { type: unknown; parent: unknown } | null;
  while (p && typeof p.type !== 'string') p = p.parent as typeof p;
  return p as unknown as Parameters<typeof getAnimatedStyle>[0];
};
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

describe('screen arrivals (§11.3, §M3)', () => {
  const body = (
    <>
      <RNText testID="first">a</RNText>
      <RNText testID="second">b</RNText>
    </>
  );

  it('a screen opens with push by default: the root slides 24 in, the steps stay still, the light never dips', async () => {
    await renderIn(<Screen testID="s" title="Study">{body}</Screen>);
    const root = hostParent(screen.getByTestId('s'));
    expect(pose(root)).toEqual({ opacity: 0, x: 24, y: 0 });
    expect(pose(hostParent(screen.getByTestId('first')))).toMatchObject({ opacity: 1, y: 0 });
    expect(groundEnter.every((e) => e === false)).toBe(true);
    await advance(400);
    expect(pose(root)).toEqual({ opacity: 1, x: 0, y: 0 });
  });

  it('only launch dips the light and staggers the steps; its root does not move', async () => {
    await renderIn(<Screen testID="s" title="Sign in" entrance="launch">{body}</Screen>);
    expect(groundEnter).toContain(true);
    expect(pose(hostParent(screen.getByTestId('s')))).toEqual({ opacity: 1, x: 0, y: 0 });
    // The first content step waits for its 80ms slot and rises 10.
    expect(pose(hostParent(screen.getByTestId('first')))).toMatchObject({ opacity: 0, y: 10 });
    await advance(800);
    expect(pose(hostParent(screen.getByTestId('first')))).toMatchObject({ opacity: 1, y: 0 });
  });

  it('a layout can give its screens an arrival (the auth stack gives Sign in launch)', async () => {
    await renderIn(
      <ArrivalContext.Provider value="launch">
        <Screen testID="s">{body}</Screen>
      </ArrivalContext.Provider>,
    );
    expect(groundEnter).toContain(true);
  });

  it('a tab root rises 6 over 240ms', async () => {
    await renderIn(
      <BottomTabBarHeightContext.Provider value={98}>
        <Screen testID="s" title="Discover">{body}</Screen>
      </BottomTabBarHeightContext.Provider>,
    );
    const root = hostParent(screen.getByTestId('s'));
    expect(pose(root)).toEqual({ opacity: 0, x: 0, y: 6 });
    await advance(250);
    expect(pose(root)).toEqual({ opacity: 1, x: 0, y: 0 });
  });

  it('a step that mounts after the push (a section added later) enters by itself', async () => {
    let show: () => void = () => {};
    function Harness() {
      const [on, setOn] = useState(false);
      show = () => setOn(true);
      return (
        <Screen testID="s">
          <RNText>a</RNText>
          {on ? <RNText testID="late">c</RNText> : null}
        </Screen>
      );
    }
    await renderIn(<Harness />);
    await advance(1000);
    await act(async () => show());
    expect(pose(hostParent(screen.getByTestId('late')))).toMatchObject({ opacity: 0, y: 10 });
    await advance(800);
    expect(pose(hostParent(screen.getByTestId('late')))).toMatchObject({ opacity: 1, y: 0 });
  });
});

describe('the U1 hand-off (§M3)', () => {
  const FLOOR = '"transformOrigin":"50% 100%"';
  const floors = (json: unknown) => JSON.stringify(json).split(FLOOR).length - 1;

  it('the first tab after sign-in finishes the Commit tail on its floor, then the floor goes', async () => {
    const r = await renderIn(
      <ArrivalContext.Provider value={{ arrival: 'replace', handoff: 'u1' }}>
        <Screen testID="s" title="Discover">
          <RNText>a</RNText>
        </Screen>
      </ArrivalContext.Provider>,
    );
    expect(floors(r.toJSON())).toBeGreaterThan(0);
    // replace: the content root rises 6 over 320ms; the light never dips.
    expect(pose(hostParent(screen.getByTestId('s')))).toEqual({ opacity: 0, x: 0, y: 6 });
    expect(groundEnter.every((e) => e === false)).toBe(true);
    await advance(1500);
    expect(floors(r.toJSON())).toBe(0);
  });

  it('a plain replace (no hand-off) draws no floor', async () => {
    const r = await renderIn(
      <ArrivalContext.Provider value="replace">
        <Screen testID="s">
          <RNText>a</RNText>
        </Screen>
      </ArrivalContext.Provider>,
    );
    expect(floors(r.toJSON())).toBe(0);
  });
});

describe('stack header (C2)', () => {
  const props = (back: boolean, name = 'study/[id]') =>
    ({
      navigation: { goBack: jest.fn(), replace: jest.fn() },
      route: { key: 'study-1', name },
      options: { title: 'Study' },
      back: back ? { title: undefined, href: undefined } : undefined,
    }) as unknown as NativeStackHeaderProps;

  it('Back, the 1×22 divider, then the title, 16 in from the edges below the 44 status band', async () => {
    const r = await renderIn(<LensStackHeader {...props(true)} />);
    const json = JSON.stringify(r.toJSON());
    expect(json).toContain('"width":1,"height":22');
    // The divider peaks at 0.30 in the middle.
    expect(json).toContain('"gradient":[0,14082303,0.5,1305927935,1,14082303]'); // #D6E0FF: 0, 0.30 (0x4D), 0
    const back = screen.getByLabelText('Back');
    expect(StyleSheet.flatten(back.props.style)).toMatchObject({ borderRadius: 16, minHeight: 44 });
    // The row sits in a full-width frame (16 in from both edges; on web it clips the push arrival so
    // it never overflows the screen, while native keeps the back tile's whole shadow) inside the bar,
    // which holds the 44 band + 6 top.
    const clip = hostParent(hostParent(back) as unknown as { parent: unknown }) as unknown as { props: { style: unknown }; parent: unknown };
    expect(StyleSheet.flatten(clip.props.style as never)).toMatchObject({ overflow: 'visible', paddingHorizontal: 16 });
    const bar = hostParent(clip as never) as unknown as { props: { style: unknown } };
    expect(StyleSheet.flatten(bar.props.style as never)).toMatchObject({ paddingTop: 50, paddingLeft: 0, paddingRight: 0 });
  });

  it('pushes in with its screen (the header is part of the content root)', async () => {
    await renderIn(<LensStackHeader {...props(true)} />);
    const row = hostParent(screen.getByLabelText('Back'));
    expect(pose(row)).toEqual({ opacity: 0, x: 24, y: 0 });
    await advance(400);
    expect(pose(row)).toEqual({ opacity: 1, x: 0, y: 0 });
  });

  it('reached without history (a refresh, a deep link), it shows no Back, exactly as main', async () => {
    const p = props(false, 'builder/new-study');
    const r = await renderIn(<LensStackHeader {...p} />);
    expect(JSON.stringify(r.toJSON())).not.toContain('"width":1,"height":22');
    expect(screen.queryByLabelText('Back')).toBeNull();
    expect(screen.getByText('Study').props.accessibilityRole).toBe('header');
    expect(p.navigation.replace).not.toHaveBeenCalled();
  });

  it('with history, Back goes back (never replaces)', async () => {
    const p = props(true);
    await renderIn(<LensStackHeader {...p} />);
    fireEvent.press(screen.getByLabelText('Back'));
    expect(p.navigation.goBack).toHaveBeenCalledTimes(1);
    expect(p.navigation.replace).not.toHaveBeenCalled();
  });

  it('the root route has no Back and no divider', async () => {
    const r = await renderIn(<LensStackHeader {...props(false, 'index')} />);
    expect(JSON.stringify(r.toJSON())).not.toContain('"width":1,"height":22');
    expect(screen.queryByLabelText('Back')).toBeNull();
    expect(screen.getByText('Study').props.accessibilityRole).toBe('header');
  });

  it('the stack runs no native transition; the screens play their own arrivals', () => {
    expect(lensStackScreenOptions(darkColors)).toMatchObject({ animation: 'none', headerTransparent: true });
  });
});

describe('focus ring (C1)', () => {
  it('web: one outline rule on :focus-visible, 2 wide and 2 out, never on inputs or mouse focus', () => {
    const css = focusRingCss('#6F9BFF');
    expect(css).toContain('--lens-focus: #6F9BFF');
    expect(css).toContain(':focus-visible { outline: 2px solid var(--lens-focus, #6F9BFF) !important; outline-offset: 2px !important; }');
    expect(css).toContain('[tabindex]:not([tabindex="-1"])');
    expect(css).toContain(':where(input, textarea):focus-visible { outline: none; }');
    expect(css).toContain(':focus:not(:focus-visible) { outline: none; }');
  });

  it('native: a 2px lens-blue overlay 4 outside the control, radius r + 4, mounted on first focus', async () => {
    await renderIn(<Button label="Save" onPress={jest.fn()} testID="save" />);
    expect(screen.queryByTestId('focus-ring')).toBeNull();
    await fireEvent(screen.getByTestId('save'), 'focus');
    const ring = StyleSheet.flatten(screen.getByTestId('focus-ring').props.style);
    expect(ring).toMatchObject({ top: -4, right: -4, bottom: -4, left: -4, borderWidth: 2, borderRadius: 22, borderColor: darkColors.lensBlue });
    await advance(200);
    expect(getAnimatedStyle(screen.getByTestId('focus-ring')).opacity).toBe(1);
    await fireEvent(screen.getByTestId('save'), 'blur');
    await advance(200);
    expect(getAnimatedStyle(screen.getByTestId('focus-ring')).opacity).toBe(0);
  });

  it('the focus ring mounts its animation only on first focus (no UI-thread work before)', async () => {
    await renderIn(<ListRow title="Next in queue" onPress={jest.fn()} testID="queue-1" />);
    const row = screen.getByTestId('queue-1');
    // C1: the row's own corners, the card's 24 inset by the ListCard's 4dp padding.
    expect(StyleSheet.flatten(row.props.style)).toMatchObject({ borderRadius: 20 });
    expect(screen.queryByTestId('focus-ring')).toBeNull();
    await fireEvent(row, 'focus');
    expect(StyleSheet.flatten(screen.getByTestId('focus-ring').props.style)).toMatchObject({ borderRadius: 24 });
  });

  it('segments carry radius 14 for the ring', async () => {
    await renderIn(<Segmented testID="seg" value="a" onChange={jest.fn()} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />);
    expect(StyleSheet.flatten(screen.getByTestId('seg-a').props.style)).toMatchObject({ borderRadius: 14 });
  });
});

describe('sheets (C4)', () => {
  it('Cancel and the backdrop close it, but never while a request is pending', async () => {
    const onCancel = jest.fn();
    const sheet = (loading: boolean) => <ConfirmSheet visible title="Suspend study?" confirmLabel="Suspend" destructive loading={loading} onConfirm={jest.fn()} onCancel={onCancel} />;
    const r = await renderIn(sheet(true));
    // The lock is visible and announced (C4: both actions aria-disabled, the confirm busy).
    expect(screen.getByTestId('confirm-cancel').props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(screen.getByTestId('confirm-ok').props.accessibilityState).toEqual({ disabled: true, busy: true });
    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    await fireEvent.press(screen.getByTestId('confirm-backdrop', { includeHiddenElements: true }));
    expect(onCancel).not.toHaveBeenCalled();
    await r.rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider fonts="system">{sheet(false)}</ThemeProvider>
      </SafeAreaProvider>,
    );
    await fireEvent.press(screen.getByTestId('confirm-backdrop', { includeHiddenElements: true }));
    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('a request that hangs never traps the user: Cancel unlocks after the escape delay', async () => {
    const onCancel = jest.fn();
    await renderIn(<ConfirmSheet visible title="Resolve dispute" confirmLabel="Resolve" loading onConfirm={jest.fn()} onCancel={onCancel} />);
    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    expect(onCancel).not.toHaveBeenCalled();
    await advance(SHEET_PENDING_ESCAPE_MS);
    expect(screen.getByTestId('confirm-cancel').props.accessibilityState).toMatchObject({ disabled: false });
    // The confirm keeps its spinner until the request settles.
    expect(screen.getByTestId('confirm-ok').props.accessibilityState).toEqual({ disabled: true, busy: true });
    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('the backdrop is neither an accessibility element nor a tab stop', async () => {
    await renderIn(<ConfirmSheet visible title="Resolve dispute" confirmLabel="Resolve" onConfirm={jest.fn()} onCancel={jest.fn()} />);
    const backdrop = screen.getByTestId('confirm-backdrop', { includeHiddenElements: true });
    expect(backdrop.props.tabIndex).toBe(-1);
    expect(backdrop.props.focusable).toBe(false);
    expect(backdrop.props.accessible).toBe(false);
  });

  it('focus moves to the title once it is open', async () => {
    const send = jest.spyOn(AccessibilityInfo, 'sendAccessibilityEvent').mockImplementation(() => undefined);
    await renderIn(<ConfirmSheet visible title="Resolve dispute" confirmLabel="Resolve" onConfirm={jest.fn()} onCancel={jest.fn()} />);
    await advance(60);
    expect(send).toHaveBeenCalledWith(expect.anything(), 'focus');
    expect(screen.getByText('Resolve dispute')).toBeTruthy();
  });
});
