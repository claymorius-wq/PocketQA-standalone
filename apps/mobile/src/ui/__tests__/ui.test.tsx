import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, Text as RNText, type TextStyle } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Coins, ExternalLink, Send, Sparkles, Square, Trash2, X } from 'lucide-react-native';
import type { BottomTabBarProps } from 'expo-router/tabs';
import type { NativeStackHeaderProps } from 'expo-router/native-stack';
import { ApiError } from '../../api/client';
import { glassDark, layout } from '../../theme/tokens';
import { glyphIcon, LUCIDE_TO_GLYPH } from '../../icons';
import { ThemeProvider, useTheme, type ThemePreference } from '../../theme/ThemeProvider';
import {
  Button,
  Card,
  Checkbox,
  ConfirmSheet,
  Divider,
  EmptyState,
  ErrorState,
  Field,
  glyphNameFor,
  LensStackHeader,
  LensTabBar,
  LoadingState,
  Notice,
  QueryState,
  Screen,
  Section,
  Segmented,
  StatusPill,
  Text,
} from '..';
import { ScreenContext } from '../screen';

// Jest resolves lucide's "react-native" export to an ES-module .mjs build that the jest-expo
// transform does not compile; its CommonJS build is the same set of components.
jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

async function renderIn(scheme: ThemePreference, ui: ReactNode) {
  let setPreference: ((p: ThemePreference) => void) | undefined;
  function Scheme({ children }: { children: ReactNode }) {
    setPreference = useTheme().setPreference;
    return <>{children}</>;
  }
  const result = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider fonts="system">
        <Scheme>{ui}</Scheme>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  await act(async () => setPreference?.(scheme));
  return result;
}

const SCHEMES: ThemePreference[] = ['dark', 'light'];

describe('Lucide → Lens glyph mapping in the kit', () => {
  it('resolves the icons screens pass to the kit, by component identity', () => {
    expect(glyphNameFor(Send)).toBe('send');
    expect(glyphNameFor(ExternalLink)).toBe('external');
    expect(glyphNameFor(Coins)).toBe(LUCIDE_TO_GLYPH.Coins);
    expect(glyphNameFor(Sparkles)).toBe('info');
    expect(glyphNameFor(Square)).toBe('stop');
  });
  it('leaves glyph icons and unknown components alone', () => {
    expect(glyphNameFor(glyphIcon('send'))).toBeNull();
    expect(glyphNameFor(() => null)).toBeNull();
  });
});

