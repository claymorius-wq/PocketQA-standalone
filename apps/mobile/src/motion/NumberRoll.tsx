import { useEffect, useState } from 'react';
import { StyleSheet, Text, useWindowDimensions, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { DUR, SIGNATURE, useMotion, type Motion } from '../theme/motion';

// S5 number roll (Direction A §11.5): an odometer. Each digit is a column that rolls to its value
// over 560ms ease-roll, ones first, then 40ms per column leftwards. Only when the value changes
// while mounted: no count-up on mount, no "+50" floater. Reduced motion: the final value at once.
//
// Accessibility and e2e: the container carries the final value as its label, the rolling strips
// are hidden from assistive tech, and nothing is a live region (one change, no announcements).
// At rest the digits are a single Text, so the container's text is exactly `format(value) +
// suffix` (Playwright's toHaveText on the testID keeps working); the strips exist only mid-roll.

export type RollColumn = {
  kind: 'digit';
  /** 0 = ones, 1 = tens… */
  place: number;
  /** Cells top to bottom; '' is a leading blank (the column did not exist before). */
  cells: string[];
  /** Cell index shown before and after the roll; equal means the column does not move. */
  start: number;
  end: number;
};
export type RollPart = { kind: 'char'; char: string } | RollColumn;
export type RollPlan = { text: string; parts: RollPart[]; /** ms until the last column settles; 0 = nothing rolls */ duration: number };

const mod = (n: number, m: number) => ((n % m) + m) % m;

export const groupDigits = (n: number) => n.toLocaleString('en-US');

/** Only non-negative integers roll; anything else just shows its final value. */
export function canRoll(from: number, to: number): boolean {
  return Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= 0 && to >= 0 && from !== to;
}

function column(from: number, to: number, place: number): RollColumn {
  const unit = 10 ** place;
  const a = Math.floor(from / unit);
  const b = Math.floor(to / unit);
  const newDigit = b % 10;
  if (a === b) return { kind: 'digit', place, cells: [String(newDigit)], start: 0, end: 0 };
  const oldDigit = a % 10;
  const dir = b > a ? 1 : -1;
  const passes = Math.abs(b - a);
  // A real odometer would spin this column `passes` times; one revolution plus the remainder
  // reads the same and keeps the strip at most 21 cells (the board's 0 → 50 ones column: 0…9, 0).
  const steps = passes < 10 ? passes : 10 + mod(dir * (newDigit - oldDigit), 10);
  const leading = a === 0 && place > 0;
  const seq = Array.from({ length: steps + 1 }, (_, j) => (j === 0 && leading ? '' : String(mod(oldDigit + dir * j, 10))));
  // One cell past the target, so ease-roll's 6% overshoot shows the next digit instead of a gap.
  seq.push(String(mod(newDigit + dir, 10)));
  if (dir > 0) return { kind: 'digit', place, cells: seq, start: 0, end: steps };
  // Counting down rolls the other way: the strip is reversed and moves down.
  return { kind: 'digit', place, cells: seq.reverse(), start: steps + 1, end: 1 };
}

/** The roll from `from` to `to` as rendered by `format` (which must print every integer digit). */
export function planRoll(from: number, to: number, format: (n: number) => string = groupDigits): RollPlan {
  const text = format(to);
  const digitCount = text.replace(/[^0-9]/g, '').length;
  const parts: RollPart[] = [];
  let place = digitCount - 1;
  for (const char of text) {
    if (char >= '0' && char <= '9') {
      parts.push(column(from, to, place));
      place -= 1;
    } else {
      parts.push({ kind: 'char', char });
    }
  }
  const moving = parts.filter((p): p is RollColumn => p.kind === 'digit' && p.start !== p.end);
  const lastPlace = Math.max(-1, ...moving.map((p) => p.place));
  return { text, parts, duration: lastPlace < 0 ? 0 : lastPlace * SIGNATURE.rollColumnDelay + DUR.rise };
}

type RollState = { value: number; seq: number; plan: RollPlan | null };

export function NumberRoll({ value, format = groupDigits, suffix, style, suffixStyle, containerStyle, testID, accessibilityLabel, play = true }: {
  value: number;
  /** Prints the number; every digit of the integer must appear (grouping separators are fine). */
  format?: (n: number) => string;
  /** Text after the numeral, verbatim (include the leading space), e.g. " test credits". */
  suffix?: string | ((n: number) => string);
  /** Numeral style. Needs a numeric `lineHeight` (one column cell); without it the value never rolls. */
  style?: StyleProp<TextStyle>;
  suffixStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
  /** Defaults to the visible final text. */
  accessibilityLabel?: string;
  /** False holds the roll (e.g. while the screen is not in view). */
  play?: boolean;
}) {
  const motion = useMotion();
  const { fontScale } = useWindowDimensions();
  const lineHeight = StyleSheet.flatten(style)?.lineHeight;
  // Text lineHeight follows the OS font scale, so the cell does too.
  const cell = typeof lineHeight === 'number' ? lineHeight * fontScale : 0;

  const [state, setState] = useState<RollState>({ value, seq: 0, plan: null });
  if (state.value !== value) {
    const rolls = play && motion.play.numberRoll && cell > 0 && canRoll(state.value, value);
    const plan = rolls ? planRoll(state.value, value, format) : null;
    setState({ value, seq: state.seq + 1, plan: plan && plan.duration > 0 ? plan : null });
  }
  const { plan, seq } = state;
  useEffect(() => {
    if (!plan) return;
    const t = setTimeout(() => setState((s) => (s.seq === seq ? { ...s, plan: null } : s)), plan.duration);
    return () => clearTimeout(t);
  }, [plan, seq]);

  const tail = typeof suffix === 'function' ? suffix(value) : (suffix ?? '');
  const label = accessibilityLabel ?? `${format(value)}${tail}`;
  return (
    <View testID={testID} accessible accessibilityRole="text" accessibilityLabel={label} style={[styles.row, containerStyle]}>
      {plan ? (
        <View style={styles.digits} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {plan.parts.map((part, i) =>
            part.kind === 'char' || part.start === part.end ? (
              <Text key={`${seq}-${i}`} style={style}>
                {part.kind === 'char' ? part.char : part.cells[0]}
              </Text>
            ) : (
              <Column key={`${seq}-${i}`} part={part} cell={cell} style={style} motion={motion} />
            ),
          )}
        </View>
      ) : (
        <Text style={style}>{format(value)}</Text>
      )}
      {tail ? <Text style={suffixStyle}>{tail}</Text> : null}
    </View>
  );
}

function Column({ part, cell, style, motion }: { part: RollColumn; cell: number; style?: StyleProp<TextStyle>; motion: Motion }) {
  const y = useSharedValue(-part.start * cell);
  useEffect(() => {
    y.value = withDelay(part.place * SIGNATURE.rollColumnDelay, withTiming(-part.end * cell, motion.timing.roll));
  }, [y, part, cell, motion]);
  const strip = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return (
    <View style={{ height: cell, overflow: 'hidden' }}>
      <Animated.View style={strip}>
        {part.cells.map((c, j) => (
          <Text key={j} style={[style, { height: cell }]}>
            {c || '​'}
          </Text>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap' },
  digits: { flexDirection: 'row', alignItems: 'flex-start' },
});
