import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { useAnimatedStyle, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { DUR, useMotion } from '../theme/motion';

// Sheet motion (Direction A §11.4): the backdrop 0 → 1 (its colour carries the 0.62) over 320ms
// ease-lens; the sheet rises from just below its own height on spring-sheet (web: 420ms
// ease-lens). Close: 240ms ease-exit for the sheet and backdrop. Reduced motion: the sheet and
// backdrop fade 120ms in place. The key pool's 0.4 behind the sheet and the commit sheet's pilot
// floor are driven by ConfirmSheet through the ground's KeyLight and useUplight.

/** How far below its own height the sheet starts (the board's `calc(100% + 30px)`). */
export const SHEET_CLEARANCE = 30;

export type SheetMotion = {
  /** Render the sheet (its Modal) while true: it stays mounted through the exit animation. */
  mounted: boolean;
  /** Exit in progress: give the backdrop and sheet `pointerEvents="none"` so nothing is caught. */
  closing: boolean;
  /** Put on the sheet panel; the rise starts once its height is known. */
  onSheetLayout: (e: LayoutChangeEvent) => void;
  backdropStyle: ReturnType<typeof useAnimatedStyle>;
  sheetStyle: ReturnType<typeof useAnimatedStyle>;
};

/**
 * Drives ConfirmSheet (and any bottom sheet). Use with `<Modal transparent animationType="none">`.
 * `animateExit: false` unmounts the moment `visible` turns false, for callers that cannot keep a
 * Modal up for the 240ms exit.
 */
export function useSheetMotion({ visible, animateExit = true }: { visible: boolean; animateExit?: boolean }): SheetMotion {
  const motion = useMotion();
  const { height: screenHeight } = useWindowDimensions();
  const [mounted, setMounted] = useState(visible);
  if (visible && !mounted) setMounted(true);
  if (!visible && mounted && !animateExit) setMounted(false);

  const backdrop = useSharedValue(0);
  // Off screen until the panel is measured, so the first frame never shows it in place.
  const offset = useSharedValue(screenHeight);
  const opacity = useSharedValue(1);
  const height = useRef(0);
  const laidOut = useRef(false);

  const open = useCallback(
    (fresh: boolean) => {
      const start = height.current + SHEET_CLEARANCE;
      backdrop.value = withTiming(1, motion.timing.enter);
      if (motion.reduced) {
        offset.value = 0;
        opacity.value = fresh ? withSequence(withTiming(0, { duration: 0 }), withTiming(1, motion.timing.sheetOpen)) : withTiming(1, motion.timing.sheetOpen);
      } else {
        opacity.value = 1;
        const rise = Platform.OS === 'web' || !motion.spring.sheet ? withTiming(0, motion.timing.sheetOpen) : withSpring(0, motion.spring.sheet);
        offset.value = fresh ? withSequence(withTiming(start, { duration: 0 }), rise) : rise;
      }
    },
    [backdrop, offset, opacity, motion],
  );

  const onSheetLayout = useCallback(
    (e: LayoutChangeEvent) => {
      height.current = e.nativeEvent.layout.height;
      if (laidOut.current) return;
      laidOut.current = true;
      if (visible) open(true);
    },
    [visible, open],
  );

  useEffect(() => {
    if (!mounted) {
      laidOut.current = false;
      return;
    }
    if (visible) {
      // Reopened mid-exit: rise again from where the panel is.
      if (laidOut.current) open(false);
      return;
    }
    const close = motion.timing.sheetClose;
    backdrop.value = withTiming(0, close);
    if (motion.reduced) opacity.value = withTiming(0, close);
    else offset.value = withTiming(height.current + SHEET_CLEARANCE, close);
    const t = setTimeout(() => setMounted(false), close.duration ?? DUR.swap);
    return () => clearTimeout(t);
  }, [visible, mounted, open, motion, backdrop, opacity, offset]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdrop.value }));
  const sheetStyle = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ translateY: offset.value }] }));
  return { mounted, closing: mounted && !visible, onSheetLayout, backdropStyle, sheetStyle };
}
