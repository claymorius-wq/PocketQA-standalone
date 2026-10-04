import type { Study } from '@pocket-qa/contracts';
import { useContext, useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { GlassSurface, useUplight } from '../glass';
import { ENTRANCE_WINDOW } from '../motion';
import { credits } from '../lib/format';
import { DUR, STAGGER } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import { radius } from '../theme/tokens';
import { Text } from '../ui';
import { BudgetMeter, Clauses, KeyFigure, KeyValue, UnderGlow } from '../ui/patterns';
import { ScreenContext } from '../ui/screen';

// The Budget card of the builder study (A-BStudy): an L1 card at k = 1 holding the lead figure
// (Reserved, the KeyFigure well) beside the breakdown (Awarded, Committed, Available as KeyValue rows
// whose swatches are the meter's legend), the budget meter, then "50 test credits × 5 slots · 1 filled".
//
// Signature (the board's own timeline): on the push the four figures settle, rising 6 from +160,
// 40 apart, and the meter follows from +240; after a Publish the two figures that changed (Reserved,
// Available) and the meter cross-fade under the light's tail. Reduced motion: the figures are simply
// there, and Commit shows nothing.
//
// U7's tail (Mode A): when the Publish sheet leaves, the card takes the Commit pass's tail on its
// uplit layer and under-glow: the kit's `land` grade (C4 lq-land: 0 → 0.6 over 240ms, → 0 over 700).

/** When the figures start to settle after the screen's arrival (ms), and the meter after them. */
const FIGURES_AT = 160;
const METER_AT = 240;
/** After Publish: Reserved at +120, Available at +160, the meter at +200 (the board's xfade delays). */
const XFADE_AT = { reserved: 120, available: 160, meter: 200 } as const;
/** A cross-fade dips to this rather than to nothing, so a figure never blinks out. */
const XFADE_FROM = 0.4;
/** The figures rise 6 as they settle (A-BStudy). */
const FIGURE_RISE = 6;

export type BudgetSlots = {
  awarded: number;
  committed: number;
  available: number;
  /** pips for up to 10 slots, one continuous bar above that (the board's meter rule; BudgetMeter draws both). */
  kind: 'pips' | 'bar';
};

/**
 * The budget split as slots for the meter. The study holds credits (reward × slots reserved at
 * publish); one slot is one reward, which only drafts can change. Never more than the slots.
 */
export function budgetSlots(s: Pick<Study, 'rewardCredits' | 'slots' | 'budget'>): BudgetSlots {
  const slots = Math.max(0, Math.floor(s.slots));
  const per = s.rewardCredits > 0 ? s.rewardCredits : 0;
  const count = (v: number) => (per ? Math.max(0, Math.floor(v / per)) : 0);
  const awarded = Math.min(slots, count(s.budget.awarded));
  const committed = Math.min(slots - awarded, count(s.budget.committed));
  const available = Math.min(slots - awarded - committed, count(s.budget.available));
  return { awarded, committed, available, kind: slots <= 10 ? 'pips' : 'bar' };
}

/**
 * The mount-only settle of one budget figure (rise and fade on the screen's arrival schedule), plus
 * a cross-fade each time `replay` increments. A figure that mounts after the arrival window (the
 * study loaded late) settles on the same 40ms spacing from now.
 */
function useSettle(at: number, rise: number, replay: number, replayAt: number) {
  const { motion } = useTheme();
  const screen = useContext(ScreenContext);
  const [delay] = useState(() => {
    if (motion.reduced) return null;
    const elapsed = screen ? Date.now() - screen.mountedAt : Infinity;
    return elapsed <= ENTRANCE_WINDOW ? Math.max(0, at - elapsed) : at - FIGURES_AT;
  });
  const progress = useSharedValue(delay === null ? 1 : 0);
  const fade = useSharedValue(1);
  useEffect(() => {
    if (delay === null) return;
    progress.value = withDelay(delay, withTiming(1, { duration: DUR.enter, easing: motion.ease.lens, reduceMotion: ReduceMotion.Never }));
    // Mount only: the settle never replays on re-render.
  }, []);
  useEffect(() => {
    if (replay === 0 || motion.reduced) return;
    fade.value = withSequence(withTiming(XFADE_FROM, { duration: 0 }), withDelay(replayAt, withTiming(1, motion.timing.swap)));
  }, [replay]);
  // Reduced motion (even when it is switched on mid-settle): the figure is simply there.
  const still = motion.reduced;
  return useAnimatedStyle(() => {
    const p = still ? 1 : progress.value;
    return { opacity: p * fade.value, transform: [{ translateY: (1 - p) * rise }] };
  });
}

function Settle({ at, rise = 6, replay = 0, replayAt = 0, children, style }: { at: number; rise?: number; replay?: number; replayAt?: number; children: ReactNode; style?: object }) {
  const animated = useSettle(at, rise, replay, replayAt);
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}


export function BudgetCard({ study: s, landing, settled }: {
  study: Pick<Study, 'rewardCredits' | 'slots' | 'slotsFilled' | 'budget'>;
  /** Increments when the Publish sheet hands U7's tail to the card. */
  landing: number;
  /** Increments when the figures should cross-fade (after a Publish). */
  settled: number;
}) {
  // U7's tail lands here once per Publish (the kit's `land` grade registers with the key light).
  const light = useUplight('land', landing > 0, { replay: landing });
  const meter = budgetSlots(s);
  const { budget } = s;
  // The figures themselves settle (KeyFigure / KeyValue valueStyle): the wells and rows stay put.
  const reservedFigure = useSettle(FIGURES_AT, FIGURE_RISE, settled, XFADE_AT.reserved);
  const awardedFigure = useSettle(FIGURES_AT + STAGGER.step, FIGURE_RISE, 0, 0);
  const committedFigure = useSettle(FIGURES_AT + 2 * STAGGER.step, FIGURE_RISE, 0, 0);
  const availableFigure = useSettle(FIGURES_AT + 3 * STAGGER.step, FIGURE_RISE, settled, XFADE_AT.available);
  return (
    // ≥ 32dp of ground under a Mode A subject: the screen's 24 gap plus this 8.
    <View style={styles.wrap}>
      <UnderGlow light={light} />
      <GlassSurface level="card" k={1} uplight={light.enabled ? light.u : undefined} testID="budget-card" style={styles.card}>
        <Text variant="label" tone="muted">BUDGET · TEST CREDITS</Text>
        <View style={styles.figures}>
          <View style={styles.lead}>
            <KeyFigure label="Reserved" value={budget.reserved} valueTestID="budget-reserved" valueStyle={reservedFigure} style={styles.leadWell} />
          </View>
          {/* A definition list: each figure settles on its own beat, so the rows take their dividers here. */}
          <View style={styles.rows}>
            <KeyValue label="Awarded" value={budget.awarded} swatch="awarded" valueTestID="budget-awarded" valueStyle={awardedFigure} />
            <KeyValue label="Committed" value={budget.committed} swatch="filled" divided valueStyle={committedFigure} />
            <KeyValue label="Available" value={budget.available} swatch="socket" valueTestID="budget-available" divided valueStyle={availableFigure} />
          </View>
        </View>
        {/* A draft's slots hold no credits yet: the meter shows them as bare sockets. */}
        <Settle at={METER_AT} rise={3} replay={settled} replayAt={XFADE_AT.meter} style={styles.meter}>
          <BudgetMeter slots={s.slots} awarded={meter.awarded} committed={meter.committed} available={meter.available} testID="budget-meter" />
        </Settle>
        <Clauses parts={[`${credits(s.rewardCredits)} × ${s.slots} slots`, `${s.slotsFilled} filled`]} style={styles.spec} />
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 8 },
  // Board padding 18 18 17 inside the rim.
  card: { borderRadius: radius.card, paddingTop: 18, paddingRight: 18, paddingBottom: 17, paddingLeft: 18 },
  // The term column is 132 wide, 18 from the breakdown; both stretch to the taller one.
  figures: { flexDirection: 'row', alignItems: 'stretch', gap: 18, marginTop: 14 },
  lead: { width: 132 },
  leadWell: { flex: 1, justifyContent: 'space-between' },
  rows: { flex: 1, minWidth: 0, justifyContent: 'center' },
  meter: { marginTop: 18 },
  spec: { marginTop: 10, fontVariant: ['tabular-nums'] },
});

