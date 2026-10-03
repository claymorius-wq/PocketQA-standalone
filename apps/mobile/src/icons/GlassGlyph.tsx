import { Fragment, memo } from 'react';
import { Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, FeGaussianBlur, Filter, G, LinearGradient, Mask, Path, RadialGradient, Rect } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { GLYPHS, type GlyphName, type GlyphPart } from './glyphs';
import { BEVEL, CAST, EXTRUSION, FACE, FACE_VECTOR, flatGlyphColor, GLYPH_PAD, HOT, ROSE_CORE, SHEEN, type GlyphVariant } from './material';
import { PartGeometry, SoftSilhouette, stops, useSvgId } from './svg';

export type GlassGlyphProps = {
  name: GlyphName;
  /** Rendered size of the 32-unit grid in dp (spec §7.6: 34 in a 54 tile, 26 tab bar, 24 in 36–40 tiles, 16–22 in buttons). */
  size?: number;
  /** `lit` active or on light glass, `muted` inactive tab, `rose` danger (Stop, Remove, Reject). */
  variant?: GlyphVariant;
  /** Light theme only: the flat silhouette colour (defaults by variant). Lens glyphs are never recoloured. */
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

const GRID = 32;
const CANVAS = GRID + 2 * GLYPH_PAD;
const VIEWBOX = `${-GLYPH_PAD} ${-GLYPH_PAD} ${CANVAS} ${CANVAS}`;
// The spec's mask box (lens-glyphs.mjs): the grid plus 4 units, enough for every bevel crescent.
const BOX = { x: -4, y: -4, width: 40, height: 40 } as const;
// Browsers blur in the compositor; native uses SoftSilhouette (see svg.tsx).
const REAL_BLUR = Platform.OS === 'web';

/**
 * One extruded glass glyph (spec §7.3), drawn back to front: cast shadow, then per part three
 * extrusion steps graded dark toward the back, the face gradient, the rose core (danger), the
 * top-left sheen and the inner bevel (lit crescent top-left, shaded crescent bottom-right).
 * Decorative: hidden from assistive tech; the control that holds it carries the label.
 * In light (`glass.enabled === false`) it degrades to a flat silhouette.
 */
export const GlassGlyph = memo(function GlassGlyph({ name, size = 24, variant = 'face', color, style, testID }: GlassGlyphProps) {
  const { colors, glass } = useTheme();
  const id = useSvgId();
  const parts: readonly GlyphPart[] = GLYPHS[name];
  const canvas = (size * CANVAS) / GRID;
  const offset = (size * GLYPH_PAD) / GRID;

  return (
    <View
      testID={testID}
      accessible={false}
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[{ width: size, height: size, pointerEvents: 'none' }, style]}
    >
      <Svg width={canvas} height={canvas} viewBox={VIEWBOX} style={{ position: 'absolute', left: -offset, top: -offset }}>
        {glass.enabled ? (
          <LensBody id={id} parts={parts} variant={variant} hotStops={glass.recordCore.face.stops} glow={glass.recordCore.glow} />
        ) : (
          <G>
            {parts.map((p, i) => (
              <PartGeometry key={i} part={p} paint={color ?? flatGlyphColor(colors, variant)} />
            ))}
          </G>
        )}
      </Svg>
    </View>
  );
});

