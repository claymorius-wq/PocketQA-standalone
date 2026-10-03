import { shadowList } from '../glass/paint';
import type { ShadowRecipe } from '../theme/tokens';

/** A hard inset edge (`inset dx dy 0 color`) that SVG draws inside a tile. */
export type InsetEdge = { dx: number; dy: number; color: string };

/**
 * Splits a recipe's CSS shadow list for a tile drawn with SVG. Outset layers stay a `boxShadow`
 * string on the View. Inset layers would paint under the SVG fill (CSS paints inset shadows above
 * the background but below content), so the hard ones (no blur, no spread) come back as edges for
 * the SVG to draw; soft insets stay on the View, where they are hidden (no tile recipe has one).
 */
export function splitShadow(shadow: ShadowRecipe): { outer: string | undefined; insetEdges: InsetEdge[] } {
  if (!shadow) return { outer: undefined, insetEdges: [] };
  const layers = shadowList(shadow);

  const outer: string[] = [];
  const insetEdges: InsetEdge[] = [];
  for (const layer of layers) {
    const inset = /^inset\s/.test(layer);
    const body = inset ? layer.replace(/^inset\s+/, '') : layer;
    const color = /(rgba?\([^)]*\)|#[0-9A-Fa-f]{3,8})/.exec(body)?.[1];
    const lengths = body
      .replace(color ?? '', '')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => parseFloat(t));
    const [dx = 0, dy = 0, blur = 0, spread = 0] = lengths;
    if (inset && color && blur === 0 && spread === 0) insetEdges.push({ dx, dy, color });
    else outer.push(layer);
  }
  return { outer: outer.length ? outer.join(', ') : undefined, insetEdges };
}
