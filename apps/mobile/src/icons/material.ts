import type { GradientStop, Palette } from '../theme/tokens';

// The glyph light model (spec §7.3, the numbers in lens-glyphs.mjs). Coordinates are glyph units
// on the 32-unit grid. Light comes from the upper left, matching the screen key light, so every
// offset below points down-right. These are dark-theme (Lens) values; light renders a flat
// silhouette in palette colours (see `flatGlyphColor`).

export type GlyphVariant = 'face' | 'lit' | 'muted' | 'rose';

const s = (offset: number, color: string, opacity = 1): GradientStop => ({ offset, color, opacity });

/** One blurred cast shadow under the whole glyph. */
export const CAST = { dx: 2.2, dy: 3.1, blur: 1.9, color: '#020109', opacity: 0.8, mutedOpacity: 0.5 } as const;

/** Extrusion sides per part, back to front: offset and side colour (face / muted). */
export const EXTRUSION = [
  { dx: 1.65, dy: 2.25, color: '#211A55', muted: '#1A1640' },
  { dx: 1.1, dy: 1.5, color: '#2E2573', muted: '#211C4E' },
  { dx: 0.55, dy: 0.75, color: '#43389A', muted: '#2C2660' },
] as const;

/** Face paints: a 135° userSpace gradient across the grid. */
export const FACE_VECTOR = { x1: 5, y1: 4, x2: 27, y2: 28 } as const;
export const FACE: Record<GlyphVariant, GradientStop[]> = {
  face: [s(0, '#FFFFFF'), s(0.42, '#ECE8FF'), s(1, '#A99FEA')],
  lit: [s(0, '#FFFFFF'), s(0.4, '#DFE8FF'), s(1, '#90A9FF')],
  muted: [s(0, '#D6D1F0'), s(1, '#8A83B8')],
  rose: [s(0, '#FFFFFF'), s(0.45, '#F8E6F7'), s(1, '#C99BE4')],
};

/** Specular sheen on every face (not muted, not the hot core). */
export const SHEEN = { cx: 9, cy: 8, r: 13, stops: [s(0, '#FFFFFF', 0.75), s(0.5, '#FFFFFF', 0.18), s(1, '#FFFFFF', 0)] } as const;
/** The pink-lavender core of danger glyphs (variant `rose`). */
export const ROSE_CORE = { cx: 17, cy: 17.5, r: 9, stops: [s(0, '#F6B6E0', 0.55), s(1, '#F6B6E0', 0)] } as const;

/**
 * Inner bevel: the lit crescent is the part minus itself shifted (dx, dy); the shaded crescent is
 * the part minus itself shifted (−dx, −dy).
 */
export const BEVEL = {
  dx: 1,
  dy: 1.25,
  highlight: { x1: 4, y1: 4, x2: 27, y2: 28, stops: [s(0, '#FFFFFF', 1), s(0.5, '#FFFFFF', 0.55), s(1, '#FFFFFF', 0.14)] },
  highlightOpacity: 0.75,
  highlightOpacityMuted: 0.45,
  shade: '#2E2573',
  shadeMuted: '#1E1A44',
  shadeOpacity: 0.55,
} as const;

/** Record core: lit from inside (stops = theme glass.recordCore.face), plus a blurred glow. */
export const HOT = { cx: 15, cy: 15, r: 6.5, glowOpacity: 0.85, glowBlur: 2.4 } as const;

/**
 * Native stand-in for a Gaussian blur of deviation σ: the silhouette dilated by r·σ and painted at
 * alpha a, stacked. Source-over of the layers gives 1 − Π(1 − a) for each band, which matches the
 * blurred edge of a 4-unit tube (σ 1.9: ~0.75 inside, then 0.40 / 0.22 / 0.09 in 1-unit bands).
 */
export const SOFT_LAYERS = [
  { r: 0, alpha: 0.586 },
  { r: 0.53, alpha: 0.231 },
  { r: 1.05, alpha: 0.134 },
  { r: 1.58, alpha: 0.094 },
] as const;

/**
 * Canvas padding (grid units) around the 32-unit glyph so the cast shadow and glow are not cut by
 * the native view bounds (RN clips SVG content to the view).
 */
export const GLYPH_PAD = 6;

/**
 * Light theme: a flat silhouette in the palette colour that matched the pre-Lens Lucide icon.
 * TODO(light-lens): the light Lens theme will define its own glyph material.
 */
export function flatGlyphColor(colors: Palette, variant: GlyphVariant): string {
  if (variant === 'lit') return colors.primary;
  if (variant === 'muted') return colors.textMuted;
  if (variant === 'rose') return colors.danger;
  return colors.text;
}
