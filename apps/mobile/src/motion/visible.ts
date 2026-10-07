import { AppState } from 'react-native';

/**
 * Whether Pocket QA is off screen (another app in front, the screen off, a call). An entrance that
 * starts then renders settled: nobody can see it, and on Android a Reanimated timing started with no
 * frames running left the element at its first frame, invisible (emulator, 2026-10-05: a clip row and
 * its "Recording stopped" notice added while a phone call took the microphone).
 */
export function appOffScreen(): boolean {
  const st = AppState.currentState;
  return st === 'background' || st === 'inactive';
}
