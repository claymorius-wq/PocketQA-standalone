import { act, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { AccessibilityInfo, AppState, Text as RNText } from 'react-native';
import { getAnimatedStyle } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { GlideList } from '../../ui/patterns/GlideList';
import { Enter } from '../../ui/screen';

// Emulator, 2026-10-05: a recording that the system stopped while the tester was in another app
// (a phone call took the microphone) came back with its clip row and its "Recording stopped" notice
// laid out but invisible. Both had been added while Pocket QA was in the background, so their
// entrance (opacity 0 → 1 on Reanimated) started with no frames running, and stayed at 0. Nobody
// can see an entrance that starts in the background, so it renders settled.

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const wrap = (ui: ReactNode) => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <ThemeProvider fonts="system">{ui}</ThemeProvider>
  </SafeAreaProvider>
);
let restore: (() => void) | null = null;
const appStateIs = (st: 'active' | 'background' | 'inactive') => {
  const original = Object.getOwnPropertyDescriptor(AppState, 'currentState')!;
  Object.defineProperty(AppState, 'currentState', { configurable: true, get: () => st });
  restore = () => Object.defineProperty(AppState, 'currentState', original);
};
/** The animated wrapper an entrance puts around its child: the child's host parent. */
const opacityAround = (text: string) => {
  const host = screen.getByText(text, { includeHiddenElements: true }).parent;
  return (getAnimatedStyle(host as Parameters<typeof getAnimatedStyle>[0]) as { opacity?: number }).opacity;
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
});
afterEach(() => {
  restore?.();
  restore = null;
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const list = (keys: string[]) =>
  wrap(
    <GlideList>
      {keys.map((k) => (
        <RNText key={k}>{k}</RNText>
      ))}
    </GlideList>,
  );

describe('entrances that start while the app is in the background', () => {
  it('foreground (control): an item added to a GlideList fades in', async () => {
    appStateIs('active');
    const { rerender } = await render(list(['a']));
    await rerender(list(['a', 'b']));
    expect(opacityAround('b')).toBe(0);
  });

  it.each(['background', 'inactive'] as const)('%s: an item added to a GlideList is visible at once (no entrance)', async (st) => {
    const { rerender } = await render(list(['a']));
    appStateIs(st);
    await rerender(list(['a', 'b']));
    expect(opacityAround('b')).toBe(1);
  });

  it('foreground (control): Enter rises in', async () => {
    appStateIs('active');
    await render(wrap(<Enter step={0} delay={0}><RNText>late notice</RNText></Enter>));
    expect(opacityAround('late notice')).toBe(0);
  });

  it('background: Enter renders settled', async () => {
    appStateIs('background');
    await render(wrap(<Enter step={0} delay={0}><RNText>late notice</RNText></Enter>));
    await act(async () => {});
    expect(opacityAround('late notice')).toBe(1);
  });
});
