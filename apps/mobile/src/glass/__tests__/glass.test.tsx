import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Animated, { getAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { ThemeProvider, useTheme, type ThemePreference } from '../../theme/ThemeProvider';
import { glassDark, glassLight } from '../../theme/tokens';
import {
  CausticSweep,
  FlutedLens,
  GlassBlur,
  GlassSurface,
  Grain,
  Ground,
  UplightFloor,
  useUplight,
  useUplightNumeralStyle,
  Well,
  type Uplight,
  type UplightGrade,
} from '..';
import { keyExposure } from '../keyLight';
import { compositeOver, roundRectPath, shadowList, splitShadows, uplitAddition } from '../paint';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const MOBILE = path.resolve(__dirname, '../../..');
const layout = (width: number, height: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height } } });

let reduced = false;
beforeEach(() => {
  // Live loops (record core, Live uplight) repeat forever; fake timers keep them from running between tests.
  jest.useFakeTimers();
  reduced = false;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(reduced));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function renderIn(scheme: ThemePreference, ui: ReactNode) {
  let setPreference: ((p: ThemePreference) => void) | undefined;
  function Scheme({ children }: { children: ReactNode }) {
    setPreference = useTheme().setPreference;
    return <>{children}</>;
  }
  const result = await render(
    <ThemeProvider fonts="system">
      <Scheme>{ui}</Scheme>
    </ThemeProvider>,
  );
  await act(async () => setPreference?.(scheme));
  return result;
}

const svgCount = (json: unknown) => (JSON.stringify(json).match(/"type":"RNSVGSvgView[A-Za-z]*"/g) ?? []).length;

describe('glass paint helpers', () => {
  it('splits shadow lists at top-level commas only', () => {
    expect(shadowList('inset 1px 1px 0 rgba(1,2,3,0.5), 4px 6px 12px -4px rgba(2,1,10,0.8)')).toEqual([
      'inset 1px 1px 0 rgba(1,2,3,0.5)',
      '4px 6px 12px -4px rgba(2,1,10,0.8)',
    ]);
    expect(shadowList(undefined)).toEqual([]);
  });

  it("moves the primary's lens-blue caustic onto its own layer", () => {
    const parts = splitShadows(glassDark.primary.shadow);
    expect(parts.caustic).toEqual(['8px 12px 26px -10px rgba(111,155,255,0.55)']);
    expect(parts.inset).toHaveLength(2);
    expect(parts.outset).toEqual(['2px 3px 6px -2px rgba(2,1,10,0.7)']);
  });

  it('derives the uplit layer as an addition: bottom rim, inner pool and spill, never a new cast shadow', () => {
    const add = uplitAddition(glassDark.uplight.card(1), glassDark.card(1));
    expect(add.fill).toHaveLength(1);
    expect(add.fill[0]).toMatchObject({ kind: 'radial', cy: 1 });
    expect(add.rim).toHaveLength(1);
    expect(add.rim[0]).toMatchObject({ kind: 'linear', angle: 0 });
    const shadows = shadowList(add.shadow);
    expect(shadows.some((s) => s.includes('2,1,10'))).toBe(false);
    expect(shadows).toContain('0 16px 34px -14px rgba(78,112,255,0.38)');
  });

  it('composites translucent overlay glass over the ground for the solid blur fallback', () => {
    expect(compositeOver('#241F52', 0.5, '#0B0A1F')).toBe('#181539');
    expect(compositeOver('#FFFFFF', 0, '#0B0A1F')).toBe('#0B0A1F');
  });

  it('rounds only the top corners for sheets', () => {
    expect(roundRectPath(0, 0, 100, 50, 10, 'top')).not.toMatch(/A10,10 0 0 1 90,50/);
    expect(roundRectPath(0, 0, 100, 50, 10)).toMatch(/A10,10 0 0 1 90,50/);
  });
});

describe('key light exposure (§2)', () => {
  const { rest, uplit, sheet } = glassDark.exposure;
  it('is 1 at rest, 0.72 while an Uplight moment is lit, 0.4 behind a sheet', () => {
    expect(keyExposure(rest, uplit, sheet, 0, 0)).toBe(1);
    expect(keyExposure(rest, uplit, sheet, 0.45, 0)).toBeCloseTo(0.72, 9);
    expect(keyExposure(rest, uplit, sheet, 1, 0)).toBeCloseTo(0.72, 9);
    expect(keyExposure(rest, uplit, sheet, 0, 1)).toBeCloseTo(0.4, 9);
    expect(keyExposure(rest, uplit, sheet, 1, 1)).toBeCloseTo(0.4, 9);
  });
});

describe('grain tile', () => {
  it('is the generator output, byte for byte (node scripts/gen-grain.mjs --check)', () => {
    const out = execFileSync(process.execPath, [path.join(MOBILE, 'scripts/gen-grain.mjs'), '--check'], { encoding: 'utf8' });
    expect(out).toContain('up to date');
    const png = readFileSync(path.join(MOBILE, 'assets/textures/grain-256.png'));
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(256);
    expect(png.readUInt32BE(20)).toBe(256);
  });
});

describe('glass primitives render (dark Lens and flat light)', () => {
  function Everything() {
    const pressed = useSharedValue(0.5);
    const caustic = useSharedValue(1);
    const light = useUplight('earned', true);
    const numeral = useUplightNumeralStyle(light);
    return (
      <Ground testID="ground">
            <GlassSurface testID="card" k={0.8} pressed={pressed} uplight={light.u}>
              <UplightFloor light={light} x={0.3} height={160} />
              <Animated.Text style={numeral}>50</Animated.Text>
            </GlassSurface>
            <GlassSurface testID="raised" level="raised" />
            <GlassSurface testID="pressed" level="pressed" />
            <GlassSurface testID="ground-level" level="ground" />
            <GlassSurface testID="primary" recipe={glassDark.primary} caustic={caustic}>
              <CausticSweep playKey={1} />
            </GlassSurface>
            <Well testID="well" />
            <Well testID="well-focus" state="focus" />
            <Well testID="well-error" state="error" />
            <Well testID="well-focus-error" state="focusError" />
            <FlutedLens testID="lens" size={104} recording>
              <Text>glyph</Text>
            </FlutedLens>
          <GlassSurface testID="overlay" level="overlay" />
          <GlassBlur testID="sheet" radius={28} corners="top" />
      </Ground>
    );
  }

  const measured = ['ground', 'card', 'raised', 'pressed', 'ground-level', 'primary', 'well', 'well-focus', 'well-error', 'well-focus-error', 'overlay', 'sheet'];

  it('draws the glass layers in dark once measured', async () => {
    const r = await renderIn('dark', <Everything />);
    const before = svgCount(r.toJSON());
    for (const id of measured) await fireEvent(screen.getByTestId(id, { includeHiddenElements: true }), 'layout', layout(320, 120));
    expect(svgCount(r.toJSON())).toBeGreaterThan(before + measured.length);
    expect(screen.getByText('50')).toBeTruthy();
    expect(screen.getByText('glyph', { includeHiddenElements: true })).toBeTruthy();
    expect(JSON.stringify(r.toJSON())).toContain('boxShadow');
  });

  it('degrades to flat token surfaces in light: no SVG glass, no grain, no blur, no Uplight', async () => {
    const r = await renderIn('light', <Everything />);
    for (const id of measured) await fireEvent(screen.getByTestId(id, { includeHiddenElements: true }), 'layout', layout(320, 120));
    const json = JSON.stringify(r.toJSON());
    expect(screen.getByTestId('lens', { includeHiddenElements: true })).toBeTruthy();
    // Only the brand lens draws SVG: 12 rib scenes at 104px plus rim, rib shading, specular, glint and core.
    expect(svgCount(r.toJSON())).toBe(12 + 5);
    expect(json).not.toContain('backdropFilter');
    expect(json).not.toContain('grain-256');
    const card = screen.getByTestId('card');
    expect(card.props.style).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: '#FFFFFF' })]));
    expect(screen.getByText('glyph', { includeHiddenElements: true })).toBeTruthy();
  });

  it('pressed, the cast layer drops to 0.6 (C5), never to 0', async () => {
    function Pressed() {
      const p = useSharedValue(1);
      return <GlassSurface testID="c" k={1} pressed={p} />;
    }
    const r = await renderIn('dark', <Pressed />);
    await fireEvent(screen.getByTestId('c'), 'layout', layout(320, 120));
    const style = (n: { props: { style?: unknown } }) => StyleSheet.flatten(n.props.style as ViewStyle) as ViewStyle & { boxShadow?: string };
    const [cast] = r.container.queryAll((n) => typeof n.type === 'string' && /rgba\(2,1,10/.test(String(style(n)?.boxShadow ?? '')));
    expect(cast).toBeTruthy();
    expect((getAnimatedStyle(cast as never) as { opacity: number }).opacity).toBeCloseTo(0.6, 5);
  });

  it('a Mode B floor is never shorter than 260 (§U)', async () => {
    function Floor() {
      const light = useUplight('pilot', true);
      return <UplightFloor light={light} height={160} />;
    }
    const r = await renderIn('dark', <Floor />);
    expect(JSON.stringify(r.toJSON())).toContain('"height":260');
  });

  it('renders Grain on Lens glass at the token opacity', async () => {
    const r = await renderIn('dark', <Grain opacity={glassDark.grain.card} />);
    expect(JSON.stringify(r.toJSON())).toContain('"opacity":0.056');
  });

  it('renders no Grain in light', async () => {
    const r = await renderIn('light', <Grain opacity={glassDark.grain.card} />);
    expect(r.toJSON()).toBeNull();
    expect(glassLight.grain.card).toBe(0);
  });
});

