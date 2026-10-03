import { Fragment } from 'react';
import { G, Path, Stop } from 'react-native-svg';
import { useSvgId as usePaintSvgId } from '../glass/paint';
import type { GradientStop } from '../theme/tokens';
import type { GlyphPart } from './glyphs';
import { SOFT_LAYERS } from './material';

/** A per-instance SVG id prefix (glass/paint.tsx useSvgId: SVG ids are document-global on web). */
export function useSvgId(): string {
  return usePaintSvgId('lq');
}

export function stops(list: readonly GradientStop[]) {
  return list.map((st, i) => <Stop key={i} offset={st.offset} stopColor={st.color} stopOpacity={st.opacity} />);
}

/**
 * One glyph part painted with `paint`. `grow` widens the outline by that many units on each side
 * (the soft-shadow dilation); fills get a stroke of 2·grow with round joins.
 */
export function PartGeometry({ part, paint, grow = 0 }: { part: GlyphPart; paint: string; grow?: number }) {
  return (
    <Fragment>
      {part.s ? <Path d={part.s} fill="none" stroke={paint} strokeWidth={(part.w ?? 4) + 2 * grow} strokeLinecap="round" strokeLinejoin="round" /> : null}
      {part.f ? (
        <Path d={part.f} fill={paint} fillRule="evenodd" stroke={grow > 0 ? paint : 'none'} strokeWidth={2 * grow} strokeLinejoin="round" />
      ) : null}
    </Fragment>
  );
}

/**
 * Native stand-in for `filter: blur(σ)` on a silhouette: stacked dilations at decreasing alpha
 * (material.SOFT_LAYERS). Each layer is its own group so overlapping parts do not double up.
 * react-native-svg's Android blur runs RenderScript per draw, too slow for every icon.
 */
export function SoftSilhouette({ parts, color, sigma }: { parts: readonly GlyphPart[]; color: string; sigma: number }) {
  return (
    <Fragment>
      {SOFT_LAYERS.map((layer, i) => (
        <G key={i} opacity={layer.alpha}>
          {parts.map((p, j) => (
            <PartGeometry key={j} part={p} paint={color} grow={layer.r * sigma} />
          ))}
        </G>
      ))}
    </Fragment>
  );
}
