import { useEffect, useRef, useState } from 'react';
import { StyleSheet, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Defs, Rect } from 'react-native-svg';
import { UplightFloor, useUplight, type Uplight } from '../../glass';
import { GradientDef, HIDDEN, PASS_THROUGH, useSvgId } from '../../glass/paint';
import { UPLIGHT } from '../../theme/motion';
import { useTheme } from '../../theme/ThemeProvider';
import type { RadialGradientSpec } from '../../theme/tokens';

// The two Uplight placements (CONSISTENCY.md §U, Direction A §10.1 rule 4). The light is attached
// to its subject; there is no third mode.
// - Mode A (in-flow subject: the Credits balance, the recorder card, the Approved notice): the
//   subject carries the uplit layer itself (GlassSurface `uplight`) and adds UnderGlow, centred on
//   its bottom edge. Keep ≥ 32dp of ground below the subject before the next element.
// - Mode B (the subject is the last thing on its surface: a sheet's confirm, the Finish dock):
//   CommitUplight, the §10.3 floor anchored to that surface's bottom edge at the subject's x,
//   300dp tall so the 260dp pool fades out before the box edge.
// Destructive, pending and failing states are never lit.

/** `upGlow` (§10.3 under-glow): closest-side, so it reaches 0 inside its own box and no edge can show. */
const UNDER_GLOW: RadialGradientSpec = {
  kind: 'radial',
  cx: 0.5,
  cy: 0.5,
  rx: 0.5,
  ry: 0.5,
  units: 'fraction',
  stops: [
    { offset: 0, color: '#EEF2FF', opacity: 0.55 },
    { offset: 0.38, color: '#8DB0FF', opacity: 0.3 },
    { offset: 0.7, color: '#4E70FF', opacity: 0.1 },
    { offset: 1, color: '#4E70FF', opacity: 0 },
  ],
};
const GLOW_HEIGHT = 56;

/**
 * Mode A under-glow. Render it as the first child of a position-relative wrapper that also holds
 * the subject, so it paints under the subject and spills 28dp below its bottom edge. Its opacity
 * is the moment's intensity u. Light theme (glass disabled): nothing.
 */
export function UnderGlow({ light, style }: { light: Uplight; style?: StyleProp<ViewStyle> }) {
  const id = useSvgId('ug');
  const [w, setW] = useState(0);
  const glow = useAnimatedStyle(() => ({ opacity: light.u.value }));
  if (!light.enabled) return null;
  const onLayout = (e: LayoutChangeEvent) => {
    const width = e.nativeEvent.layout.width;
    setW((prev) => (prev === width ? prev : width));
  };
  return (
    <Animated.View {...HIDDEN} onLayout={onLayout} style={[styles.glow, PASS_THROUGH, glow, style]}>
      {w > 0 ? (
        <Svg width={w} height={GLOW_HEIGHT}>
          <Defs>
            <GradientDef id={id} spec={UNDER_GLOW} box={{ x: 0, y: 0, w, h: GLOW_HEIGHT }} />
          </Defs>
          <Rect x={0} y={0} width={w} height={GLOW_HEIGHT} fill={`url(#${id})`} />
        </Svg>
      ) : null}
    </Animated.View>
  );
}

/** Mode B floors are never shorter than this: the pool's vertical radius is 260 (§U). */
export const MODE_B_HEIGHT = 300;

/**
 * Mode B: the light from below anchored at the bottom edge of the surface it belongs to, at the
 * subject's x (a fraction of the surface width). Place it first inside that surface. The motes
 * ride a Commit pass only (UplightFloor draws them for `pass` changes and never at rest).
 */
export function CommitUplight({ light, x = 0.75, style }: { light: Uplight; x?: number; style?: StyleProp<ViewStyle> }) {
  return <UplightFloor light={light} x={x} height={MODE_B_HEIGHT} style={style} />;
}

/** What a commit sheet's request is doing. */
export type CommitStatus = 'idle' | 'pending' | 'error' | 'success';

/** The Commit pass starts no sooner than this after the press, even when the response is faster (C4). */
export const PASS_MIN_AFTER_PRESS = 280;
/** The sheet leaves this long after the pass starts; the tail is handed to the subject (C4, §10.3). */
export const PASS_LEAVE_AFTER = 680;

/**
 * U7, the commit sheet's light (Approve and credit…, Publish), as one state machine (C4):
 * - open: the pilot floor rises to 0.55 over 560ms ease-uplight, 260ms after the sheet starts;
 * - pending: the pilot holds at 0.55 (the light never rises while a request is pending);
 * - error: the floor is cut to 0 in 180ms ease-exit, and it comes back only on the next open;
 * - success: the Commit pass (0.55 → 1, hold 120, → 0 over 700) starts at max(280ms after the
 *   press, the response); `onLeave` fires 680ms after it starts, when the sheet should close.
 * Reduced motion: the pilot shows at rest, Commit shows nothing, and `onLeave` fires at once.
 * `status` mirrors the screen's mutation (isPending / isError / isSuccess); this hook adds no
 * business logic of its own.
 */
export function useCommitUplight({ open, status, onLeave }: { open: boolean; status: CommitStatus; onLeave?: () => void }): Uplight {
  const { motion } = useTheme();
  // Derived from prop changes during render (React's documented pattern), so the pass delay is
  // fixed once, at the moment the response arrives.
  const [s, setS] = useState({ open, status, failed: false, pressedAt: null as number | null, passDelay: 0 });
  if (s.open !== open || s.status !== status) {
    const now = Date.now();
    const pressedAt = status === 'pending' ? (s.status === 'pending' ? s.pressedAt : now) : status === 'idle' ? null : s.pressedAt;
    setS({
      open,
      status,
      // A closed sheet forgets its failure: the pilot returns on the next open.
      failed: open && (s.failed || status === 'error'),
      pressedAt,
      passDelay: status === 'success' && s.status !== 'success' ? Math.max(0, PASS_MIN_AFTER_PRESS - (pressedAt === null ? PASS_MIN_AFTER_PRESS : now - pressedAt)) : s.passDelay,
    });
  }
  const { failed, passDelay } = s;
  const success = status === 'success';
  const light = useUplight(success ? 'commit' : 'pilot', open && !failed && status !== 'error', {
    level: UPLIGHT.pilot.sheet,
    delay: success ? passDelay : UPLIGHT.pilot.delay,
  });

  const leave = useRef(onLeave);
  useEffect(() => {
    leave.current = onLeave;
  }, [onLeave]);
  useEffect(() => {
    if (!success) return;
    const wait = motion.play.uplightCommit ? passDelay + PASS_LEAVE_AFTER : 0;
    const t = setTimeout(() => leave.current?.(), wait);
    return () => clearTimeout(t);
    // One leave per success; passDelay is fixed at the moment success arrives.
  }, [success]);
  return light;
}

const styles = StyleSheet.create({
  glow: { position: 'absolute', left: '4%', right: '4%', bottom: -GLOW_HEIGHT / 2, height: GLOW_HEIGHT },
});
