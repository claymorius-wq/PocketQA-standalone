import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text as RNText, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { GlassSurface } from '../../glass';
import { HIDDEN } from '../../glass/paint';
import { useTheme } from '../../theme/ThemeProvider';
import { PipCanvas, useMeterChange, type MeterMaterial, type PipCell } from './meter';

// The slot meter (A-BStudies "Slot meter rule", A-BStudy budget meter). Slots run 1–500.
//   slots ≤ 10: one capsule per slot, 6dp apart, each at least 10dp; the row is max(116, 16n − 6) wide.
//   slots > 10: one continuous 116 × 6 track: the filled share in violet glass, the awarded share
//              (part of filled) in pale lit glass on top. Shares never round to nothing: 8dp
//              minimum filled, 6dp awarded, and filled stays 4dp clear of awarded.
// A live change animates the fill (scaleX) over 120ms; nothing animates on mount.

export type MeterStatus = 'draft' | 'published' | 'paused' | 'closed' | (string & {});

export const PIP_GAP = 6;
export const BAR_WIDTH = 116;

export type MeterPlan =
  | { kind: 'pips'; width: number; cells: MeterMaterial[] }
  | { kind: 'bar'; width: number; filledWidth: number; awardedWidth: number; unlit: boolean };

/** The board's meter() rule as data (tested): which material each slot shows, or the bar shares. */
export function planMeter({ slots, filled, awarded, status }: { slots: number; filled: number; awarded: number; status: MeterStatus }): MeterPlan {
  const n = Math.max(0, Math.floor(slots));
  const unlit = status === 'draft' || status === 'closed';
  const closed = status === 'closed';
  if (n <= 10) {
    const cells: MeterMaterial[] = Array.from({ length: n }, (_, i) =>
      i < awarded ? (closed ? 'closed' : 'awarded') : i < filled ? (closed ? 'closed' : 'filled') : unlit ? 'socketUnlit' : 'socket',
    );
    return { kind: 'pips', width: Math.max(BAR_WIDTH, 16 * n - PIP_GAP), cells };
  }
  const W = BAR_WIDTH;
  const awardedWidth = awarded > 0 ? Math.max(6, Math.round((W * awarded) / n)) : 0;
  let filledWidth = filled > 0 ? Math.max(8, Math.round((W * filled) / n)) : 0;
  if (filled > awarded && filledWidth < awardedWidth + 4) filledWidth = awardedWidth + 4;
  return { kind: 'bar', width: W, filledWidth: Math.min(W, filledWidth), awardedWidth: Math.min(W, awardedWidth), unlit };
}

/** Pip x positions for a row `width` wide (flex: 1 1 0, 6dp gaps, as the board lays them out). */
export function layoutPips(materials: readonly MeterMaterial[], width: number, gap = PIP_GAP): PipCell[] {
  const n = materials.length;
  if (!n) return [];
  const w = Math.max(10, (width - gap * (n - 1)) / n);
  return materials.map((material, i) => ({ x: i * (w + gap), w, material }));
}

export type SlotMeterProps = {
  slots: number;
  /** Slots taken (consented and beyond): the screens' `slotsFilled`. */
  filled: number;
  /** Slots whose reward was awarded. */
  awarded?: number;
  /** The study status: draft and closed meters are unlit. */
  status: MeterStatus;
  testID?: string;
};

/**
 * The builder study card's slot meter (A-BStudies): a lens well with the readout "1/5 slots"
 * (Red Hat Display 300 34/36, "/5" 20/24 muted, "slots" 13/18) over the pips or the bar. Screen
 * readers hear "1 of 5 slots filled"; the pips are decorative.
 */
