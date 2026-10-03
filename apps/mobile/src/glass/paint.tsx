import { useId } from 'react';
import type { ViewStyle } from 'react-native';
import { LinearGradient, RadialGradient, Stop } from 'react-native-svg';
import { cssLinearVector, cssRadialGeometry } from '../theme/gradient';
import type { GlassSurface as GlassRecipe, GradientSpec } from '../theme/tokens';

// Shared drawing helpers for the glass primitives. Recipes come from src/theme/tokens.ts as data;
// these turn them into react-native-svg paint servers, rounded-rect paths and RN boxShadow lists.

export type Box = { x: number; y: number; w: number; h: number };
export type Corners = 'all' | 'top';

/**
 * A document-unique SVG id. On web every inline <svg> shares one id namespace, and our gradients
 * are userSpaceOnUse (sized to their own box), so a collision would paint with another surface's
 * geometry.
 */
export function useSvgId(prefix: string): string {
  return `${prefix}${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
}

/** One recipe gradient as an SVG paint server laid over `box` with CSS geometry. */
export function GradientDef({ id, spec, box }: { id: string; spec: GradientSpec; box: Box }) {
  const stops = spec.stops.map((s, i) => <Stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />);
  if (spec.kind === 'linear') {
    const v = cssLinearVector(spec.angle, box.w, box.h);
    return (
      <LinearGradient id={id} gradientUnits="userSpaceOnUse" x1={box.x + v.x1} y1={box.y + v.y1} x2={box.x + v.x2} y2={box.y + v.y2}>
        {stops}
      </LinearGradient>
    );
  }
  const g = cssRadialGeometry(spec, box.w, box.h);
  // SVG radialGradient has one radius; an elliptical CSS gradient is a unit circle scaled by
  // (rx, ry). The string transform is understood by native react-native-svg and by browsers.
  return (
    <RadialGradient
      id={id}
      gradientUnits="userSpaceOnUse"
      cx={0}
      cy={0}
      r={1}
      gradientTransform={`translate(${box.x + g.cx} ${box.y + g.cy}) scale(${Math.max(g.rx, 0.001)} ${Math.max(g.ry, 0.001)})`}
    >
      {stops}
    </RadialGradient>
  );
}

/** A rounded-rect path; `top` rounds only the top corners (sheets). */
export function roundRectPath(x: number, y: number, w: number, h: number, r: number, corners: Corners = 'all'): string {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  const rb = corners === 'all' ? rr : 0;
  return [
    `M${x + rr},${y}`,
    `H${x + w - rr}`,
    rr ? `A${rr},${rr} 0 0 1 ${x + w},${y + rr}` : '',
    `V${y + h - rb}`,
    rb ? `A${rb},${rb} 0 0 1 ${x + w - rb},${y + h}` : '',
    `H${x + rb}`,
    rb ? `A${rb},${rb} 0 0 1 ${x},${y + h - rb}` : '',
    `V${y + rr}`,
    rr ? `A${rr},${rr} 0 0 1 ${x + rr},${y}` : '',
    'Z',
  ].join('');
}

export function cornerStyle(r: number, corners: Corners = 'all'): ViewStyle {
  return corners === 'all' ? { borderRadius: r } : { borderTopLeftRadius: r, borderTopRightRadius: r };
}

/** Split a CSS box-shadow list at top-level commas (rgba() has commas of its own). */
export function shadowList(list: string | undefined): string[] {
  if (!list) return [];
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) {
      out.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = list.slice(start).trim();
  if (last) out.push(last);
  return out;
}

// The caustic is the one coloured cast shadow (lens-blue under primary glass, §2). It is drawn on
// its own layer so its opacity can animate (entrance arrives last, press shrinks it) without
// touching the other shadows.
const CAUSTIC = /rgba\(\s*111\s*,\s*155\s*,\s*255\s*,/;
const CAST = /rgba\(\s*2\s*,\s*1\s*,\s*10\s*,/;

export type ShadowParts = { outset: string[]; inset: string[]; caustic: string[] };

// Recipes are a small fixed set of strings, so a surface's per-render split is a lookup.
const SPLIT_CACHE = new Map<string, ShadowParts>();
const SPLIT_CACHE_MAX = 256;
const NO_SHADOWS: ShadowParts = { outset: [], inset: [], caustic: [] };

/** Splits a shadow list into outset casts, insets and the caustic. Cached: treat the result as read-only. */
export function splitShadows(list: string | undefined): ShadowParts {
  if (!list) return NO_SHADOWS;
  const hit = SPLIT_CACHE.get(list);
  if (hit) return hit;
  const parts: ShadowParts = { outset: [], inset: [], caustic: [] };
  for (const s of shadowList(list)) {
    if (s.startsWith('inset')) parts.inset.push(s);
    else if (CAUSTIC.test(s)) parts.caustic.push(s);
    else parts.outset.push(s);
  }
  if (SPLIT_CACHE.size >= SPLIT_CACHE_MAX) SPLIT_CACHE.clear();
  SPLIT_CACHE.set(list, parts);
  return parts;
}

export const isCastShadow = (s: string) => CAST.test(s);
export const joinShadows = (list: string[]) => (list.length ? list.join(', ') : undefined);

/** The spec's default caustic under lit glass (primary recipe, §8). */
export const DEFAULT_CAUSTIC = '8px 12px 26px -10px rgba(111,155,255,0.55)';

/**
 * What an uplit recipe adds over its base: the layers and shadows the base does not have, minus
 * new cast shadows (the base's cast is dimmed to 70% instead, so the shadow keeps its direction).
 */
export function uplitAddition(lit: GlassRecipe, base: GlassRecipe): GlassRecipe {
  const has = (list: unknown[], item: unknown) => list.some((x) => JSON.stringify(x) === JSON.stringify(item));
  const baseShadows = shadowList(base.shadow);
  return {
    radius: lit.radius,
    fill: lit.fill.filter((f) => !has(base.fill, f)),
    rim: lit.rim.filter((r) => !has(base.rim, r)),
    shadow: joinShadows(shadowList(lit.shadow).filter((s) => !baseShadows.includes(s) && !isCastShadow(s))),
  };
}

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16)];
}

/** `color` at `alpha` composited over an opaque `under`, as opaque hex. */
export function compositeOver(color: string, alpha: number, under: string): string {
  const a = parseHex(color);
  const b = parseHex(under);
  return `#${a.map((c, i) => Math.round(c * alpha + b[i]! * (1 - alpha)).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** A gradient with every stop composited over `under`: the solid fallback for translucent glass. */
export function opaqueOver(spec: GradientSpec, under: string): GradientSpec {
  return { ...spec, stops: spec.stops.map((s) => ({ offset: s.offset, color: compositeOver(s.color, s.opacity, under), opacity: 1 })) };
}

/** The flat colour of a recipe (light theme and first frame before layout): its first fill stop. */
export function flatColor(recipe: GlassRecipe): string | undefined {
  return recipe.fill[0]?.stops[0]?.color;
}
export function flatRim(recipe: GlassRecipe): string | undefined {
  return recipe.rim[0]?.stops[0]?.color;
}

/** Props for decorative layers: invisible to assistive tech (RN maps aria-hidden per platform). */
export const HIDDEN = { accessible: false, 'aria-hidden': true } as const;
/** Decorative layers never take touches; style.pointerEvents (the prop form is deprecated on web). */
export const PASS_THROUGH: ViewStyle = { pointerEvents: 'none' };