function LensBody({
  id,
  parts,
  variant,
  hotStops,
  glow,
}: {
  id: string;
  parts: readonly GlyphPart[];
  variant: GlyphVariant;
  hotStops: Parameters<typeof stops>[0];
  glow: string;
}) {
  const muted = variant === 'muted';
  const ref = (k: string) => `${id}-${k}`;
  const url = (k: string) => `url(#${ref(k)})`;
  const hasHot = parts.some((p) => p.hot);

  return (
    <G>
      <Defs>
        <LinearGradient id={ref('face')} gradientUnits="userSpaceOnUse" {...FACE_VECTOR}>
          {stops(FACE[variant])}
        </LinearGradient>
        <LinearGradient id={ref('bvH')} gradientUnits="userSpaceOnUse" x1={BEVEL.highlight.x1} y1={BEVEL.highlight.y1} x2={BEVEL.highlight.x2} y2={BEVEL.highlight.y2}>
          {stops(BEVEL.highlight.stops)}
        </LinearGradient>
        {muted ? null : (
          <RadialGradient id={ref('sheen')} gradientUnits="userSpaceOnUse" cx={SHEEN.cx} cy={SHEEN.cy} fx={SHEEN.cx} fy={SHEEN.cy} r={SHEEN.r}>
            {stops(SHEEN.stops)}
          </RadialGradient>
        )}
        {variant === 'rose' ? (
          <RadialGradient id={ref('rcore')} gradientUnits="userSpaceOnUse" cx={ROSE_CORE.cx} cy={ROSE_CORE.cy} fx={ROSE_CORE.cx} fy={ROSE_CORE.cy} r={ROSE_CORE.r}>
            {stops(ROSE_CORE.stops)}
          </RadialGradient>
        ) : null}
        {hasHot ? (
          <RadialGradient id={ref('hot')} gradientUnits="userSpaceOnUse" cx={HOT.cx} cy={HOT.cy} fx={HOT.cx} fy={HOT.cy} r={HOT.r}>
            {stops(hotStops)}
          </RadialGradient>
        ) : null}
        {REAL_BLUR ? (
          <Filter id={ref('cast')} x="-30%" y="-30%" width="160%" height="160%">
            <FeGaussianBlur stdDeviation={CAST.blur} />
          </Filter>
        ) : null}
        {REAL_BLUR && hasHot ? (
          <Filter id={ref('glow')} x="-80%" y="-80%" width="260%" height="260%">
            <FeGaussianBlur stdDeviation={HOT.glowBlur} />
          </Filter>
        ) : null}
        {parts.map((p, i) => (
          <Fragment key={i}>
            <Mask id={ref(`h${i}`)} maskUnits="userSpaceOnUse" {...BOX}>
              <PartGeometry part={p} paint="#FFFFFF" />
              <G transform={`translate(${BEVEL.dx} ${BEVEL.dy})`}>
                <PartGeometry part={p} paint="#000000" />
              </G>
            </Mask>
            <Mask id={ref(`s${i}`)} maskUnits="userSpaceOnUse" {...BOX}>
              <PartGeometry part={p} paint="#FFFFFF" />
              <G transform={`translate(${-BEVEL.dx} ${-BEVEL.dy})`}>
                <PartGeometry part={p} paint="#000000" />
              </G>
            </Mask>
          </Fragment>
        ))}
      </Defs>

      <G transform={`translate(${CAST.dx} ${CAST.dy})`} opacity={muted ? CAST.mutedOpacity : CAST.opacity}>
        {REAL_BLUR ? (
          <G filter={url('cast')}>
            {parts.map((p, i) => (
              <PartGeometry key={i} part={p} paint={CAST.color} />
            ))}
          </G>
        ) : (
          <SoftSilhouette parts={parts} color={CAST.color} sigma={CAST.blur} />
        )}
      </G>

      {parts.map((p, i) => (
        <G key={i}>
          {EXTRUSION.map((step, k) => (
            <G key={k} transform={`translate(${step.dx} ${step.dy})`}>
              <PartGeometry part={p} paint={muted ? step.muted : step.color} />
            </G>
          ))}
          {p.hot && p.f ? (
            <G opacity={HOT.glowOpacity}>
              {REAL_BLUR ? <Path d={p.f} fill={glow} filter={url('glow')} /> : <SoftSilhouette parts={[{ f: p.f }]} color={glow} sigma={HOT.glowBlur} />}
            </G>
          ) : null}
          <PartGeometry part={p} paint={p.hot ? url('hot') : url('face')} />
          {/* The sheen and rose core fill the part itself: the spec masks a full-box rect to the part, which paints the same pixels. */}
          {variant === 'rose' && !p.hot ? <PartGeometry part={p} paint={url('rcore')} /> : null}
          {p.hot || muted ? null : <PartGeometry part={p} paint={url('sheen')} />}
          <Rect {...BOX} fill={url('bvH')} opacity={muted ? BEVEL.highlightOpacityMuted : BEVEL.highlightOpacity} mask={url(`h${i}`)} />
          <Rect {...BOX} fill={muted ? BEVEL.shadeMuted : BEVEL.shade} opacity={BEVEL.shadeOpacity} mask={url(`s${i}`)} />
        </G>
      ))}
    </G>
  );
}
