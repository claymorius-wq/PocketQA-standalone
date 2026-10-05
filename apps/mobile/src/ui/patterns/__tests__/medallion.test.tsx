import { act, render, screen } from '@testing-library/react-native';
import { useEffect, type ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme, type ThemePreference } from '../../../theme/ThemeProvider';
import { arcPath, MEDAL_SIZES, medalGeometry, Medallion } from '../Medallion';

// The badge medallion (docs/design/reputation-layer.md §4): the spec's geometry at its four sizes,
// the progress arc, one label or none, and the flat light drawing.

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
function Scheme({ scheme, children }: { scheme: ThemePreference; children: ReactNode }) {
  const { setPreference } = useTheme();
  useEffect(() => setPreference(scheme), [scheme, setPreference]);
  return <>{children}</>;
}
async function renderIn(scheme: ThemePreference, ui: ReactNode) {
  const r = await render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider fonts="system">
        <Scheme scheme={scheme}>{ui}</Scheme>
      </ThemeProvider>
    </SafeAreaProvider>,
  );
  await act(async () => {});
  return r;
}

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };
function all(node: Node | Node[] | null, type: string, out: Node[] = []): Node[] {
  if (!node) return out;
  if (Array.isArray(node)) {
    for (const n of node) all(n, type, out);
    return out;
  }
  if (node.type === type) out.push(node);
  for (const c of node.children ?? []) if (typeof c !== 'string') all(c, type, out);
  return out;
}

describe('Medallion geometry (the spec’s table)', () => {
  it('row 40, shelf 56, hero 96 and sheet 120', () => {
    const pick = (S: number) => {
      const g = medalGeometry(S);
      return [g.gap, g.body, g.bezel, g.face, g.glyph, g.track];
    };
    expect(MEDAL_SIZES).toEqual({ row: 40, shelf: 56, hero: 96, sheet: 120 });
    expect(pick(40)).toEqual([3, 34, 3, 28, 19, 2]);
    expect(pick(56)).toEqual([4, 48, 4, 40, 27, 2]);
    expect(pick(96)).toEqual([7, 82, 7, 68, 46, 4]);
    expect(pick(120)).toEqual([8, 104, 9, 86, 58, 4]);
  });

  it('the arc starts at 12 o’clock and runs clockwise; a whole turn is a closed ring', () => {
    expect(arcPath(50, 40, 0.25)).toBe('M50 10A40 40 0 0 1 90 50');
    expect(arcPath(50, 40, 0.5)).toBe('M50 10A40 40 0 0 1 50 90');
    expect(arcPath(50, 40, 0.75)).toBe('M50 10A40 40 0 1 1 10 50');
    expect(arcPath(50, 40, 1)).toBe('M50 10A40 40 0 1 1 50 90A40 40 0 1 1 50 10');
    expect(arcPath(50, 40, 7)).toBe(arcPath(50, 40, 1));
  });
});

describe('Medallion', () => {
  it('with a label it is one image for assistive tech; without one it is hidden', async () => {
    await renderIn(
      'dark',
      <>
        <Medallion glyph="accepted" state="earned" label="First accepted test, earned" testID="a" />
        <Medallion glyph="helpful" state="locked" progress={1 / 3} testID="b" />
      </>,
    );
    const a = screen.getByTestId('a');
    expect(a.props.accessibilityRole).toBe('image');
    expect(screen.getByLabelText('First accepted test, earned')).toBe(a);
    expect(screen.queryByTestId('b')).toBeNull();
    expect(screen.getByTestId('b', { includeHiddenElements: true }).props['aria-hidden']).toBe(true);
  });

  it('locked: the count’s arc in the gap and the glass sunk into its socket; earned: lit, no arc', async () => {
    await renderIn(
      'dark',
      <>
        <Medallion glyph="helpful" state="locked" progress={1 / 3} testID="locked" />
        <Medallion glyph="accepted" state="earned" testID="earned" />
      </>,
    );
    const HIDDEN_OK = { includeHiddenElements: true };
    // The arc is the only path a medallion draws that starts at 12 o'clock in its gap.
    const arcs = (id: string) => screen.getByTestId(id, HIDDEN_OK).queryAll((n) => n.type === 'RNSVGPath' && String(n.props.d).startsWith('M28 2'));
    expect(arcs('locked')).toHaveLength(1);
    expect(arcs('earned')).toHaveLength(0);
    const sunk = (id: string) => screen.getByTestId(id, HIDDEN_OK).queryAll((n) => n.type === 'View' && JSON.stringify(n.props.style ?? '').includes('translateY'));
    expect(sunk('locked').length).toBeGreaterThan(0);
    expect(sunk('earned')).toHaveLength(0);
  });

  it('light draws it flat: no gradients, the arc in primary', async () => {
    const r = await renderIn('light', <Medallion glyph="helpful" state="locked" progress={0.5} testID="m" />);
    const tree = r.toJSON() as unknown as Node;
    expect(all(tree, 'RNSVGLinearGradient')).toHaveLength(0);
    expect(all(tree, 'RNSVGRadialGradient')).toHaveLength(0);
    expect(all(tree, 'RNSVGPath').some((p) => p.props.d === arcPath(28, 26, 0.5))).toBe(true);
  });
});
