import { Children, isValidElement, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { DUR } from '../../theme/motion';
import { useTheme } from '../../theme/ThemeProvider';

// The FLIP glide (A-Session evidence list; also S7/S8's "item layout only" moves): when an item
// leaves, it fades out in place (240ms ease-exit) and is then removed; the items below it glide
// up to their new places (240ms ease-lens) instead of jumping. An item that arrives fades in.
//
// RN adaptation: the board measures every row before and after the change (FLIP). Here each item
// remembers its last laid-out y and, when a new layout moves it, starts from the old position
// with a translateY that settles to 0 on the UI thread. Only transform and opacity animate; the
// list container never runs a layout animation (ADR 0005 budget). The glide starts on the item's
// first layout after the move, so the first frame at the new place can show before it runs on
// slow devices: verify on the Seeker. Reduced motion: items leave at once and nothing glides.

type Item = { key: string; element: ReactElement; leaving: boolean; fresh?: boolean };
const keyOf = (e: ReactElement) => String(e.key ?? '');

/**
 * A column of keyed children whose removals exit and whose survivors glide (FLIP). Children
 * must carry stable keys (the segment id). `gap` is the column gap between items.
 */
export function GlideList({ children, gap = 10, style, testID }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle>; testID?: string }) {
  const { motion } = useTheme();
  const incoming = Children.toArray(children).filter(isValidElement) as ReactElement[];
  const [items, setItems] = useState<Item[]>(() => incoming.map((element) => ({ key: keyOf(element), element, leaving: false })));

  // Merge only when the set or order of keys changes (a parent re-render passes a new children array
  // every time, which must not cost a second render pass): keep order, mark vanished keys as leaving
  // (they stay where they were until they fade). Elements are read fresh at render time below.
  const signature = incoming.map((e) => e.key).join('|');
  const [lastSig, setLastSig] = useState(signature);
  if (lastSig !== signature) {
    setLastSig(signature);
    setItems((prev) => {
      const next: Item[] = [];
      const present = new Map(incoming.map((e) => [keyOf(e), e]));
      let i = 0;
      for (const p of prev) {
        const now = present.get(p.key);
        if (now) {
          // Insert any new items that precede this survivor in the incoming order.
          while (i < incoming.length && keyOf(incoming[i]!) !== p.key) {
            const e = incoming[i]!;
            if (!prev.some((q) => q.key === keyOf(e))) next.push({ key: keyOf(e), element: e, leaving: false, fresh: true });
            i++;
          }
          next.push({ key: p.key, element: now, leaving: false });
          i++;
        } else if (!motion.reduced) {
          next.push({ ...p, leaving: true });
        }
      }
      // Anything not placed yet (appended, or moved) goes at the end, in incoming order.
      for (const e of incoming) {
        if (!next.some((q) => q.key === keyOf(e))) next.push({ key: keyOf(e), element: e, leaving: false, fresh: true });
      }
      return next;
    });
  }

  const drop = (key: string) => setItems((prev) => prev.filter((p) => !(p.key === key && p.leaving)));
  // Present items render the element from this render; leaving items keep the one they had.
  const byKey = new Map(incoming.map((e) => [keyOf(e), e]));

  return (
    <View testID={testID} style={[{ gap }, style]}>
      {items.map((it) => (
        <GlideItem key={it.key} leaving={it.leaving} fresh={!!it.fresh} onGone={() => drop(it.key)}>
          {it.leaving ? it.element : (byKey.get(it.key) ?? it.element)}
        </GlideItem>
      ))}
    </View>
  );
}

function GlideItem({ children, leaving, fresh, onGone }: { children: ReactNode; leaving: boolean; fresh: boolean; onGone: () => void }) {
  const { motion } = useTheme();
  // An item added after the list mounted rises in (10dp, 320ms ease-lens; reduced: a 120ms fade).
  const y = useSharedValue(fresh ? motion.entrance.rise : 0);
  const opacity = useSharedValue(fresh ? 0 : 1);
  const lastY = useRef<number | null>(null);

  useEffect(() => {
    if (!leaving) {
      // Arriving, or coming back while it was still fading out.
      if (opacity.value < 1) opacity.value = withTiming(1, motion.timing.enter);
      if (fresh) y.value = withTiming(0, motion.timing.enter);
      return;
    }
    opacity.value = withTiming(0, { ...motion.timing.exit, duration: DUR.swap });
    const t = setTimeout(onGone, DUR.swap);
    return () => clearTimeout(t);
    // onGone is recreated each render; the exit starts once.
  }, [leaving]);

  const onLayout = (e: LayoutChangeEvent) => {
    const next = e.nativeEvent.layout.y;
    const prev = lastY.current;
    lastY.current = next;
    if (prev === null || prev === next || motion.reduced) return;
    // Start where the item was and glide to where it is now.
    y.value = prev - next + y.value;
    y.value = withTiming(0, { ...motion.timing.swap, duration: DUR.swap });
  };
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: y.value }] }));
  return (
    <Animated.View
      onLayout={onLayout}
      style={[style, leaving ? styles.leaving : null]}
      importantForAccessibility={leaving ? 'no-hide-descendants' : 'auto'}
      accessibilityElementsHidden={leaving}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // A leaving item no longer takes touches (it is already removed from the data).
  leaving: { pointerEvents: 'none' },
});
