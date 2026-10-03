import { act, render } from '@testing-library/react-native';
import { AccessibilityInfo, Text } from 'react-native';
import { Easing, ReduceMotion } from 'react-native-reanimated';
import { cssLinearVector } from '../src/theme/gradient';
import { CYCLE, DUR, EASE, FULL_MOTION, REDUCED_MOTION, SPRING, STAGGER, UPLIGHT, useMotion, type Motion } from '../src/theme/motion';
import { ThemeProvider, useTheme } from '../src/theme/ThemeProvider';
import { glassDark, glassLight } from '../src/theme/tokens';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

describe('motion tokens (Direction A §11)', () => {
  it('match the spec values', () => {
    expect(EASE).toEqual({
      lens: [0.22, 1, 0.36, 1],
      press: [0.2, 0, 0.4, 1],
      release: [0.3, 1.5, 0.5, 1],
      exit: [0.5, 0, 0.75, 0],
      refract: [0.65, 0, 0.35, 1],
      uplight: [0.12, 0.8, 0.28, 1],
      roll: [0.2, 0.85, 0.25, 1.06],
      breathe: [0.37, 0, 0.63, 1],
    });
    expect(DUR).toEqual({ tick: 120, release: 180, swap: 240, enter: 320, sheet: 420, rise: 560, settle: 700 });
    expect(CYCLE).toEqual({ breathe: 1400, drift: 5600, spin: 800, spinReduced: 1600 });
    // Round 4: near-critical springs (no tile overshoot, no sheet bounce).
    expect(SPRING.tab).toEqual({ damping: 30, stiffness: 300, mass: 1 });
    expect(SPRING.sheet).toEqual({ damping: 32, stiffness: 300, mass: 1 });
    for (const sp of [SPRING.tab, SPRING.sheet]) expect(sp.damping / (2 * Math.sqrt(sp.stiffness * sp.mass))).toBeGreaterThan(0.85);
    // No segment is longer than dur-settle (§11.1), motes included.
    expect(UPLIGHT.moteDuration).toBe(DUR.settle);
    expect(UPLIGHT.commit.rise + UPLIGHT.commit.hold + UPLIGHT.commit.fall).toBe(1380);
  });

  it('every segment stays within tick..settle', () => {
    for (const config of Object.values(FULL_MOTION.timing)) {
      expect(config.duration).toBeGreaterThanOrEqual(DUR.tick);
      expect(config.duration).toBeLessThanOrEqual(DUR.settle);
    }
  });

  it('the release curve overshoots and the exit curve never does', () => {
    const release = Easing.bezierFn(...EASE.release);
    const exit = Easing.bezierFn(...EASE.exit);
    const samples = Array.from({ length: 99 }, (_, i) => (i + 1) / 100);
    expect(Math.max(...samples.map(release))).toBeGreaterThan(1);
    expect(Math.max(...samples.map(exit))).toBeLessThanOrEqual(1);
  });

  it('staggers content 40ms apart from 80ms, capped at the fifth step', () => {
    const d = FULL_MOTION.entrance.delay;
    expect([0, 1, 2, 3, 4, 5, 12].map(d)).toEqual([80, 120, 160, 200, 240, 240, 240]);
    expect(STAGGER.maxSteps).toBe(5);
  });

  it('opts every config out of Reanimated reduce-motion, because the policy is already resolved', () => {
    for (const m of [FULL_MOTION, REDUCED_MOTION]) {
      for (const config of Object.values(m.timing)) expect(config.reduceMotion).toBe(ReduceMotion.Never);
    }
    expect(FULL_MOTION.spring.tab?.reduceMotion).toBe(ReduceMotion.Never);
  });

  it('reduced motion keeps meaning and drops movement (§11.7)', () => {
    const r = REDUCED_MOTION;
    expect(r.entrance).toMatchObject({ duration: 120, rise: 0, headerRise: 0, subtitleDelay: 0 });
    expect([0, 3, 9].map(r.entrance.delay)).toEqual([0, 0, 0]);
    expect(r.timing.enter.duration).toBe(120);
    expect(r.timing.sheetOpen.duration).toBe(120);
    expect(r.press.translate).toBe(0);
    expect(r.spring).toEqual({ tab: null, sheet: null });
    expect(Object.values(r.play).every((on) => !on)).toBe(true);
    expect(r.liveSteady).toBe(0.9);
    expect(r.uplightLiveSteady).toBe(0.86);
    expect(FULL_MOTION.liveSteady).toBeNull();
    expect(Object.values(FULL_MOTION.play).every(Boolean)).toBe(true);
  });
});