export function SlotMeter({ slots, filled, awarded = 0, status, testID }: SlotMeterProps) {
  const { colors, glass, type } = useTheme();
  const plan = planMeter({ slots, filled, awarded, status });
  const fade = useMeterChange(plan.kind === 'pips' ? plan.cells.join() : `${plan.filledWidth}/${plan.awardedWidth}`);
  const unlit = status === 'draft' || status === 'closed';
  // A draft or closed study's well has no far-wall light: no bloom, and the rim holds line-strong
  // all the way round (A-BStudies). Same well otherwise.
  const unlitWell = useMemo(
    () => ({
      ...glass.well,
      fill: glass.well.fill.filter((f) => f.kind === 'linear'),
      rim: glass.enabled ? [{ kind: 'linear' as const, angle: 135, stops: [{ offset: 0, color: colors.borderStrong, opacity: 1 }, { offset: 1, color: colors.borderStrong, opacity: 1 }] }] : glass.well.rim,
    }),
    [glass, colors],
  );
  return (
    <GlassSurface
      testID={testID}
      recipe={unlit ? unlitWell : glass.well}
      grain={false}
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${filled} of ${slots} slots filled`}
      style={styles.well}
    >
      <View style={styles.readout}>
        <RNText style={[type.numeral, styles.count, { color: colors.numeral }]}>{filled}</RNText>
        <RNText style={[type.numeral, styles.of, { color: colors.textMuted }]}>/{slots}</RNText>
        <RNText style={[type.small, styles.unit, { color: colors.textMuted }]}>slots</RNText>
      </View>
      {plan.kind === 'pips' ? (
        <Animated.View style={fade}>
          <PipCanvas cells={layoutPips(plan.cells, plan.width)} width={plan.width} h={8} />
        </Animated.View>
      ) : (
        <SlotBar plan={plan} />
      )}
    </GlassSurface>
  );
}

function SlotBar({ plan }: { plan: Extract<MeterPlan, { kind: 'bar' }> }) {
  const { motion, glass, colors } = useTheme();
  // The board's bar materials; light theme takes the palette's flat equivalents.
  const paint = glass.enabled
    ? { track: '#07061A', rim: plan.unlit ? '#5C568A' : '#7A74A8', filled: '#33277A', awarded: 'rgba(214,224,255,0.85)' }
    : { track: colors.surfaceAlt, rim: colors.borderStrong, filled: colors.violet, awarded: colors.primary };
  const filled = useSharedValue(plan.filledWidth / plan.width);
  const awarded = useSharedValue(plan.awardedWidth / plan.width);
  useEffect(() => {
    filled.value = withTiming(plan.filledWidth / plan.width, motion.timing.tick);
    awarded.value = withTiming(plan.awardedWidth / plan.width, motion.timing.tick);
  }, [plan.filledWidth, plan.awardedWidth, plan.width, filled, awarded, motion]);
  // Full-width layers scaled from the left edge: only the transform animates.
  const fillStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: filled.value }] }));
  const awardStyle = useAnimatedStyle(() => ({ transform: [{ scaleX: awarded.value }] }));
  return (
    <View {...HIDDEN} style={[styles.track, { width: plan.width, backgroundColor: paint.track, borderColor: paint.rim }]}>
      <Animated.View style={[styles.barLayer, styles.barFilled, { backgroundColor: paint.filled }, fillStyle]} />
      <Animated.View style={[styles.barLayer, { backgroundColor: paint.awarded }, awardStyle]} />
    </View>
  );
}

/** Which budget share a slot's credits are in (A-BStudy): awarded, committed, released (bare) or available. */
export function planBudgetMeter({ slots, awarded, committed, available }: { slots: number; awarded: number; committed: number; available: number }): MeterMaterial[] {
  return Array.from({ length: Math.max(0, slots) }, (_, i) => (i < awarded ? 'awarded' : i < awarded + committed ? 'filled' : i >= slots - available ? 'socket' : 'bare'));
}

/**
 * The budget card's full-width meter (A-BStudy): one 12dp pip per slot, coloured by where its
 * credits are (awarded, committed, available; credits released at close leave a bare slot).
 * The KeyValue rows above it carry the same materials as legend swatches. Counts are slots.
 */
export function BudgetMeter({ slots, awarded, committed, available, testID }: { slots: number; awarded: number; committed: number; available: number; testID?: string }) {
  const [width, setWidth] = useState(0);
  const materials = planBudgetMeter({ slots, awarded, committed, available });
  const fade = useMeterChange(materials.join());
  const onLayout = (e: LayoutChangeEvent) => {
    const w = Math.floor(e.nativeEvent.layout.width) - 1;
    setWidth((prev) => (prev === w ? prev : w));
  };
  return (
    <Animated.View {...HIDDEN} testID={testID} onLayout={onLayout} style={[styles.budget, fade]}>
      {width > 0 ? <PipCanvas cells={layoutPips(materials, width)} width={width} h={12} /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Board padding 8 14 11 inside the 1dp rim; readout and pips 8 apart.
  well: { alignSelf: 'flex-start', paddingTop: 8, paddingRight: 14, paddingBottom: 11, paddingLeft: 14, gap: 8 },
  readout: { flexDirection: 'row', alignItems: 'baseline' },
  count: { fontSize: 34, lineHeight: 36, letterSpacing: -1 },
  of: { fontSize: 20, lineHeight: 24, letterSpacing: -0.4 },
  unit: { marginLeft: 7 },
  track: { height: 6, borderRadius: 3, borderWidth: 1, overflow: 'hidden' },
  barLayer: { position: 'absolute', top: -1, bottom: -1, left: -1, right: -1, borderRadius: 3, transformOrigin: 'left' },
  barFilled: { borderTopWidth: 1, borderTopColor: 'rgba(220,230,255,0.5)' },
  budget: { height: 14, alignSelf: 'stretch' },
});
