import { FACE } from '../src/icons/material';
import { dark, glassDark, glassLight, light, type GlassRecipes, type GlassSurface, type GradientStop, type Palette, type Tone } from '../src/theme/tokens';

// WCAG 2.1 relative luminance and contrast ratio.
function lum(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}
export function ratio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
}

/** Source-over compositing of `fg` at `alpha` onto opaque `bg`, as an opaque hex. */
function over(fg: string, alpha: number, bg: string): string {
  const a = parseInt(fg.slice(1), 16);
  const b = parseInt(bg.slice(1), 16);
  const mix = (shift: number) => Math.round(((a >> shift) & 255) * alpha + ((b >> shift) & 255) * (1 - alpha));
  return `#${[16, 8, 0].map((sh) => mix(sh).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

const TEXT_PAIRS: [keyof Palette, keyof Palette][] = [
  ['text', 'background'],
  ['text', 'surface'],
  ['text', 'surfaceAlt'],
  ['textMuted', 'background'],
  ['textMuted', 'surface'],
  ['textMuted', 'surfaceAlt'],
  ['onPrimary', 'primary'],
  ['primary', 'surface'],
  ['primary', 'background'],
  ['danger', 'surface'],
  ['success', 'successBg'],
  ['warning', 'warningBg'],
  ['danger', 'dangerBg'],
  ['info', 'infoBg'],
  ['textMuted', 'neutralBg'],
  ['text', 'successBg'],
  ['text', 'warningBg'],
  ['text', 'dangerBg'],
  ['text', 'infoBg'],
  // Lens pairs.
  ['neutral', 'neutralBg'], // neutral status pill
  ['danger', 'background'], // field error label and helper
  ['primary', 'surfaceAlt'], // ghost action on raised glass
  ['primary', 'glassViolet'], // active tab label
  ['text', 'glassViolet'], // selected segment label
  ['text', 'well'], // input text
  ['textMuted', 'well'], // reward caption in its well
  ['numeral', 'well'], // reward numerals
  ['textFaint', 'well'], // placeholder in an input well
  ['textFaint', 'surface'],
  ['textDim', 'surface'], // a dimmed list-row title
  ['textDisabled', 'disabledBg'], // disabled primary label
  ['violet', 'surface'], // section numerals
  ['text', 'ink'], // pressed floors
  ['textMuted', 'ink'],
];
const UI_PAIRS: [keyof Palette, keyof Palette][] = [
  ['borderStrong', 'surface'],
  ['borderStrong', 'background'],
  ['primary', 'surface'],
  ['danger', 'surface'],
  // Lens pairs.
  ['borderStrong', 'well'], // well rim at rest (near wall)
  ['lensBlue', 'surface'], // focus ring
  ['lensBlue', 'background'],
  ['primary', 'background'], // checkbox glass on the ground
];

describe.each([
  ['light', light],
  ['dark', dark],
])('%s theme contrast', (_name, p) => {
  it.each(TEXT_PAIRS)('%s on %s ≥ 4.5:1', (fg, bg) => {
    expect(ratio(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5);
  });
  it.each(UI_PAIRS)('%s on %s ≥ 3:1 (non-text UI)', (fg, bg) => {
    expect(ratio(p[fg], p[bg])).toBeGreaterThanOrEqual(3);
  });
});

// Glass surfaces are gradients: text must clear 4.5:1 on every opaque stop of the body fill
// (the lowest fill layer). Corner blooms are decorative light that card padding keeps text off.
function bodyStops(surface: GlassSurface): string[] {
  const body = surface.fill[0]!;
  return body.stops.filter((st) => st.opacity === 1).map((st) => st.color);
}
// An uplit surface lists its pool last; text near the bottom sits over the pool at its peak,
// composited onto the body's last (bottom-right) stop. Text never sits over the source core.
function uplitStops(surface: GlassSurface): string[] {
  const body = bodyStops(surface);
  if (surface.fill.length < 2) return body;
  const pool = surface.fill[surface.fill.length - 1]!.stops[0]!;
  return [...body, over(pool.color, pool.opacity, body[body.length - 1]!)];
}
// The overlay (tab bar, sheets) is translucent: measure each stop composited onto the ground.
function overlayStops(g: GlassRecipes, p: Palette): string[] {
  return g.overlay.fill[0]!.stops.map((st) => over(st.color, st.opacity, p.background));
}

const TONES: Tone[] = ['success', 'warning', 'danger', 'info', 'neutral'];
type Case = [string, (keyof Palette)[], string[]];
function glassCases(g: GlassRecipes, p: Palette): Case[] {
  const cases: Case[] = [
    ['card(1)', ['text', 'textMuted', 'primary', 'success', 'danger'], bodyStops(g.card(1))],
    ['card(0.64)', ['text', 'textMuted', 'textDim'], bodyStops(g.card(0.64))],
    ['cardPressed', ['text', 'textMuted'], bodyStops(g.cardPressed)],
    ['raised', ['text', 'textMuted', 'primary'], bodyStops(g.raised)],
    ['violetTile', ['text', 'primary'], bodyStops(g.violetTile)],
    ['overlay', ['text', 'textMuted', 'primary'], overlayStops(g, p)],
    ['well', ['text', 'textMuted', 'numeral', 'textFaint'], bodyStops(g.well)],
    ['wellError', ['text', 'textFaint'], g.wellError.fill[0]!.stops.map((st) => st.color)],
    ['wellDark', ['text', 'textMuted', 'neutral'], bodyStops(g.wellDark)],
    ['primary', ['onPrimary'], bodyStops(g.primary)],
    ['primaryPressed', ['onPrimary'], bodyStops(g.primaryPressed)],
    ['primaryDisabled', ['textDisabled'], bodyStops(g.primaryDisabled)],
    ['secondary', ['text'], bodyStops(g.secondary)],
    ['secondaryPressed', ['text'], bodyStops(g.secondaryPressed)],
    ['destructive', ['danger'], bodyStops(g.destructive)],
    ['uplight.card(1)', ['text', 'textMuted'], uplitStops(g.uplight.card(1))],
  ];
  for (const tone of TONES) {
    const fg: keyof Palette = tone;
    cases.push([`pill(${tone})`, [fg], bodyStops(g.pill(tone))]);
    cases.push([`notice(${tone})`, [fg, 'textMuted'], bodyStops(g.notice(tone))]);
    cases.push([`uplight.notice(${tone})`, [fg, 'textMuted'], uplitStops(g.uplight.notice(tone))]);
  }
  return cases;
}

describe.each([
  ['light', light, glassLight],
  ['dark', dark, glassDark],
])('%s glass recipe contrast', (_name, p, g) => {
  const rows = glassCases(g, p).flatMap(([surface, fgs, bgs]) => fgs.flatMap((fg) => bgs.map((bg) => [surface, fg, bg] as const)));
  it.each(rows)('%s: %s on %s ≥ 4.5:1', (_surface, fg, bg) => {
    expect(ratio(p[fg], bg)).toBeGreaterThanOrEqual(4.5);
  });
});

// The badge medallion (reputation-layer.md §4, Appendix A), dark: its glyph and its progress arc
// are non-text UI, so each clears 3:1 against the glass behind it, every opaque stop against every
// opaque stop. Light draws it flat from palette pairs already above (primary and textMuted on
// surface and surfaceAlt).
describe('dark medallion contrast (non-text UI ≥ 3:1)', () => {
  const m = glassDark.medal;
  const opaque = (stops: readonly GradientStop[]) => stops.filter((st) => st.opacity === 1).map((st) => st.color);
  const pairs = (fgs: string[], bgs: string[]) => fgs.flatMap((fg) => bgs.map((bg) => [fg, bg] as const));
  it.each(pairs(opaque(FACE.lit), opaque(m.lit.face[0]!.stops)))('the lit glyph %s on the lit face %s', (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3);
  });
  // The locked glyph is drawn at 0.8 over its face.
  it.each(pairs(opaque(FACE.muted), opaque(m.unlit.face[0]!.stops)))('the muted glyph %s (at 0.8) on the unlit face %s', (fg, bg) => {
    expect(ratio(over(fg, 0.8, bg), bg)).toBeGreaterThanOrEqual(3);
  });
  it.each(pairs(opaque(m.arc.fill.stops), opaque(m.socket.floor[0]!.stops)))('the arc %s on the socket floor %s', (fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3);
  });
});

describe('light press feedback (no Lens layers)', () => {
  it('the pressed primary is a visibly darker fill, still ≥ 4.5:1 for onPrimary', () => {
    const rest = glassLight.primary.fill[0]!.stops[0]!.color;
    const pressed = glassLight.primaryPressed.fill[0]!.stops[0]!.color;
    expect(pressed).not.toBe(rest);
    expect(ratio(light.onPrimary, pressed)).toBeGreaterThan(ratio(light.onPrimary, rest));
    expect(ratio(light.onPrimary, pressed)).toBeGreaterThanOrEqual(4.5);
  });
});