describe('useMotion and ThemeProvider', () => {
  let listener: ((v: boolean) => void) | undefined;
  beforeEach(() => {
    listener = undefined;
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
    jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((_event: string, cb: (v: boolean) => void) => {
      listener = cb;
      return { remove: jest.fn() };
    }) as unknown as typeof AccessibilityInfo.addEventListener);
  });
  afterEach(() => jest.restoreAllMocks());

  it('follows the OS setting without a provider', async () => {
    let seen: Motion | undefined;
    function Probe() {
      seen = useMotion();
      return null;
    }
    await render(<Probe />);
    expect(seen).toBe(FULL_MOTION);
    await act(async () => listener?.(true));
    expect(seen).toBe(REDUCED_MOTION);
  });

  it('exposes palette, type, motion and glass through useTheme without changing its existing API', async () => {
    let theme: ReturnType<typeof useTheme> | undefined;
    let fromHook: Motion | undefined;
    function Probe() {
      theme = useTheme();
      fromHook = useMotion();
      return <Text>probe</Text>;
    }
    await render(
      <ThemeProvider fonts="system">
        <Probe />
      </ThemeProvider>,
    );
    expect(theme).toMatchObject({ scheme: expect.any(String), preference: 'system' });
    expect(typeof theme!.setPreference).toBe('function');
    expect(theme!.colors.background).toBeDefined();
    expect(theme!.motion).toBe(FULL_MOTION);
    expect(fromHook).toBe(theme!.motion);
    // A failed font load keeps hierarchy on the platform font.
    expect(theme!.type.heading).toMatchObject({ fontWeight: '600', fontSize: 16 });
    expect(theme!.type.heading.fontFamily).toBeUndefined();
    expect([glassDark, glassLight]).toContain(theme!.glass);
    await act(async () => listener?.(true));
    expect(theme!.motion).toBe(REDUCED_MOTION);
    expect(fromHook).toBe(REDUCED_MOTION);
  });

  it('switches glass recipes with the scheme', async () => {
    let theme: ReturnType<typeof useTheme> | undefined;
    function Probe() {
      theme = useTheme();
      return null;
    }
    await render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await act(async () => theme!.setPreference('dark'));
    expect(theme!.glass).toBe(glassDark);
    expect(theme!.type.heading.fontFamily).toBe('InstrumentSans_600SemiBold');
    expect(theme!.type.heading.fontWeight).toBeUndefined();
    await act(async () => theme!.setPreference('light'));
    expect(theme!.glass).toBe(glassLight);
    expect(glassLight.enabled).toBe(false);
  });
});

describe('glass geometry', () => {
  it('maps CSS gradient angles to SVG vectors whose corners reach 0% and 100%', () => {
    const down = cssLinearVector(180, 100, 40);
    [down.x1, down.y1, down.x2, down.y2].forEach((n, i) => expect(n).toBeCloseTo([50, 0, 50, 40][i]!, 9));
    // 135deg on a wide card: the top-left corner projects to 0% and the bottom-right to 100%.
    const v = cssLinearVector(135, 200, 100);
    const len = Math.hypot(v.x2 - v.x1, v.y2 - v.y1);
    const at = (x: number, y: number) => ((x - v.x1) * (v.x2 - v.x1) + (y - v.y1) * (v.y2 - v.y1)) / (len * len);
    expect(at(0, 0)).toBeCloseTo(0, 9);
    expect(at(200, 100)).toBeCloseTo(1, 9);
  });

  it('keeps flute ribs 7–10px wide at the spec anchors', () => {
    expect([54, 104, 220].map(glassDark.flute.ribs)).toEqual([7, 12, 22]);
    for (const size of [40, 72, 160, 300]) {
      const w = size / glassDark.flute.ribs(size);
      expect(w).toBeGreaterThanOrEqual(6.5);
      expect(w).toBeLessThanOrEqual(10.5);
    }
  });

  it('scales the L1 card light with distance (cardK)', () => {
    const far = glassDark.card(0.64);
    expect(far.rim[0]!.stops[0]!.opacity).toBe(0.32);
    expect(far.shadow).toContain('rgba(214,224,255,0.045)');
  });
});
