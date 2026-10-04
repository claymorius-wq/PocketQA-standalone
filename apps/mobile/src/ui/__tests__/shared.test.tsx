import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { HeaderHeightContext, NavigationContext } from 'expo-router/react-navigation';
import { BottomTabBarHeightContext } from 'expo-router/tabs';
import { useEffect, useRef, type ReactNode } from 'react';
import { AccessibilityInfo, Keyboard, ScrollView, StyleSheet, Text as RNText, type ViewStyle } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useUplight } from '../../glass';
import { BALANCE_POSE, BalanceTile, panShift } from '../../icons';
import { stampArrival, takeArrival, takeHandoff } from '../../motion/entrance';
import { UPLIGHT } from '../../theme/motion';
import { ThemeProvider, useTheme, type ThemePreference } from '../../theme/ThemeProvider';
import { dark, glassDark } from '../../theme/tokens';
import { Button, Checkbox, ConfirmSheet, EmptyState, Field, Notice, Screen, ScreenSpacer, Segmented, StatusPill, Text, useDockKeyboard } from '..';
import { clauseSpaceTracking } from '../text';
import { fontFamilies } from '../../theme/tokens';
import { BudgetMeter, Clauses, KeyValue, ListRow, planBudgetBar } from '../patterns';

// The shared requests of the screen phase: the kit APIs the screens asked for (Screen dock, Button
// size / sweepOnFire / locked, ConfirmSheet's pass lock and failure options, the land grade, the
// u2 hand-off, the S6 balance, the C8 pill crossfade, …).

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
const HIDDEN_OK = { includeHiddenElements: true };

function wrap(ui: ReactNode) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider fonts="system">{ui}</ThemeProvider>
    </SafeAreaProvider>
  );
}

/** The dark scheme, kept across rerenders (the tree's shape stays the same). */
function Dark({ children }: { children: ReactNode }) {
  const { setPreference } = useTheme();
  useEffect(() => setPreference('dark'), [setPreference]);
  return <>{children}</>;
}
const wrapDark = (ui: ReactNode) => wrap(<Dark>{ui}</Dark>);

async function renderIn(scheme: ThemePreference, ui: ReactNode) {
  let setPreference: ((p: ThemePreference) => void) | undefined;
  function Scheme({ children }: { children: ReactNode }) {
    setPreference = useTheme().setPreference;
    return <>{children}</>;
  }
  const result = await render(wrap(<Scheme>{ui}</Scheme>));
  await act(async () => setPreference?.(scheme));
  return result;
}

/** How many times `marker` appears in the rendered tree. */
const count = (r: { toJSON: () => unknown }, marker: string) => JSON.stringify(r.toJSON()).split(marker).length - 1;
/** The spinner's arc, the caustic sweep's clip and the under-glow's box. */
const SPINNER = 'M9 2a7 7 0 0 1 7 7';
const SWEEP = '"overflow":"hidden"';
const GLOW = '"bottom":-28';

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