describe('useUplight grades (§10.4) and reduced motion (§11.7)', () => {
  async function runGrade(grade: UplightGrade, opts: { reduce: boolean; level?: number }, ms: number) {
    reduced = opts.reduce;
    let light: Uplight | undefined;
    function Probe() {
      light = useUplight(grade, true, { level: opts.level });
      return <UplightFloor light={light} />;
    }
    await renderIn('dark', <Probe />);
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
    return light!;
  }

  it('Earned rises to 1 and settles at 0.45', async () => {
    const light = await runGrade('earned', { reduce: false }, 2000);
    expect(light.u.value).toBeCloseTo(0.45, 2);
  });

  it('Commit passes and leaves, and counts one pass for the motes', async () => {
    const light = await runGrade('commit', { reduce: false }, 2000);
    expect(light.u.value).toBeCloseTo(0, 2);
    expect(light.pass).toBe(1);
  });

  it('Pilot rests at its level', async () => {
    const light = await runGrade('pilot', { reduce: false, level: 0.55 }, 1500);
    expect(light.u.value).toBeCloseTo(0.55, 2);
  });

  it('Live breathes between 0.72 and 1', async () => {
    const light = await runGrade('live', { reduce: false }, 1900);
    expect(light.u.value).toBeGreaterThanOrEqual(0.72 - 1e-6);
    expect(light.u.value).toBeLessThanOrEqual(1 + 1e-6);
  });

  it('reduced motion: resting values only, and Commit shows nothing', async () => {
    expect((await runGrade('earned', { reduce: true }, 200)).u.value).toBeCloseTo(0.45, 3);
    expect((await runGrade('live', { reduce: true }, 200)).u.value).toBeCloseTo(0.86, 3);
    const commit = await runGrade('commit', { reduce: true }, 2000);
    expect(commit.u.value).toBe(0);
    expect(commit.pass).toBe(0);
  });

  it('stays dark in the light theme', async () => {
    let light: Uplight | undefined;
    function Probe() {
      light = useUplight('earned', true);
      return <UplightFloor light={light} />;
    }
    const r = await renderIn('light', <Probe />);
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(light!.enabled).toBe(false);
    expect(light!.u.value).toBe(0);
    expect(r.toJSON()).toBeNull();
  });
});

