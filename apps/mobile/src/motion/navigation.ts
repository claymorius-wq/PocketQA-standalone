import { Animated, Easing } from 'react-native';
import type { StackNavigationOptions } from 'expo-router/js-stack';
import type { NativeStackNavigationOptions } from 'expo-router/native-stack';
import type { BottomTabNavigationOptions } from 'expo-router/tabs';
import { DUR, EASE, MOTION_DISTANCE, MOTION_LEVEL, type EaseName, type Motion } from '../theme/motion';

// Navigator presets (Direction A §11.3). React Navigation animates scenes with React Native's
// Animated and the native driver (UI thread on Android and iOS), so these use React Native's own
// Easing.bezier with the same Lens curves, not Reanimated's.

const rnEase = (name: EaseName) => {
  const [x1, y1, x2, y2] = EASE[name];
  return Easing.bezier(x1, y1, x2, y2);
};

/**
 * Bottom tabs (`<Tabs screenOptions>`): new tab content fades in and rises 6dp over 240ms
 * ease-lens; the tab bar is persistent chrome and never re-enters. Reduced: a 120ms fade.
 */
export function tabScreenOptions(motion: Motion): Pick<BottomTabNavigationOptions, 'animation' | 'transitionSpec' | 'sceneStyleInterpolator'> {
  const rise = motion.reduced ? 0 : MOTION_DISTANCE.tabContentRise;
  return {
    animation: 'fade',
    transitionSpec: { animation: 'timing', config: { duration: motion.reduced ? DUR.tick : DUR.swap, easing: rnEase('lens') } },
    // progress: -1 / 1 for a scene left or right of the focused one, 0 when focused.
    sceneStyleInterpolator: ({ current }) => ({
      sceneStyle: {
        opacity: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 1, 0] }),
        transform: [{ translateY: current.progress.interpolate({ inputRange: [-1, 0, 1], outputRange: [rise, 0, rise] }) }],
      },
    }),
  };
}

/**
 * Native stack (`<Stack screenOptions>`, the app's navigator). react-native-screens has no 24dp
 * push, so the closest native transition is a cross-fade; the incoming screen's own Entrance adds
 * the rise. `animationDuration` is honoured on iOS; Android's native fade runs its fixed ~150ms.
 * Use jsStackScreenOptions for the exact spec push.
 */
export function stackScreenOptions(motion: Motion): Pick<NativeStackNavigationOptions, 'animation' | 'animationDuration'> {
  return { animation: 'fade', animationDuration: motion.reduced ? DUR.tick : DUR.enter };
}

/**
 * JS stack (`expo-router/js-stack`), the exact spec push: the incoming screen slides 24dp from the
 * right and fades in over 320ms ease-lens; the outgoing one dims to 0.85 and drifts 12dp left.
 * Back reverses in 240ms ease-exit. Reduced: a 120ms fade, no translate. (The JS stack needs
 * react-native-gesture-handler as a direct dependency before it can replace the native stack.)
 */
export function jsStackScreenOptions(motion: Motion): Pick<StackNavigationOptions, 'transitionSpec' | 'cardStyleInterpolator'> {
  const push = motion.reduced ? 0 : MOTION_DISTANCE.pushIn;
  const drift = motion.reduced ? 0 : MOTION_DISTANCE.pushOutDrift;
  const dim = motion.reduced ? 1 : MOTION_LEVEL.pushOutDim;
  return {
    transitionSpec: {
      open: { animation: 'timing', config: { duration: motion.reduced ? DUR.tick : DUR.enter, easing: rnEase('lens') } },
      close: { animation: 'timing', config: { duration: motion.reduced ? DUR.tick : DUR.swap, easing: rnEase('exit') } },
    },
    cardStyleInterpolator: ({ current, next }) => {
      const enter = current.progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
      const under = next ? next.progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' }) : new Animated.Value(0);
      return {
        cardStyle: {
          opacity: Animated.multiply(enter, under.interpolate({ inputRange: [0, 1], outputRange: [1, dim] })),
          transform: [
            { translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [push, 0] }) },
            { translateX: under.interpolate({ inputRange: [0, 1], outputRange: [0, -drift] }) },
          ],
        },
      };
    },
  };
}
