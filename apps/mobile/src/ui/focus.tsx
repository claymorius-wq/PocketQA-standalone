import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useMotion } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';

// The one focus ring (CONSISTENCY C1, spec §8): lens-blue, 2 wide, 2 outside the element, following
// its radius. It is the key light's colour, so it is one of the few things allowed to emit light.
//
// Web: CSS only, injected once (FocusRingStyles): an `outline` on `:focus-visible`, so it never
// replaces a surface's own glass shadows and never shows for a mouse or touch press. Inputs keep
// their well focus rim instead. No JS focus state, no overlay.
//
// Native (RN adaptation, C1 "RN: on focus, a 2px border overlay with inset −4 and radius r + 4"):
// Pressable reports keyboard / D-pad focus through onFocus/onBlur, and useFocusRing draws that
// overlay, mounted on the first focus and faded over dur-tick. Screen-reader (TalkBack, VoiceOver)
// focus keeps the platform's own indicator: the OS draws it and apps cannot restyle it.
//
// Each focusable passes its own radius: buttons 18, tab cells 18, Back 16, cards 24, segments 14.

export const FOCUS_RING = { width: 2, offset: 2 } as const;
/** The native overlay sits this far outside the element (offset + width). */
export const FOCUS_RING_OUTSET = FOCUS_RING.width + FOCUS_RING.offset;

/**
 * The C1 rules verbatim, with the colour as a custom property so the light theme can darken it
 * (#3442C2 keeps 3:1 on its flat surfaces; the dark ring is the spec's #6F9BFF).
 */
export function focusRingCss(color: string): string {
  return [
    `:root { --lens-focus: ${color}; }`,
    `:where(a, button, summary, [role="radio"], [role="tab"], [role="switch"], [tabindex]:not([tabindex="-1"])):focus-visible { outline: ${FOCUS_RING.width}px solid var(--lens-focus, #6F9BFF) !important; outline-offset: ${FOCUS_RING.offset}px !important; }`,
    ':where(a, button, [role="radio"]):focus:not(:focus-visible) { outline: none; }',
    ':where(input, textarea):focus-visible { outline: none; }',
  ].join('\n');
}

const STYLE_ID = 'lens-focus-ring';

/** Web: installs the focus-ring stylesheet once for the whole app (rendered by the root layout). */
export function FocusRingStyles() {
  const { colors } = useTheme();
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    let el = document.getElementById(STYLE_ID);
    if (!el) {
      el = document.createElement('style');
      el.id = STYLE_ID;
      document.head.appendChild(el);
    }
    el.textContent = focusRingCss(colors.lensBlue);
  }, [colors.lensBlue]);
  return null;
}

/**
 * The native focus overlay for one focusable with corner radius `radius`. Spread `onFocus` and
 * `onBlur` on the Pressable and render `ring` as its last child (the Pressable must not clip).
 * On web both handlers are undefined and `ring` is null: the stylesheet draws the ring.
 */
export function useFocusRing(radius: number) {
  // Plain state only: the shared value and animated style live in the overlay, which mounts on the
  // first focus, so a control that is never focused registers no UI-thread mapper (Seeker budget:
  // a Discover list of study cards would otherwise add one per card).
  const [armed, setArmed] = useState(false);
  const [focused, setFocused] = useState(false);
  const onFocus = useCallback(() => {
    setArmed(true);
    setFocused(true);
  }, []);
  const onBlur = useCallback(() => setFocused(false), []);
  if (Platform.OS === 'web') return { onFocus: undefined, onBlur: undefined, ring: null };
  return { onFocus, onBlur, ring: armed ? <FocusRingOverlay radius={radius} focused={focused} /> : null };
}

/** The native overlay itself, faded over dur-tick; mounted on the first focus and then kept. */
function FocusRingOverlay({ radius, focused }: { radius: number; focused: boolean }) {
  const { colors } = useTheme();
  const motion = useMotion();
  const on = useSharedValue(0);
  useEffect(() => {
    on.value = withTiming(focused ? 1 : 0, motion.timing.tick);
  }, [focused, on, motion]);
  const ringStyle = useAnimatedStyle(() => ({ opacity: on.value }));
  return <Animated.View testID="focus-ring" style={[styles.ring, { borderRadius: radius + FOCUS_RING_OUTSET, borderColor: colors.lensBlue }, ringStyle]} />;
}

/**
 * A Pressable that carries the focus ring: its corner radius is set to `ringRadius` (so the web
 * outline follows it; the Pressable draws nothing itself) and the native overlay is its last child.
 */
export function FocusPressable({ ringRadius, style, onFocus, onBlur, children, ...rest }: Omit<PressableProps, 'children' | 'style'> & {
  ringRadius: number;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const ring = useFocusRing(ringRadius);
  return (
    <Pressable
      {...rest}
      onFocus={(e) => {
        ring.onFocus?.();
        onFocus?.(e);
      }}
      onBlur={(e) => {
        ring.onBlur?.();
        onBlur?.(e);
      }}
      style={[style, { borderRadius: ringRadius }]}
    >
      {children}
      {ring.ring}
    </Pressable>
  );
}

const RING: ViewStyle = {
  position: 'absolute',
  top: -FOCUS_RING_OUTSET,
  right: -FOCUS_RING_OUTSET,
  bottom: -FOCUS_RING_OUTSET,
  left: -FOCUS_RING_OUTSET,
  borderWidth: FOCUS_RING.width,
  pointerEvents: 'none',
};

const styles = StyleSheet.create({ ring: RING });