describe('signature motions under reduced motion', () => {
  const childCount = (json: unknown) => ((json as { children?: unknown[] | null }).children ?? []).length;

  // Playing: the clipped band plus the caustic boost layer (S4: the caustic brightens with the sweep).
  it.each([
    [false, 2],
    [true, 0],
  ])('caustic sweep with reduced motion %s draws %i layers', async (reduce, bands) => {
    reduced = reduce;
    const r = await renderIn(
      'dark',
      <View testID="host">
        <CausticSweep playKey={1} />
      </View>,
    );
    expect(childCount(r.toJSON())).toBe(bands);
  });

  it('keeps the lens (and its record core) without shimmer or drift under reduced motion', async () => {
    reduced = true;
    const r = await renderIn('dark', <FlutedLens testID="lens" size={54} shimmerKey={2} recording />);
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByTestId('lens', { includeHiddenElements: true })).toBeTruthy();
    // 7 ribs at 54px, each its own scene, plus the rim, the rib shading, the specular, the glint and the core.
    expect(svgCount(r.toJSON())).toBe(7 + 5);
  });
});

describe('key light (§2, §10.1): the pool follows the brightest Uplight moment', () => {
  function Moment({ active }: { active: boolean }) {
    useUplight('earned', active, { startAtRest: true });
    return null;
  }
  const pool = () => getAnimatedStyle(screen.getByTestId('ground-pool', { includeHiddenElements: true })).opacity as number;
  const tree = (moments: boolean[]) => (
    <Ground testID="ground">
      {moments.map((active, i) => (
        <Moment key={i} active={active} />
      ))}
    </Ground>
  );

  it('a dark or unmounting moment never brightens the pool while another is lit', async () => {
    let setMoments: (m: boolean[]) => void = () => {};
    function Harness() {
      const [moments, set] = useState([true, false]);
      setMoments = set;
      return tree(moments);
    }
    await renderIn('dark', <Harness />);
    await fireEvent(screen.getByTestId('ground'), 'layout', layout(390, 844));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(pool()).toBeCloseTo(0.72, 2);
    // A dark moment leaving (a pending row unmounting, a closed sheet) keeps the lit one's dim.
    await act(async () => setMoments([true]));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(pool()).toBeCloseTo(0.72, 2);
    // The last lit moment going dark releases the key light.
    await act(async () => setMoments([false]));
    await act(async () => {
      jest.advanceTimersByTime(500);
    });
    expect(pool()).toBeCloseTo(1, 2);
  });
});
