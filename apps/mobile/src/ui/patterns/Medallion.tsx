import { StyleSheet, View, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Path } from 'react-native-svg';
import { GradientDef, HIDDEN, PASS_THROUGH, useSvgId, type Box } from '../../glass/paint';
import { GlassGlyph, type GlyphName } from '../../icons';
import { useTheme } from '../../theme/ThemeProvider';
import type { GradientSpec } from '../../theme/tokens';

// The badge medallion (docs/design/reputation-layer.md §4, Appendix A; the boards' lens-rep.mjs
// medallion): one geometry at four sizes. Back to front: the socket (a circular L-1 well, always
// there), the progress arc in the gap while the badge is locked, then the body: lit glass when
// earned (the cast with the violet tile's caustic, the L2 violet bezel with the brand lens's rim,
// the violet face dome and its specular, the lit glyph), or unlit and sunk into the socket when
// locked (smoked glass, the muted glyph). Earned glass carries no Uplight at rest, and nothing here
// moves. Never gold, silver or bronze, no milled edge (it would read as a coin), no glow.
// Light: drawn flat from the palette (the socket's surfaceAlt with a hairline, the surface body
// with a borderStrong rim, a primary glyph and arc), until the light Lens theme exists.

export const MEDAL_SIZES = { row: 40, shelf: 56, hero: 96, sheet: 120 } as const;
export type MedalSize = keyof typeof MEDAL_SIZES;
/** `new`: earned, and not seen yet (drawn as earned; the text beside it says "New"). */
export type MedalState = 'locked' | 'earned' | 'new';

/** The spec's geometry for an outer diameter S (§4): every part in whole dp, shadows by k = S / 56. */
export function medalGeometry(S: number) {
  const gap = Math.max(3, Math.round(S * 0.07));
  const body = S - 2 * gap;
  const bezel = Math.max(3, Math.round(body * 0.09));
  const face = body - 2 * bezel;
  return {
    S,
    gap,
    body,
    bezel,
    face,
    glyph: Math.round(face * 0.68),
    /** The arc's stroke, in the gap. */
    track: Math.max(2, Math.round(gap * 0.5)),
    k: S / 56,
  };
}
type Geometry = ReturnType<typeof medalGeometry>;

/**
 * The arc from 12 o'clock clockwise over `share` of the turn, as a path (no rotation, so its
 * gradient stays on the screen's axes: pale at the top-left, violet at the bottom-right).
 */
export function arcPath(c: number, r: number, share: number): string {
  const p = Math.max(0, Math.min(1, share));
  if (p >= 1) return `M${c} ${c - r}A${r} ${r} 0 1 1 ${c} ${c + r}A${r} ${r} 0 1 1 ${c} ${c - r}`;
  const a = p * 2 * Math.PI;
  const x = c + r * Math.sin(a);
  const y = c - r * Math.cos(a);
  return `M${c} ${c - r}A${r} ${r} 0 ${p > 0.5 ? 1 : 0} 1 ${round(x)} ${round(y)}`;
}
const round = (n: number) => Math.round(n * 100) / 100;

export type MedallionProps = {
  glyph: GlyphName;
  size?: MedalSize;
  state: MedalState;
  /** Locked: how far toward the badge (0 … 1), drawn as the arc. */
  progress?: number;
  /** One spoken label, the medallion as an image; without one it is hidden from assistive tech. */
  label?: string;
  testID?: string;
};

export function Medallion({ glyph, size = 'shelf', state, progress = 0, label, testID }: MedallionProps) {
  const { glass, colors } = useTheme();
  const g = medalGeometry(MEDAL_SIZES[size]);
  const locked = state === 'locked';
  const a11y = label ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel: label } : HIDDEN;
  const box: ViewStyle = { width: g.S, height: g.S };

  if (!glass.enabled) {
    return (
      <View {...a11y} testID={testID} style={[box, PASS_THROUGH]}>
        <View style={[StyleSheet.absoluteFill, styles.round, { borderRadius: g.S / 2, backgroundColor: colors.surfaceAlt, borderColor: colors.border }]} />
        {locked ? <Arc g={g} progress={progress} track={colors.border} fill={colors.primary} /> : null}
        <View style={[styles.body, { left: g.gap, top: g.gap, width: g.body, height: g.body, borderRadius: g.body / 2, backgroundColor: colors.surface, borderColor: colors.borderStrong }, styles.round]}>
          <GlassGlyph name={glyph} size={g.glyph} variant={locked ? 'muted' : 'lit'} />
        </View>
      </View>
    );
  }

  return (
    <View {...a11y} testID={testID} style={[box, PASS_THROUGH]}>
      <Socket g={g} />
      {locked ? <Arc g={g} progress={progress} track={glass.medal.arc.track} fill={glass.medal.arc.fill} /> : null}
      {/* Locked glass sits sunk in its socket, by half a dp and one (k-scaled). */}
      <View style={[styles.layer, { left: g.gap, top: g.gap, width: g.body, height: g.body }, locked ? { transform: [{ translateX: Math.max(0.5, 0.5 * g.k) }, { translateY: Math.max(1, g.k) }] } : null]}>
        {locked ? <UnlitBody g={g} glyph={glyph} /> : <LitBody g={g} glyph={glyph} />}
      </View>
    </View>
  );
}

/** Circles filled with a gradient list, back to front, over one square box. */
function Fills({ id, specs, c, r, box }: { id: string; specs: GradientSpec[]; c: number; r: number; box: Box }) {
  return (
    <>
      <Defs>
        {specs.map((spec, i) => (
          <GradientDef key={i} id={`${id}${i}`} spec={spec} box={box} />
        ))}
      </Defs>
      {specs.map((_, i) => (
        <Circle key={i} cx={c} cy={c} r={r} fill={`url(#${id}${i})`} />
      ))}
    </>
  );
}

