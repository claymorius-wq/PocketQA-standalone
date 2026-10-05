import { glassDark } from '../../theme/tokens';
import { fluteTravel } from '../FlutedLens';

// The fluted lens's scene drift (the intro carries the brand lens and drifts its scene): at the
// travel limit every rib still samples inside the padded scene, a little further and one doesn't,
// and the 104 brand lens leaves S1's 16 of slide untouched.

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const f = glassDark.flute;

/** The scene span each rib samples (lens coordinates) when the scene has moved by `shift`. */
function samples(S: number, n: number, shift: number) {
  const w = S / n;
  return Array.from({ length: n }, (_, i) => {
    const c = (i + 0.5) * w;
    const off = f.k * (c - S / 2);
    return [c + off - w / (2 * f.m) - shift, c + off + w / (2 * f.m) - shift] as const;
  });
}
const inside = (S: number, pad: number, spans: readonly (readonly [number, number])[]) => spans.every(([a, b]) => a >= -pad - 1e-9 && b <= S + pad + 1e-9);

describe('fluteTravel', () => {
  it.each([
    [104, f.ribs(104)],
    [54, f.ribs(54)],
    [220, f.ribs(220)],
  ])('at %i (%i ribs) the limit is exactly where a rib would sample past the scene', (S, n) => {
    const pad = Math.round(S * f.pad);
    const t = fluteTravel(S, n, f, pad);
    expect(inside(S, pad, samples(S, n, t))).toBe(true);
    expect(inside(S, pad, samples(S, n, -t))).toBe(true);
    expect(inside(S, pad, samples(S, n, t + 0.5))).toBe(false);
    expect(inside(S, pad, samples(S, n, -t - 0.5))).toBe(false);
  });

  it('the 104 brand lens can drift about 20, more than the 16 S1 slides', () => {
    expect(f.ribs(104)).toBe(12);
    expect(fluteTravel(104, 12, f, Math.round(104 * f.pad))).toBeCloseTo(19.99, 1);
  });
});