describe.each(SCHEMES)('UI kit in %s', (scheme) => {
  it('Text keeps the header role and switches display to display-stack under a stack header', async () => {
    await renderIn(
      scheme,
      <>
        <Text variant="display" testID="root-title">Discover</Text>
        <ScreenContext.Provider value={{ wave: { start: 0 }, mountedAt: 0, stack: true }}>
          <Text variant="display" testID="stack-title">Study</Text>
        </ScreenContext.Provider>
        <Text variant="small" testID="small">Body</Text>
      </>,
    );
    const size = (id: string) => (StyleSheet.flatten(screen.getByTestId(id).props.style) as TextStyle).fontSize;
    expect(size('root-title')).toBe(40);
    expect(size('stack-title')).toBe(32);
    expect(screen.getByTestId('stack-title').props.accessibilityRole).toBe('header');
    expect(screen.getByTestId('small').props.accessibilityRole).toBeUndefined();
  });

  it('Screen keeps its testID, title and subtitle', async () => {
    await renderIn(
      scheme,
      <Screen title="Discover" subtitle="Studies that match your device" testID="discover-screen">
        <RNText>first</RNText>
        {null}
        <RNText>second</RNText>
      </Screen>,
    );
    expect(screen.getByTestId('discover-screen')).toBeTruthy();
    expect(screen.getByText('Discover').props.accessibilityRole).toBe('header');
    expect(screen.getByText('Studies that match your device')).toBeTruthy();
    expect(screen.getByText('first')).toBeTruthy();
    expect(screen.getByText('second')).toBeTruthy();
  });

  it('Card is a labelled button only when pressable', async () => {
    const onPress = jest.fn();
    await renderIn(
      scheme,
      <>
        <Card testID="plain"><RNText>plain</RNText></Card>
        <Card testID="study-card-1" onPress={onPress} accessibilityLabel="Open study A"><RNText>A</RNText></Card>
      </>,
    );
    expect(screen.getByTestId('plain').props.accessibilityRole).toBeUndefined();
    const card = screen.getByTestId('study-card-1');
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toBe('Open study A');
    await fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('Button keeps label, testID, disabled and busy semantics for every variant', async () => {
    const onPress = jest.fn();
    await renderIn(
      scheme,
      <>
        <Button label="Sign in" icon={Send} onPress={onPress} testID="primary" />
        <Button label="Join" onPress={onPress} disabled testID="disabled" />
        <Button label="Saving" onPress={onPress} loading testID="busy" />
        <Button label="Retry" variant="secondary" icon={glyphIcon('refresh')} onPress={onPress} testID="secondary" />
        <Button label="Remove" variant="danger" icon={Trash2} onPress={onPress} testID="danger" />
        <Button label="View on devnet explorer" variant="ghost" icon={ExternalLink} onPress={onPress} testID="ghost" accessibilityHint="Opens the explorer" />
      </>,
    );
    await fireEvent.press(screen.getByTestId('primary'));
    await fireEvent.press(screen.getByTestId('secondary'));
    await fireEvent.press(screen.getByTestId('danger'));
    await fireEvent.press(screen.getByTestId('ghost'));
    expect(onPress).toHaveBeenCalledTimes(4);
    await fireEvent.press(screen.getByTestId('disabled'));
    await fireEvent.press(screen.getByTestId('busy'));
    expect(onPress).toHaveBeenCalledTimes(4);
    expect(screen.getByTestId('disabled').props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(screen.getByTestId('busy').props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(screen.getByTestId('ghost').props.accessibilityHint).toBe('Opens the explorer');
    expect(screen.getByText('View on devnet explorer')).toBeTruthy();
  });

  it('Field keeps its label, error testID and hint', async () => {
    const onChange = jest.fn();
    await renderIn(
      scheme,
      <>
        <Field label="Email" value="" onChangeText={onChange} testID="sign-in-email" hint="Use your work address" />
        <Field label="Reason" value="x" onChangeText={onChange} testID="reject-reason" error="At least 5 characters." multiline />
      </>,
    );
    const input = screen.getByTestId('sign-in-email');
    expect(input.props.accessibilityLabel).toBe('Email');
    expect(screen.getByText('EMAIL')).toBeTruthy();
    expect(screen.getByText('Use your work address')).toBeTruthy();
    await fireEvent.changeText(input, 'a@b.c');
    expect(onChange).toHaveBeenCalledWith('a@b.c');
    await fireEvent(input, 'focus');
    await fireEvent(input, 'blur');
    expect(screen.getByTestId('reject-reason-error')).toHaveTextContent('At least 5 characters.');
  });

  it('StatusPill keeps its label, uppercase text and testID', async () => {
    await renderIn(
      scheme,
      <>
        <StatusPill status="in_progress" testID="session-status" />
        <StatusPill status="expired" label="Not linked" />
      </>,
    );
    expect(screen.getByTestId('session-status').props.accessibilityLabel).toBe('Status: in progress');
    expect(screen.getByText('IN PROGRESS')).toBeTruthy();
    expect(screen.getByText('NOT LINKED')).toBeTruthy();
  });

  it('Notice, Section, Divider and the empty, error and loading states keep their testIDs', async () => {
    await renderIn(
      scheme,
      <>
        <Notice tone="success" title="Approved" testID="approved">50 test credits added to your balance.</Notice>
        <Notice tone="danger" title="Couldn’t sign in" testID="sign-in-error"><RNText>custom</RNText></Notice>
        <Section title="Tasks" testID="tasks"><Divider /></Section>
        <EmptyState icon={X} title="Nothing here" body="Check back later." />
        <ErrorState error={new ApiError('OFFLINE', 'offline', 0)} onRetry={jest.fn()} />
        <LoadingState label="Starting Pocket QA…" />
      </>,
    );
    expect(screen.getByTestId('approved').props.accessibilityRole).toBe('summary');
    expect(screen.getByText('50 test credits added to your balance.')).toBeTruthy();
    expect(screen.getByText('custom')).toBeTruthy();
    expect(screen.getByText('Tasks').props.accessibilityRole).toBe('header');
    expect(screen.getByTestId('empty-state')).toBeTruthy();
    expect(screen.getByTestId('offline-state')).toBeTruthy();
    expect(screen.getByTestId('retry-button')).toBeTruthy();
    const loading = screen.getByTestId('loading-state');
    expect(loading.props.accessibilityRole).toBe('progressbar');
    expect(loading.props.accessibilityLabel).toBe('Starting Pocket QA…');
  });

  it('QueryState shows loading, error and data', async () => {
    const base = { refetch: jest.fn() };
    const { rerender } = await renderIn(scheme, <QueryState query={{ ...base, isLoading: true, error: null, data: undefined }}>{() => null}</QueryState>);
    expect(screen.getByTestId('loading-state')).toBeTruthy();
    await rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider fonts="system">
          <QueryState query={{ ...base, isLoading: false, error: new ApiError('NOT_FOUND', 'gone', 404), data: undefined }}>{() => null}</QueryState>
        </ThemeProvider>
      </SafeAreaProvider>,
    );
    expect(screen.getByTestId('not-found-state')).toBeTruthy();
    expect(screen.queryByTestId('retry-button')).toBeNull();
  });

  it('Segmented is a radio group with per-option testIDs', async () => {
    const onChange = jest.fn();
    await renderIn(
      scheme,
      <Segmented
        options={[
          { value: 'tester', label: 'Tester' },
          { value: 'builder', label: 'Builder' },
        ]}
        value="tester"
        onChange={onChange}
        testID="role"
      />,
    );
    expect(screen.getByTestId('role').props.accessibilityRole).toBe('radiogroup');
    const builder = screen.getByTestId('role-builder');
    expect(builder.props.accessibilityRole).toBe('radio');
    expect(builder.props.accessibilityState).toEqual({ selected: false });
    expect(screen.getByTestId('role-tester').props.accessibilityState).toEqual({ selected: true });
    await fireEvent(screen.getByTestId('role'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 58 } } });
    await fireEvent.press(builder);
    expect(onChange).toHaveBeenCalledWith('builder');
  });

  it('Checkbox keeps its role and checked state', async () => {
    const onChange = jest.fn();
    await renderIn(scheme, <Checkbox checked={false} onChange={onChange} label="I agree" testID="consent-checkbox" />);
    const box = screen.getByTestId('consent-checkbox');
    expect(box.props.accessibilityRole).toBe('checkbox');
    expect(box.props.accessibilityState).toEqual({ checked: false });
    await fireEvent.press(box);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('ConfirmSheet renders only while visible, Cancel left of the confirm, confirm disabled on request', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const sheet = (visible: boolean, confirmDisabled = false) => (
      <ConfirmSheet visible={visible} title="Publish this study?" body="Reserved from your test credits." confirmLabel="Publish" confirmDisabled={confirmDisabled} onConfirm={onConfirm} onCancel={onCancel} />
    );
    const wrap = (ui: ReactNode) => (
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider fonts="system">{ui}</ThemeProvider>
      </SafeAreaProvider>
    );
    const { rerender } = await renderIn(scheme, sheet(false));
    expect(screen.queryByTestId('confirm-sheet')).toBeNull();
    await rerender(wrap(sheet(true, true)));
    expect(screen.getByTestId('confirm-sheet')).toBeTruthy();
    expect(screen.getByTestId('confirm-ok').props.accessibilityState).toEqual({ disabled: true, busy: false });
    await rerender(wrap(sheet(true)));
    const ids = screen.getAllByTestId(/^confirm-(cancel|ok)$/).map((n) => n.props.testID as string);
    expect(ids).toEqual(['confirm-cancel', 'confirm-ok']);
    await fireEvent.press(screen.getByTestId('confirm-ok'));
    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('the tab bar keeps the tab testIDs, selection state and tabPress contract', async () => {
    const emit = jest.fn(() => ({ defaultPrevented: false }));
    const navigate = jest.fn();
    const routes = [
      { key: 'discover-1', name: 'discover', params: undefined },
      { key: 'credits-1', name: 'credits', params: undefined },
    ];
    const descriptors = Object.fromEntries(routes.map((r) => [r.key, { options: { title: r.name === 'discover' ? 'Discover' : 'Credits', tabBarButtonTestID: `tab-${r.name}` } }]));
    const props = {
      state: { index: 0, routes, key: 'tabs', routeNames: ['discover', 'credits'], type: 'tab', stale: false, history: [], preloadedRouteKeys: [] },
      descriptors,
      navigation: { emit, navigate },
      insets: { top: 0, left: 0, right: 0, bottom: 16 },
    } as unknown as BottomTabBarProps;
    await renderIn(scheme, <LensTabBar {...props} items={{ discover: { glyph: 'discover', icon: Coins }, credits: { glyph: null, icon: Coins } }} />);
    const discover = screen.getByTestId('tab-discover');
    const credits = screen.getByTestId('tab-credits');
    expect(discover).toBeSelected();
    expect(credits).not.toBeSelected();
    // C1: tab cells carry the focus ring at radius 18.
    expect(StyleSheet.flatten(discover.props.style)).toMatchObject({ borderRadius: 18 });
    expect(screen.getByText('Credits')).toBeTruthy();
    await fireEvent.press(discover);
    expect(navigate).not.toHaveBeenCalled();
    await fireEvent.press(credits);
    expect(emit).toHaveBeenCalledWith({ type: 'tabPress', target: 'credits-1', canPreventDefault: true });
    expect(navigate).toHaveBeenCalledWith('credits', undefined);
  });

  it('the stack header has one labelled Back button and the title as a header', async () => {
    const goBack = jest.fn();
    const props = {
      navigation: { goBack },
      route: { key: 'study-1', name: 'study/[id]' },
      options: { title: 'Study' },
      back: { title: undefined, href: undefined },
    } as unknown as NativeStackHeaderProps;
    await renderIn(scheme, <LensStackHeader {...props} />);
    expect(screen.getByText('Study').props.accessibilityRole).toBe('header');
    const back = screen.getByLabelText('Back');
    await fireEvent.press(back);
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/\(tester\)/)).toBeNull();
  });
});

describe('Lens review fixes (dark)', () => {
  /** The nearest host (native view) ancestor of a node. */
  const hostParent = (node: { parent: unknown }) => {
    let p = node.parent as { type: unknown; parent: unknown; props: { style?: unknown } } | null;
    while (p && typeof p.type !== 'string') p = p.parent as typeof p;
    return p;
  };
  const count = (json: unknown, needle: string) => JSON.stringify(json).split(needle).length - 1;
  const svgCount = (json: unknown) => (JSON.stringify(json).match(/"type":"RNSVGSvgView[A-Za-z]*"/g) ?? []).length;
  // UplightFloor's root is the only view anchored with this transform origin.
  const FLOOR = '"transformOrigin":"50% 100%"';

  it('Screen keeps the column gap for a fragment rendered inside one entrance step', async () => {
    await renderIn(
      'dark',
      <Screen title="Credits">
        <QueryState query={{ isLoading: false, error: null, data: 1, refetch: jest.fn() }}>
          {() => (
            <>
              <Card testID="c1"><RNText>a</RNText></Card>
              <Card testID="c2"><RNText>b</RNText></Card>
            </>
          )}
        </QueryState>
      </Screen>,
    );
    const a = hostParent(screen.getByTestId('c1'));
    expect(a).toBe(hostParent(screen.getByTestId('c2')));
    const style = StyleSheet.flatten(a!.props.style as TextStyle);
    expect(style.gap).toBe(layout.listGap);
    // The step wrapper, not the screen column.
    expect(style.maxWidth).toBeUndefined();
  });

  it('an errored field keeps its error well under the focus glow; the glow mounts on first focus', async () => {
    const r = await renderIn('dark', <Field label="Reason" value="x" onChangeText={jest.fn()} testID="reject-reason" error="At least 5 characters." />);
    // Before layout a well shows its first fill stop: the error floor, never the plain well's.
    const errorFloor = glassDark.wellError.fill[0]!.stops[0]!.color;
    const plainFloor = glassDark.well.fill[0]!.stops[0]!.color;
    const before = count(r.toJSON(), errorFloor);
    expect(before).toBeGreaterThan(0);
    await fireEvent(screen.getByTestId('reject-reason'), 'focus');
    // A second (focus) well appears, and it keeps the error floor.
    expect(count(r.toJSON(), errorFloor)).toBe(2 * before);
    expect(count(r.toJSON(), plainFloor)).toBe(0);
  });

  it('the live LED marks in-progress and uploading work, never pending', async () => {
    const led = '"boxShadow":"0 0 0 2px rgba(';
    expect(count((await renderIn('dark', <StatusPill status="pending" label="Pending" />)).toJSON(), led)).toBe(0);
    // The board's pill dot: a 2px tone ring and an 8px glow at 0.75 (glass.ledShadow), in the pill's tone.
    expect(JSON.stringify((await renderIn('dark', <StatusPill status="uploading" label="uploading" />)).toJSON())).toContain(glassDark.ledShadow('warning'));
    expect(JSON.stringify((await renderIn('dark', <StatusPill status="in_progress" />)).toJSON())).toContain(glassDark.ledShadow('info'));
  });

  it('loading is the one spinner row (C7): no skeleton cards; the lens only on the brand start screen', async () => {
    const q = await renderIn('dark', <QueryState query={{ isLoading: true, error: null, data: undefined, refetch: jest.fn() }}>{() => null}</QueryState>);
    // Just the 18dp spinner: no lens, no placeholder cards.
    expect(svgCount(q.toJSON())).toBe(1);
    expect(screen.getByTestId('loading-state').props.accessibilityState).toEqual({ busy: true });
    const brand = await renderIn('dark', <LoadingState label="Starting Pocket QA…" brand />);
    expect(svgCount(brand.toJSON())).toBeGreaterThan(1);
    expect(screen.getByTestId('loading-state').props.accessibilityLabel).toBe('Starting Pocket QA…');
  });

  it('ConfirmSheet uses the board padding and opts in or out of the commit moment', async () => {
    const sheet = (moment?: 'commit' | 'none') => (
      <ConfirmSheet visible title="Publish this study?" confirmLabel="Publish" moment={moment} onConfirm={jest.fn()} onCancel={jest.fn()} />
    );
    const lit = await renderIn('dark', sheet());
    expect(StyleSheet.flatten(screen.getByTestId('confirm-sheet').props.style)).toMatchObject({ paddingTop: 9, paddingHorizontal: 23 });
    expect(count(lit.toJSON(), FLOOR)).toBeGreaterThan(0);
    const unlit = await renderIn('dark', sheet('none'));
    expect(count(unlit.toJSON(), FLOOR)).toBe(0);
  });

  /** The U7 floor's current intensity (its root view's animated opacity). */
  const floorOpacity = (r: { container: { queryAll: (p: (n: { type: unknown; props: { style?: unknown } }) => boolean) => { props: { style?: unknown } }[] } }) => {
    const [floor] = r.container.queryAll((n) => typeof n.type === 'string' && (StyleSheet.flatten(n.props.style as TextStyle) as { transformOrigin?: string } | undefined)?.transformOrigin === '50% 100%');
    return floor ? (getAnimatedStyle(floor as never) as { opacity: number }).opacity : null;
  };

  it('the commit light never rises on press: the pilot holds while pending, and only success plays the pass', async () => {
    const sheet = (status: 'idle' | 'pending' | 'success', loading = false) => (
      <ConfirmSheet visible title="Publish this study?" confirmLabel="Publish" loading={loading} status={status} onConfirm={jest.fn()} onCancel={jest.fn()} />
    );
    const wrap = (ui: ReactNode) => (
      <SafeAreaProvider initialMetrics={METRICS}>
        <ThemeProvider fonts="system">{ui}</ThemeProvider>
      </SafeAreaProvider>
    );
    const r = await renderIn('dark', sheet('idle'));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(floorOpacity(r)).toBeCloseTo(0.55, 2);
    await fireEvent.press(screen.getByTestId('confirm-ok'));
    await r.rerender(wrap(sheet('pending', true)));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(floorOpacity(r)).toBeCloseTo(0.55, 2);
    await r.rerender(wrap(sheet('success')));
    await act(async () => {
      jest.advanceTimersByTime(560);
    });
    expect(floorOpacity(r)!).toBeGreaterThan(0.9);
  });

  it('no Commit tail on a screen floor: once the sheet closes the light is gone with it', async () => {
    function Publish() {
      const [open, setOpen] = useState(true);
      return (
        <Screen title="Study">
          <ConfirmSheet visible={open} title="Publish this study?" confirmLabel="Publish" onConfirm={() => setOpen(false)} onCancel={() => setOpen(false)} />
        </Screen>
      );
    }
    const r = await renderIn('dark', <Publish />);
    await fireEvent.press(screen.getByTestId('confirm-ok'));
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(screen.queryByTestId('confirm-sheet')).toBeNull();
    expect(count(r.toJSON(), FLOOR)).toBe(0);
  });

  it('a sheet opens with its C4 header tile beside the title, and a failure shows the alert notice', async () => {
    const r = await renderIn(
      'dark',
      <ConfirmSheet visible title="Suspend study?" confirmLabel="Suspend" destructive status="error" error="Study already suspended." onConfirm={jest.fn()} onCancel={jest.fn()} />,
    );
    // The 54dp hero tile, then the title in the same row.
    expect(JSON.stringify(r.toJSON())).toContain('"width":54,"height":54');
    expect(screen.getByText('Action failed')).toBeTruthy();
    expect(screen.getByText('Study already suspended.')).toBeTruthy();
  });
});