/** A circular layer drawing only its shadows (inset bevels and lips, or the cast). */
function ShadowDisc({ size, inset = 0, shadow }: { size: number; inset?: number; shadow: string | undefined }) {
  if (!shadow) return null;
  const d = size - 2 * inset;
  return <View style={[styles.layer, { left: inset, top: inset, width: d, height: d, borderRadius: d / 2, boxShadow: shadow }]} />;
}

function Socket({ g }: { g: Geometry }) {
  const { glass } = useTheme();
  const id = useSvgId('mds');
  const m = glass.medal.socket;
  const c = g.S / 2;
  const whole: Box = { x: 0, y: 0, w: g.S, h: g.S };
  return (
    <>
      <Svg width={g.S} height={g.S} style={StyleSheet.absoluteFill}>
        {/* The floor inside the 1dp rim, the rim on the edge. */}
        <Fills id={`${id}f`} specs={m.floor} c={c} r={c - 1} box={whole} />
        <Defs>
          <GradientDef id={`${id}r`} spec={m.rim} box={whole} />
        </Defs>
        <Circle cx={c} cy={c} r={c - 0.5} fill="none" stroke={`url(#${id}r)`} strokeWidth={1} />
      </Svg>
      <ShadowDisc size={g.S} shadow={m.shadow(g.k)} />
    </>
  );
}

function Arc({ g, progress, track, fill }: { g: Geometry; progress: number; track: string; fill: string | GradientSpec }) {
  const id = useSvgId('mda');
  const c = g.S / 2;
  const r = c - g.gap / 2;
  const share = Math.max(0, Math.min(1, progress));
  const gradient = typeof fill === 'string' ? null : fill;
  return (
    <Svg width={g.S} height={g.S} style={StyleSheet.absoluteFill}>
      {gradient ? (
        <Defs>
          <GradientDef id={id} spec={gradient} box={{ x: 0, y: 0, w: g.S, h: g.S }} />
        </Defs>
      ) : null}
      <Circle cx={c} cy={c} r={r} fill="none" stroke={track} strokeWidth={1} />
      {share > 0 ? <Path d={arcPath(c, r, share)} fill="none" stroke={gradient ? `url(#${id})` : (fill as string)} strokeWidth={g.track} strokeLinecap="round" /> : null}
    </Svg>
  );
}

function LitBody({ g, glyph }: { g: Geometry; glyph: GlyphName }) {
  const { glass } = useTheme();
  const id = useSvgId('mdl');
  const m = glass.medal.lit;
  const B = g.body;
  const c = B / 2;
  const faceBox: Box = { x: g.bezel, y: g.bezel, w: g.face, h: g.face };
  const ring = g.S >= 90 ? 1.5 : 1;
  return (
    <>
      <ShadowDisc size={B} shadow={m.cast(g.k)} />
      <Svg width={B} height={B} style={StyleSheet.absoluteFill}>
        <Fills id={`${id}b`} specs={m.bezel} c={c} r={c - 1} box={{ x: 0, y: 0, w: B, h: B }} />
        <Defs>
          <GradientDef id={`${id}r`} spec={m.rim} box={{ x: 0, y: 0, w: B, h: B }} />
        </Defs>
        <Circle cx={c} cy={c} r={c - 0.5} fill="none" stroke={`url(#${id}r)`} strokeWidth={1} />
      </Svg>
      <ShadowDisc size={B} shadow={m.bevel(g.k)} />
      <Svg width={B} height={B} style={StyleSheet.absoluteFill}>
        <Fills id={`${id}f`} specs={m.face} c={c} r={g.face / 2} box={faceBox} />
      </Svg>
      <ShadowDisc size={B} inset={g.bezel} shadow={m.lip(g.k)} />
      <Svg width={B} height={B} style={StyleSheet.absoluteFill}>
        <Defs>
          <GradientDef id={`${id}s`} spec={m.specular} box={faceBox} />
        </Defs>
        <Circle cx={c} cy={c} r={g.face / 2 - ring / 2} fill="none" stroke={`url(#${id}s)`} strokeWidth={ring} />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>
        <GlassGlyph name={glyph} size={g.glyph} variant="lit" />
      </View>
    </>
  );
}

function UnlitBody({ g, glyph }: { g: Geometry; glyph: GlyphName }) {
  const { glass } = useTheme();
  const id = useSvgId('mdu');
  const m = glass.medal.unlit;
  const B = g.body;
  const c = B / 2;
  return (
    <>
      <Svg width={B} height={B} style={StyleSheet.absoluteFill}>
        <Fills id={`${id}b`} specs={m.bezel} c={c} r={c - 1} box={{ x: 0, y: 0, w: B, h: B }} />
        <Defs>
          <GradientDef id={`${id}r`} spec={m.rim} box={{ x: 0, y: 0, w: B, h: B }} />
        </Defs>
        <Circle cx={c} cy={c} r={c - 0.5} fill="none" stroke={`url(#${id}r)`} strokeWidth={1} />
      </Svg>
      <ShadowDisc size={B} shadow={m.bevel} />
      <Svg width={B} height={B} style={StyleSheet.absoluteFill}>
        <Fills id={`${id}f`} specs={m.face} c={c} r={g.face / 2} box={{ x: g.bezel, y: g.bezel, w: g.face, h: g.face }} />
      </Svg>
      <ShadowDisc size={B} inset={g.bezel} shadow={m.lip(g.k)} />
      <View style={[StyleSheet.absoluteFill, styles.center, styles.mutedGlyph]}>
        <GlassGlyph name={glyph} size={g.glyph} variant="muted" />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute' },
  body: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  round: { borderWidth: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  mutedGlyph: { opacity: 0.8 },
});
