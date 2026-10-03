import type { RadialGradientSpec } from './tokens';

/**
 * The SVG `userSpaceOnUse` end points of a CSS `linear-gradient(<angle>deg)` on a w×h box.
 * CSS measures the angle clockwise from "to top" and sizes the gradient line so the corners
 * reach 0% and 100%; an `objectBoundingBox` vector would instead stretch with the aspect ratio
 * and tilt the light on wide cards.
 */
export function cssLinearVector(angle: number, w: number, h: number): { x1: number; y1: number; x2: number; y2: number } {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const cx = w / 2;
  const cy = h / 2;
  return { x1: cx - dx * half, y1: cy - dy * half, x2: cx + dx * half, y2: cy + dy * half };
}

/** The SVG `userSpaceOnUse` centre and radii of a CSS `radial-gradient(rx ry at cx cy)` on a w×h box. */
export function cssRadialGeometry(g: RadialGradientSpec, w: number, h: number): { cx: number; cy: number; rx: number; ry: number } {
  return {
    cx: g.cx * w,
    cy: g.cy * h,
    rx: g.units === 'px' ? g.rx : g.rx * w,
    ry: g.units === 'px' ? g.ry : g.ry * h,
  };
}
