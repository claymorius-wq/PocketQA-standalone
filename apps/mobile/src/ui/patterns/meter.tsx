import { memo, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Defs, Rect } from 'react-native-svg';
import { GradientDef, HIDDEN, PASS_THROUGH, useSvgId } from '../../glass/paint';
import { useTheme } from '../../theme/ThemeProvider';
import type { LinearGradientSpec, Palette } from '../../theme/tokens';

// The slot / budget meter materials (A-BStudies "Slot meter rule", shared with A-BStudy's budget
// meter and its legend swatches). Awarded is pale lit glass, filled (held for review, or
// committed) is violet glass, open is a recessed socket; a draft or closed study's sockets are
// unlit (no far-wall light) and a closed study's pips are dimmed. `bare` (a budget slot holding no
// credits: a draft's slots, or credits released at close) is the empty unlit socket. Pips are lit
// glass, never light sources: no caustic, no glow.
//
// RN adaptation: every pip of a meter is drawn in ONE react-native-svg canvas (one view, not one
// GlassSurface per pip). Each pip keeps its gradient body, gradient rim, 1dp top highlight and the
// hard 1 × 1.5 extrusion step; the soft 2px 3px 4px cast under each pip and the socket's inset
// shadow are dropped (sub-pixel at 8dp, and a blur per pip would cost a layer each).

export type MeterMaterial = 'awarded' | 'filled' | 'closed' | 'socket' | 'socketUnlit' | 'bare';

const s = (offset: number, color: string, opacity = 1) => ({ offset, color, opacity });
const lin = (angle: number, ...stops: ReturnType<typeof s>[]): LinearGradientSpec => ({ kind: 'linear', angle, stops });

type PipRecipe = { fill: LinearGradientSpec; rim?: LinearGradientSpec; highlight?: [string, number]; step?: string };

const PIPS: Record<MeterMaterial, PipRecipe> = {
  awarded: {
    fill: lin(135, s(0, '#EEF2FF'), s(0.55, '#D6E0FF'), s(1, '#AEBDEB')),
    rim: lin(135, s(0, '#FFFFFF', 0.9), s(1, '#4E5FC9', 0.45)),
    highlight: ['#FFFFFF', 0.6],
    step: '#2E2573',
  },
  filled: {
    fill: lin(150, s(0, '#4434A0'), s(0.5, '#33277A'), s(1, '#261D5C')),
    rim: lin(135, s(0, '#DCE6FF', 0.9), s(0.4, '#8C7BFF', 0.4), s(1, '#2E2366', 0.2)),
    highlight: ['#E6ECFF', 0.18],
    step: '#160F3A',
  },
  closed: {
    fill: lin(135, s(0, '#A39DCB'), s(0.55, '#7B74AA'), s(1, '#5E5890')),
    highlight: ['#FFFFFF', 0.35],
    step: '#211C4E',
  },
  socket: {
    fill: lin(160, s(0, '#04030E'), s(1, '#0A0920')),
    rim: lin(135, s(0, '#5C568A'), s(0.5, '#7A74A8'), s(1, '#A0BAFF')),
  },
  socketUnlit: {
    fill: lin(160, s(0, '#04030E'), s(1, '#0A0920')),
    rim: lin(135, s(0, '#5C568A'), s(0.5, '#7A74A8'), s(1, '#7A74A8')),
  },
  bare: {
    fill: lin(160, s(0, '#04030E'), s(1, '#0A0920')),
    rim: lin(135, s(0, '#5C568A'), s(0.5, '#7A74A8'), s(1, '#7A74A8')),
  },
};

/** Light theme (glass disabled): flat fills from the palette, a hairline socket. */
function flatPip(m: MeterMaterial, c: Palette): { fill: string; rim?: string } {
  switch (m) {
    case 'awarded':
      return { fill: c.primary };
    case 'filled':
      return { fill: c.violet };
    case 'closed':
      return { fill: c.borderStrong };
    default:
      return { fill: c.surfaceAlt, rim: c.borderStrong };
  }
}

export type PipCell = { x: number; w: number; material: MeterMaterial };

/** Draws pips of height `h` (radius h/2) in one canvas. `bare` cells are empty unlit sockets. */
export const PipCanvas = memo(function PipCanvas({ cells, width, h }: { cells: readonly PipCell[]; width: number; h: number }) {
  const { glass, colors } = useTheme();
  const id = useSvgId('pip');
  const r = h / 2;
  // The extrusion step sits 1 × 1.5 below-right, so the canvas is 2dp taller and 1dp wider.
  const W = width + 1;
  const H = h + 2;
  if (!glass.enabled) {
    return (
      <View {...HIDDEN} style={[{ width: W, height: H }, PASS_THROUGH]}>
        <Svg width={W} height={H}>
          {cells.map((c, i) => {
            const f = flatPip(c.material, colors);
            return <Rect key={i} x={c.x + 0.5} y={0.5} width={Math.max(0, c.w - 1)} height={h - 1} rx={r - 0.5} fill={f.fill} stroke={f.rim} strokeWidth={f.rim ? 1 : 0} />;
          })}
        </Svg>
      </View>
    );
  }
  return (
    <View {...HIDDEN} style={[{ width: W, height: H }, PASS_THROUGH]}>
      <Svg width={W} height={H}>
        <Defs>
          {cells.map((c, i) => {
            const p = PIPS[c.material];
            const box = { x: c.x, y: 0, w: c.w, h };
            return [
              <GradientDef key={`f${i}`} id={`${id}f${i}`} spec={p.fill} box={box} />,
              p.rim ? <GradientDef key={`r${i}`} id={`${id}r${i}`} spec={p.rim} box={box} /> : null,
            ];
          })}
        </Defs>
        {cells.map((c, i) => {
          const p = PIPS[c.material];
          return [
            p.step ? <Rect key={`s${i}`} x={c.x + 1} y={1.5} width={c.w} height={h} rx={r} fill={p.step} /> : null,
            p.rim ? <Rect key={`r${i}`} x={c.x} y={0} width={c.w} height={h} rx={r} fill={`url(#${id}r${i})`} /> : null,
            <Rect key={`f${i}`} x={c.x + (p.rim ? 1 : 0)} y={p.rim ? 1 : 0} width={Math.max(0, c.w - (p.rim ? 2 : 0))} height={h - (p.rim ? 2 : 0)} rx={Math.max(0, r - (p.rim ? 1 : 0))} fill={`url(#${id}f${i})`} />,
            p.highlight ? <Rect key={`h${i}`} x={c.x + r} y={1} width={Math.max(0, c.w - 2 * r)} height={1} fill={p.highlight[0]} fillOpacity={p.highlight[1]} /> : null,
          ];
        })}
      </Svg>
    </View>
  );
});

/** A legend swatch (14 × 8) in a meter material: the KeyValue rows of the budget card. */
export function MeterSwatch({ material, width = 14, height = 8 }: { material: MeterMaterial; width?: number; height?: number }) {
  return <PipCanvas cells={[{ x: 0, w: width, material }]} width={width} h={height} />;
}

/**
 * Fades the meter in over dur-tick whenever its cells change after mount (a live change), never
 * on mount. Pips swap material; only opacity animates.
 */
export function useMeterChange(signature: string) {
  const { motion } = useTheme();
  const o = useSharedValue(1);
  const last = useRef(signature);
  useEffect(() => {
    if (last.current === signature) return;
    last.current = signature;
    o.value = withSequence(withTiming(0.4, { duration: 0 }), withTiming(1, motion.timing.tick));
  }, [signature, o, motion]);
  return useAnimatedStyle(() => ({ opacity: o.value }));
}

