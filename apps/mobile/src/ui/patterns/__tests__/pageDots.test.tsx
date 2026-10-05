import { fireEvent, render, screen } from '@testing-library/react-native';
import { getAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../../../theme/ThemeProvider';
import { TOUCH } from '../../../theme/tokens';
import { PageDots } from '../PageDots';

// Page dots under a pager: a 48dp button per page, the page in view current, and the pill that
// follows the scroll position.

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

function Dots({ at, current, onSelect = () => {} }: { at: number; current: number; onSelect?: (i: number) => void }) {
  const position = useSharedValue(at);
  return <PageDots count={3} current={current} position={position} onSelect={onSelect} testID="dots" dotTestID="dot" />;
}

const renderDots = (props: Parameters<typeof Dots>[0]) =>
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider fonts="system">
        <Dots {...props} />
      </ThemeProvider>
    </SafeAreaProvider>,
  );

const pillOpacity = (i: number) => (getAnimatedStyle(screen.getByTestId(`dot-${i}-pill`, { includeHiddenElements: true }) as never) as { opacity: number }).opacity;

describe('PageDots', () => {
  it('is one 48dp button per page, named for its page, with the page in view selected', async () => {
    await renderDots({ at: 1, current: 1 });
    for (const i of [0, 1, 2]) {
      const dot = screen.getByTestId(`dot-${i}`);
      expect(dot.props.accessibilityRole).toBe('button');
      expect(dot.props.accessibilityLabel).toBe(`Go to page ${i + 1} of 3`);
      expect(dot.props.accessibilityState).toMatchObject({ selected: i === 1 });
      expect(dot).toHaveStyle({ width: TOUCH, height: TOUCH });
    }
  });

  it('a dot opens its page', async () => {
    const onSelect = jest.fn();
    await renderDots({ at: 0, current: 0, onSelect });
    await fireEvent.press(screen.getByTestId('dot-2'));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('the pill follows the scroll: whole on the page in view, shared halfway between two', async () => {
    await renderDots({ at: 1, current: 1 });
    expect([pillOpacity(0), pillOpacity(1), pillOpacity(2)]).toEqual([0, 1, 0]);
    screen.unmount();
    await renderDots({ at: 1.5, current: 1 });
    expect([pillOpacity(0), pillOpacity(1), pillOpacity(2)]).toEqual([0, 0.5, 0.5]);
  });
});
