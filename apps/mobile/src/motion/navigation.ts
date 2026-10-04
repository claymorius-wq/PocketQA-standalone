import { Animated, Easing } from 'react-native';
import type { StackNavigationOptions } from 'expo-router/js-stack';
import { DUR, EASE, MOTION_DISTANCE, MOTION_LEVEL, type EaseName, type Motion } from '../theme/motion';

// Navigator presets (Direction A §11.3). The app's navigators run `animation: 'none'` and each
// arriving screen plays its own push / back / tab / replace on the UI thread (src/motion/entrance.ts,
// ADR 0006). This JS-stack preset is kept as the option should the app move to expo-router/js-stack.
// React Navigation animates JS-stack cards with React Native's Animated and the native driver, so
// it uses React Native's own Easing.bezier with the same Lens curves, not Reanimated's.

const rnEase = (name: EaseName) => {
  const [x1, y1, x2, y2] = EASE[name];
  return Easing.bezier(x1, y1, x2, y2);
};

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