describe('Button: size, sweepOnFire, locked, accessibilityLabel', () => {
  it('a primary sweeps on fire unless sweepOnFire is false', async () => {
    const r = await renderIn('dark', <Button label="Sign in" onPress={jest.fn()} testID="b" />);
    const before = count(r, SWEEP);
    await fireEvent.press(screen.getByTestId('b'));
    expect(count(r, SWEEP)).toBe(before + 1);
    const quiet = await renderIn('dark', <Button label="Sign in" onPress={jest.fn()} sweepOnFire={false} testID="q" />);
    const quietBefore = count(quiet, SWEEP);
    await fireEvent.press(screen.getByTestId('q'));
    expect(count(quiet, SWEEP)).toBe(quietBefore);
  });

  it('compact keeps the 48dp touch minimum with the 14 radius; the label can differ from the text', async () => {
    await renderIn('dark', <Button label="Edit" variant="secondary" size="compact" accessibilityLabel="Edit device profile" onPress={jest.fn()} testID="e" />);
    const b = screen.getByTestId('e');
    expect(StyleSheet.flatten(b.props.style)).toMatchObject({ minHeight: 48, borderRadius: 14, paddingHorizontal: 14 });
    expect(b.props.accessibilityLabel).toBe('Edit device profile');
    expect(screen.getByText('Edit')).toBeTruthy();
  });

  it('locked ignores presses and is busy, without the spinner or the unlit look', async () => {
    const onPress = jest.fn();
    const r = await renderIn('dark', <Button label="Approve" onPress={onPress} locked testID="l" />);
    const b = screen.getByTestId('l');
    expect(b.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    await fireEvent.press(b);
    expect(onPress).not.toHaveBeenCalled();
    expect(count(r, SPINNER)).toBe(0);
  });
});

describe('ConfirmSheet: the Commit pass lock, failure options, a custom tile', () => {
  it('locks both actions through a success pass, without a spinner', async () => {
    const onCancel = jest.fn();
    const r = await renderIn('dark', <ConfirmSheet visible title="Publish this study?" confirmLabel="Publish" status="success" onConfirm={jest.fn()} onCancel={onCancel} />);
    expect(screen.getByTestId('confirm-ok').props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    expect(screen.getByTestId('confirm-cancel').props.accessibilityState).toMatchObject({ disabled: true });
    expect(count(r, SPINNER)).toBe(0);
    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('a non-commit sheet is not locked by success; the failure takes its title and testID', async () => {
    await renderIn(
      'dark',
      <ConfirmSheet visible title="Dispute the rejection" confirmLabel="Send dispute" status="error" error="Window closed." failureTitle="Couldn’t send" errorTestID="sheet-error" onConfirm={jest.fn()} onCancel={jest.fn()} />,
    );
    expect(screen.getByTestId('sheet-error')).toBeTruthy();
    expect(screen.getByText('Couldn’t send')).toBeTruthy();
    expect(screen.getByText('Window closed.')).toBeTruthy();
    expect(screen.getByTestId('confirm-ok').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it('takes a header tile of the screen’s own (S6 balance)', async () => {
    await renderIn('dark', <ConfirmSheet visible title="Resolve dispute" confirmLabel="Resolve" moment="none" tile={<BalanceTile pose="uphold" from="level" delay={380} testID="balance" />} onConfirm={jest.fn()} onCancel={jest.fn()} />);
    expect(screen.getByTestId('balance', HIDDEN_OK)).toBeTruthy();
  });
});

describe('Screen dock', () => {
  /** The dock frame: the nearest ancestor of the dock's content that reports its layout. */
  function frameOf(testID: string) {
    let n = screen.getByTestId(testID).parent;
    while (n && !n.props.onLayout) n = n.parent;
    if (!n) throw new Error('no dock frame');
    return n;
  }

  it('floats the dock and ends the content above it', async () => {
    await renderIn(
      'dark',
      <Screen title="Study" testID="scr" dock={<RNText testID="dock">Actions</RNText>}>
        <RNText>Content</RNText>
      </Screen>,
    );
    expect(screen.getByTestId('dock')).toBeTruthy();
    // The scroll content's container: the first node under the screen with a bottom padding.
    const scroll = () => {
      const stack = [screen.getByTestId('scr')];
      while (stack.length) {
        const n = stack.shift()!;
        const st = StyleSheet.flatten(n.props.contentContainerStyle ?? n.props.style) as { paddingBottom?: number } | undefined;
        if (typeof st?.paddingBottom === 'number') return st as { paddingBottom: number };
        stack.push(...(n.children.filter((c) => typeof c !== 'string') as (typeof n)[]));
      }
      throw new Error('no scroll content');
    };
    expect(scroll().paddingBottom).toBe(64);
    await act(async () => fireEvent(frameOf('dock'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 366, height: 80 } } }));
    // 80 + the 12dp float inset + the 16dp bottom inset + the default 24 clearance.
    expect(scroll().paddingBottom).toBe(80 + 12 + 16 + 24);
  });

  it('`hide` steps the dock aside while the keyboard is up; the dock can read the keyboard', async () => {
    const handlers: Record<string, () => void> = {};
    jest.spyOn(Keyboard, 'addListener').mockImplementation(((event: string, cb: () => void) => {
      handlers[event] = cb;
      return { remove: jest.fn() };
    }) as unknown as typeof Keyboard.addListener);
    function Probe() {
      return <RNText testID="dock">{useDockKeyboard() ? 'up' : 'down'}</RNText>;
    }
    await renderIn(
      'dark',
      <Screen dock={<Probe />} dockKeyboard="hide">
        <RNText>Form</RNText>
      </Screen>,
    );
    expect(screen.getByText('down')).toBeTruthy();
    await act(async () => (handlers.keyboardWillShow ?? handlers.keyboardDidShow)?.());
    expect(screen.getByText('up', HIDDEN_OK)).toBeTruthy();
    expect(StyleSheet.flatten(frameOf('dock').props.style)).toMatchObject({ pointerEvents: 'none' });
  });

  it('a tab root scrolls to the top when its tab is pressed again', async () => {
    let onTabPress: ((e: { defaultPrevented?: boolean }) => void) | undefined;
    const navigation = {
      isFocused: () => true,
      addListener: (event: string, cb: (e: { defaultPrevented?: boolean }) => void) => {
        if (event === 'tabPress') onTabPress = cb;
        return () => undefined;
      },
    };
    const scrollTo = jest.fn();
    function Tab() {
      const ref = useRef<ScrollView>(null);
      return (
        <Screen title="Discover" scrollRef={ref}>
          <RNText
            onLayout={() => {
              if (ref.current) ref.current.scrollTo = scrollTo;
            }}
            testID="content"
          >
            Studies
          </RNText>
        </Screen>
      );
    }
    await renderIn(
      'dark',
      <NavigationContext.Provider value={navigation as never}>
        <BottomTabBarHeightContext.Provider value={98}>
          <Tab />
        </BottomTabBarHeightContext.Provider>
      </NavigationContext.Provider>,
    );
    await act(async () => fireEvent(screen.getByTestId('content'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 1, height: 1 } } }));
    expect(onTabPress).toBeDefined();
    await act(async () => onTabPress?.({}));
    await advance(32);
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });
});

describe('Uplight land grade and the u2 hand-off', () => {
  it('land rises to 0.6 in 240ms and goes out over 700; replay plays it again', async () => {
    let value = () => 0;
    function Read({ run }: { run: number }) {
      const light = useUplight('land', run > 0, { replay: run });
      value = () => light.u.value;
      return null;
    }
    const r = await render(wrapDark(<Read run={0} />));
    await advance(400);
    expect(value()).toBe(0);
    await r.rerender(wrapDark(<Read run={1} />));
    await advance(UPLIGHT.land.rise);
    expect(value()).toBeCloseTo(UPLIGHT.land.peak, 1);
    await advance(UPLIGHT.land.fall + 60);
    expect(value()).toBe(0);
    await r.rerender(wrapDark(<Read run={2} />));
    await advance(UPLIGHT.land.rise);
    expect(value()).toBeCloseTo(UPLIGHT.land.peak, 1);
  });

  it('takeHandoff reads only the stamp it finishes and leaves the others for their navigator', () => {
    stampArrival('replace', { handoff: 'u1' });
    expect(takeHandoff('u2')).toBe(false);
    expect(takeArrival()).toEqual({ arrival: 'replace', handoff: 'u1' });
    stampArrival('push', { handoff: 'u2' });
    expect(takeHandoff('u2')).toBe(true);
    expect(takeHandoff('u2')).toBe(false);
  });
});

describe('S6 balance (DISPUTES_PARTS)', () => {
  it('level turns the drawn beam horizontal; the pans move with their hangers', () => {
    const hangL = { x: 7 - 16, y: 11.6 - 8.3 };
    const hangR = { x: 25 - 16, y: 9.4 - 8.3 };
    expect(panShift(hangL, BALANCE_POSE.uphold)).toEqual({ x: 0, y: 0 });
    const l = panShift(hangL, BALANCE_POSE.level);
    const r = panShift(hangR, BALANCE_POSE.level);
    expect(hangL.y + l.y).toBeCloseTo(hangR.y + r.y, 2);
    // Overturn tips the other way: the right pan hangs lower.
    const lo = panShift(hangL, BALANCE_POSE.overturn);
    const ro = panShift(hangR, BALANCE_POSE.overturn);
    expect(hangR.y + ro.y).toBeGreaterThan(hangL.y + lo.y);
  });

  it.each(['dark', 'light'] as const)('renders as a tile in %s', async (scheme) => {
    await renderIn(scheme, <BalanceTile size="notice" tint="success" pose="overturn" from="level" delay={420} testID="t" />);
    await advance(800);
    expect(screen.getByTestId('t', HIDDEN_OK)).toBeTruthy();
  });
});

describe('StatusPill crossfade (C8 pillSlot)', () => {
  it('the old and the new pill share the slot for 120ms, then the old one goes; only the new one is read', async () => {
    const r = await render(wrap(<StatusPill status="submitted" label="Awaiting review" testID="pill" />));
    await r.rerender(wrap(<StatusPill status="approved" label="Approved" testID="pill" />));
    expect(screen.getByText('APPROVED')).toBeTruthy();
    expect(screen.queryByText('AWAITING REVIEW')).toBeNull();
    expect(screen.getByText('AWAITING REVIEW', HIDDEN_OK)).toBeTruthy();
    expect(screen.getAllByTestId('pill')).toHaveLength(1);
    await advance(200);
    expect(screen.queryByText('AWAITING REVIEW', HIDDEN_OK)).toBeNull();
  });
});

describe('Notice uplight (Mode A)', () => {
  function Lit({ tone }: { tone: 'success' | 'danger' }) {
    const light = useUplight('earned', true);
    return (
      <Notice tone={tone} title="Approved" uplight={light} testID="n">
        50 test credits added to your balance.
      </Notice>
    );
  }
  it('a success notice carries the under-glow; a danger notice is never lit', async () => {
    const lit = await renderIn('dark', <Lit tone="success" />);
    expect(count(lit, GLOW)).toBeGreaterThan(0);
    expect(screen.getByTestId('n')).toBeTruthy();
    const danger = await renderIn('dark', <Lit tone="danger" />);
    expect(count(danger, GLOW)).toBe(0);
  });
});

describe('Field, Segmented and Checkbox options', () => {
  it('Field: invalid shows the danger label without a message; numeral sets the value large; locked adds the pressed shade', async () => {
    const r = await renderIn('dark', <Field label="Slots" value="5" onChangeText={jest.fn()} invalid numeral locked testID="slots" />);
    expect(StyleSheet.flatten(screen.getByText('SLOTS').props.style)).toMatchObject({ color: dark.danger });
    expect(screen.queryByTestId('slots-error')).toBeNull();
    expect(StyleSheet.flatten(screen.getByTestId('slots').props.style)).toMatchObject({ fontSize: 28, lineHeight: 32 });
    expect(JSON.stringify(r.toJSON())).toContain('rgba(8,7,26,0.36)');
  });

  it('Segmented: a glyph per option and the numeral label', async () => {
    await renderIn(
      'dark',
      <Segmented
        testID="amount"
        value="500"
        onChange={jest.fn()}
        labelVariant="numeral"
        options={[
          { value: '500', label: '500', glyph: 'credits' },
          { value: '1000', label: '1,000' },
        ]}
      />,
    );
    expect(StyleSheet.flatten(screen.getByText('500').props.style)).toMatchObject({ fontSize: 18, lineHeight: 22 });
    expect(StyleSheet.flatten(screen.getByTestId('amount-500').props.style)).toMatchObject({ flexDirection: 'row' });
  });

  it('Checkbox: the chip label', async () => {
    await renderIn('dark', <Checkbox label="Android" checked={false} onChange={jest.fn()} invalid labelVariant="chip" testID="c" />);
    expect(StyleSheet.flatten(screen.getByText('Android').props.style)).toMatchObject({ fontSize: 15, lineHeight: 20 });
  });
});

describe('patterns options', () => {
  it('ListRow: dim title and ledger density', async () => {
    await renderIn('dark', <ListRow title="Checkout study" dim density="ledger" testID="row" />);
    expect(StyleSheet.flatten(screen.getByText('Checkout study').props.style)).toMatchObject({ color: dark.textDim });
    expect(StyleSheet.flatten(screen.getByTestId('row').props.style)).toMatchObject({ minHeight: 72, paddingTop: 12, paddingRight: 14 });
  });

  it('KeyValue: the value takes its own style', async () => {
    await renderIn('dark', <KeyValue label="Awarded" value={50} valueTestID="v" valueStyle={{ opacity: 0.5 }} />);
    expect(StyleSheet.flatten(screen.getByTestId('v').props.style)).toMatchObject({ opacity: 0.5 });
  });

  it('BudgetMeter: a bar over 10 slots, shares never rounded to nothing', async () => {
    expect(planBudgetBar({ slots: 100, awarded: 1, committed: 0, width: 300 })).toEqual([{ x: 0, w: 6, material: 'awarded' }]);
    expect(planBudgetBar({ slots: 20, awarded: 5, committed: 5, width: 200 })).toEqual([
      { x: 0, w: 50, material: 'awarded' },
      { x: 50, w: 50, material: 'filled' },
    ]);
    await renderIn('dark', <BudgetMeter slots={40} awarded={4} committed={8} available={28} testID="meter" />);
    expect(StyleSheet.flatten(screen.getByTestId('meter', HIDDEN_OK).props.style)).toMatchObject({ height: 12 });
  });

  it('EmptyState: actionStretch fills the card', async () => {
    await renderIn('dark', <EmptyState icon="work" title="No sessions yet" body="Join a study." action={<RNText testID="act">Find studies</RNText>} actionStretch />);
    expect(StyleSheet.flatten(screen.getByTestId('act').parent?.props.style)).toMatchObject({ alignSelf: 'stretch' });
  });

  it('the tokens carry the screens’ recipes: the dark well, the uplit primary edge and spill', () => {
    expect(glassDark.wellDark.fill[0]!.stops[0]!.color).toBe('#07061A');
    expect(glassDark.uplight.primaryEdge).toContain('inset 0 -1px 0 rgba(238,242,255,0.9)');
    expect(glassDark.uplight.commitConfirmShadow).toContain(glassDark.uplight.spill!);
  });
});

describe('shared findings, round 2', () => {
  it('Button sweepSignal: an increase sweeps an enabled primary, never on mount or while disabled', async () => {
    const ui = (n: number, disabled = false) => wrapDark(<Button label="Start session" onPress={jest.fn()} sweepSignal={n} disabled={disabled} testID="go" />);
    const r = await render(ui(0));
    await act(async () => {});
    const base = count(r, SWEEP);
    await r.rerender(ui(1));
    expect(count(r, SWEEP)).toBe(base + 1);
    const off = await render(ui(0, true));
    await act(async () => {});
    const offBase = count(off, SWEEP);
    await off.rerender(ui(1, true));
    expect(count(off, SWEEP)).toBe(offBase);
  });

  it('sheet actions sit in equal unpadded slots (C4 1 : 1)', async () => {
    await renderIn('dark', <ConfirmSheet visible title="Withdraw from this study?" confirmLabel="Withdraw" destructive onConfirm={jest.fn()} onCancel={jest.fn()} />);
    const slot = { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 };
    for (const id of ['confirm-cancel', 'confirm-ok']) {
      const parent = screen.getByTestId(id).parent;
      expect(StyleSheet.flatten(parent?.props.style)).toMatchObject(slot);
      expect(StyleSheet.flatten(parent?.props.style)).not.toHaveProperty('paddingHorizontal');
    }
  });

  it('Segmented: a 52 track with 48dp cells and the 44 tile', async () => {
    await renderIn('dark', <Segmented testID="seg" value="a" onChange={jest.fn()} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />);
    expect(StyleSheet.flatten(screen.getByTestId('seg').props.style)).toMatchObject({ paddingVertical: 2, paddingHorizontal: 4 });
    expect(StyleSheet.flatten(screen.getByTestId('seg-a').props.style)).toMatchObject({ minHeight: 48 });
  });

  it('Field: the hint takes the error colour while the field is invalid', async () => {
    await renderIn('dark', <Field label="Objective" value="" onChangeText={jest.fn()} hint="What should testers help you learn?" invalid />);
    expect(StyleSheet.flatten(screen.getByText('What should testers help you learn?').props.style)).toMatchObject({ color: dark.danger });
    await renderIn('dark', <Field label="Objective" value="" onChangeText={jest.fn()} hint="What should testers help you learn?" />);
    expect(StyleSheet.flatten(screen.getByText('What should testers help you learn?').props.style)).toMatchObject({ color: dark.textMuted });
  });

  it('clause dots sit 0.28em from each clause and still read " · "', async () => {
    await renderIn('dark', <Clauses parts={['approved', 'Not guaranteed']} testID="cl" />);
    expect(screen.getByText('approved · Not guaranteed')).toBeTruthy();
    // Each space beside the dot is tracked out by 0.08em of the 13dp line.
    const tracked = screen.getByTestId('cl').children.filter((c) => typeof c !== 'string' && StyleSheet.flatten(c.props.style)?.letterSpacing === 1.04);
    expect(tracked).toHaveLength(2);
  });

  it('a stack screen scrolls under its header, behind the ground scrim', async () => {
    await renderIn(
      'dark',
      <HeaderHeightContext.Provider value={98}>
        <Screen testID="scr">
          <RNText>Content</RNText>
        </Screen>
      </HeaderHeightContext.Provider>,
    );
    // Down to where the content starts (98 + 8): the fade sits below the 44dp Back / title row.
    expect(StyleSheet.flatten(screen.getByTestId('header-scrim', HIDDEN_OK).props.style)).toMatchObject({ top: 0, height: 106 });
    expect(StyleSheet.flatten(screen.getByTestId('scr').props.style)).not.toHaveProperty('paddingTop', 98);
  });
});

/** Every host node under `root` (breadth first). */
function hosts(root: ReturnType<typeof screen.getByTestId>) {
  const out: (typeof root)[] = [];
  const queue = [root];
  while (queue.length) {
    const n = queue.shift()!;
    out.push(n);
    queue.push(...(n.children.filter((c) => typeof c !== 'string') as (typeof root)[]));
  }
  return out;
}
const flat = (n: { props: { style?: unknown } }) => (StyleSheet.flatten(n.props.style as ViewStyle) ?? {}) as ViewStyle & { boxShadow?: string; letterSpacing?: number };
type Rendered = Awaited<ReturnType<typeof render>>;

describe('shared findings, round 3', () => {
  it('HeaderScrim: solid through the whole Back / title row, fading only below it, never over content at rest', async () => {
    const r = await renderIn(
      'dark',
      <HeaderHeightContext.Provider value={98}>
        <Screen testID="scr">
          <RNText>Content</RNText>
        </Screen>
      </HeaderHeightContext.Provider>,
    );
    // The ground lays out, so the scrim paints its strip of it.
    for (const n of r.container.queryAll((x) => typeof x.type === 'string' && typeof x.props.onLayout === 'function')) {
      await act(async () => n.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } }));
    }
    const scrim = screen.getByTestId('header-scrim', HIDDEN_OK);
    expect(flat(scrim)).toMatchObject({ top: 0, height: 106 });
    // The mask holds full ground to the row's bottom edge (98 − 4 = 94) and is clear by the content's top (106).
    expect(JSON.stringify(scrim.children)).toContain(`"gradient":[0,-1,${94 / 106},-1,1,16777215]`); // white 1 → 1 at 94/106 → 0
    // The content starts below the fade: 98 + 8.
    const content = hosts(screen.getByTestId('scr')).find((n) => typeof (StyleSheet.flatten(n.props.contentContainerStyle) as { paddingTop?: number } | undefined)?.paddingTop === 'number');
    expect(StyleSheet.flatten(content!.props.contentContainerStyle)).toMatchObject({ paddingTop: 106 });
  });

  it('HeaderScrim, light: the flat ground to the header edge with its hairline', async () => {
    await renderIn(
      'light',
      <HeaderHeightContext.Provider value={98}>
        <Screen testID="scr">
          <RNText>Content</RNText>
        </Screen>
      </HeaderHeightContext.Provider>,
    );
    expect(flat(screen.getByTestId('header-scrim', HIDDEN_OK))).toMatchObject({ top: 0, height: 98, borderBottomWidth: 1 });
  });

  /** The scroll content container, the column and the step wrappers of a Screen. */
  function screenParts() {
    const all = hosts(screen.getByTestId('scr'));
    const scroll = all.find((n) => n.props.contentContainerStyle !== undefined)!;
    const column = all.find((n) => flat(n).maxWidth === 720)!;
    const steps = (column.children.filter((c) => typeof c !== 'string') as typeof all).filter((n) => flat(n).gap !== undefined);
    return { container: StyleSheet.flatten(scroll.props.contentContainerStyle) as ViewStyle, column: flat(column), steps: steps.map(flat) };
  }

  it('Screen fill: the content grows to the viewport and the last step takes the free room', async () => {
    await renderIn(
      'dark',
      <Screen testID="scr" fill>
        <RNText>Hero</RNText>
        <RNText>Footer</RNText>
      </Screen>,
    );
    const { container, column, steps } = screenParts();
    expect(container).toMatchObject({ flexGrow: 1 });
    expect(column).toMatchObject({ flexGrow: 1 });
    expect(steps.map((st) => st.flexGrow)).toEqual([undefined, 1]);
  });

  it('Screen fill with a ScreenSpacer: only the spacer grows, pushing what follows it to the bottom', async () => {
    await renderIn(
      'dark',
      <Screen testID="scr" fill>
        <RNText>Hero</RNText>
        <ScreenSpacer minHeight={20} testID="spacer" />
        <RNText>Card</RNText>
      </Screen>,
    );
    const { steps } = screenParts();
    expect(steps.map((st) => st.flexGrow)).toEqual([undefined, 1, undefined]);
    expect(flat(screen.getByTestId('spacer'))).toMatchObject({ flexGrow: 1, minHeight: 20 });
  });

  it('Screen without fill lays out exactly as before', async () => {
    await renderIn(
      'dark',
      <Screen testID="scr">
        <RNText>Hero</RNText>
        <RNText>Footer</RNText>
      </Screen>,
    );
    const { container, column, steps } = screenParts();
    expect(container).not.toHaveProperty('flexGrow');
    expect(column).not.toHaveProperty('flexGrow');
    expect(steps.every((st) => st.flexGrow === undefined)).toBe(true);
  });

  it('Field rows: a 5-row multiline well is 138 tall (13 + 5 × 22 + 13 inside the rim); the default stays 96', async () => {
    const minHeights = (id: string) => {
      const input = screen.getByTestId(id);
      return [StyleSheet.flatten(input.parent?.props.style)?.minHeight, flat(input).minHeight];
    };
    await renderIn('dark', <Field label="Testers must accept this" value="" onChangeText={jest.fn()} multiline rows={5} testID="consent" />);
    expect(minHeights('consent')).toEqual([138, 138]);
    expect(flat(screen.getByTestId('consent'))).toMatchObject({ paddingVertical: 13, paddingHorizontal: 16, fontSize: 15, lineHeight: 22 });
    await renderIn('dark', <Field label="Notes" value="" onChangeText={jest.fn()} multiline testID="notes" />);
    expect(minHeights('notes')).toEqual([96, 96]);
    // Never below the default well, and single-line fields ignore it.
    await renderIn('dark', <Field label="Short" value="" onChangeText={jest.fn()} multiline rows={1} testID="short" />);
    expect(minHeights('short')).toEqual([96, 96]);
    await renderIn('dark', <Field label="Email" value="" onChangeText={jest.fn()} rows={5} testID="email" />);
    expect(minHeights('email')).toEqual([52, 52]);
  });

  it('clause dots: each space is tracked to exactly 0.28em of its own face', () => {
    // Instrument Sans 400: a 0.2em space + 0.08em; 600: 0.193em + 0.087em.
    expect(clauseSpaceTracking(15, fontFamilies.ui400)).toBe(1.2);
    expect(clauseSpaceTracking(16, `${fontFamilies.ui600}, 'Segoe UI', system-ui, sans-serif`)).toBe(1.39);
    // A DM Mono space is a full 0.6em cell: it is tracked in.
    expect(clauseSpaceTracking(12, fontFamilies.mono500)).toBe(-3.84);
    // Red Hat Display 400: 0.215em.
    expect(clauseSpaceTracking(20, fontFamilies.display400)).toBe(1.3);
  });

  it('the kit Text sets a written " · " as the clause dot, keeping the characters (a Screen subtitle)', async () => {
    await renderIn(
      'dark',
      <Screen title="Settings" subtitle="Demo Tester · tester" testID="scr">
        <Text testID="small" variant="small">Local build · data stays on this machine</Text>
      </Screen>,
    );
    const subtitle = screen.getByText('Demo Tester · tester');
    const tracked = subtitle.children.filter((c) => typeof c !== 'string' && flat(c).letterSpacing === 1.2);
    expect(tracked).toHaveLength(2);
    // Exactly the written characters: a plain space on both sides of the dot.
    expect(JSON.stringify(subtitle.children.map((c) => (typeof c === 'string' ? c : c.children)))).toBe(JSON.stringify(['Demo Tester', [' '], '·', [' '], 'tester']));
    const small = screen.getByTestId('small');
    expect(small.children.filter((c) => typeof c !== 'string' && flat(c).letterSpacing === 1.04)).toHaveLength(2);
    // Text without a separator is untouched.
    await renderIn('dark', <Text testID="plain">Studies that match your device</Text>);
    expect(screen.getByTestId('plain').children).toEqual(['Studies that match your device']);
  });

  /** The primary's caustic layer: the lens-blue rgba(111,155,255,…) outer glow. */
  const causticLayer = (r: Rendered) =>
    r.container.queryAll((n) => typeof n.type === 'string' && /rgba\(111,155,255/.test(String(flat(n).boxShadow ?? '')));
  const opacityOf = (n: unknown) => (getAnimatedStyle(n as never) as { opacity: number }).opacity;
  const layoutAll = async (r: Rendered) => {
    for (const n of r.container.queryAll((x) => typeof x.type === 'string' && typeof x.props.onLayout === 'function')) {
      await act(async () => (n.props.onLayout as (e: unknown) => void)({ nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 52 } } }));
    }
  };

  it('a disabled primary throws no caustic or blue glow; it returns with the light when enabled', async () => {
    const ui = (disabled: boolean) => wrapDark(<Button label="Create account" onPress={jest.fn()} disabled={disabled} testID="b" />);
    const r = await render(ui(true));
    await act(async () => {});
    await layoutAll(r);
    const [glow] = causticLayer(r);
    expect(glow).toBeTruthy();
    expect(opacityOf(glow)).toBe(0);
    await r.rerender(ui(false));
    await advance(400);
    expect(opacityOf(causticLayer(r)[0])).toBe(1);
    await r.rerender(ui(true));
    await advance(400);
    expect(opacityOf(causticLayer(r)[0])).toBe(0);
  });

  it('a disabled primary draws no caustic sweep, even one already in flight', async () => {
    const ui = (disabled: boolean) => wrapDark(<Button label="Sign in" onPress={jest.fn()} disabled={disabled} testID="b" />);
    const r = await render(ui(false));
    await act(async () => {});
    const base = count(r, SWEEP);
    await fireEvent.press(screen.getByTestId('b'));
    expect(count(r, SWEEP)).toBe(base + 1);
    await r.rerender(ui(true));
    expect(count(r, SWEEP)).toBe(base);
    // Enabled again: the S4 sweep on enable plays.
    await r.rerender(ui(false));
    await act(async () => {});
    expect(count(r, SWEEP)).toBe(base + 1);
  });
});
