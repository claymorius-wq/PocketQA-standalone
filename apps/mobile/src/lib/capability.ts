import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

export type Capability = { available: true } | { available: false; reason: string };

/** Native module name exported by modules/screen-capture (Phase 5). */
export const SCREEN_CAPTURE_MODULE = 'PocketQaScreenCapture';

/**
 * Capability matrix (ADR 0001 §7). Recording needs an Android 10+ dev build that includes
 * the local MediaProjection module; everywhere else the UI says so plainly and offers
 * attaching existing screenshots or clips instead.
 */
export function recordingCapability(os: string = Platform.OS, version: number | string = Platform.Version, hasModule = () => !!requireOptionalNativeModule(SCREEN_CAPTURE_MODULE)): Capability {
  if (os === 'web') return { available: false, reason: 'Screen recording isn’t available in the web preview. Attach screenshots or clips from your files instead.' };
  if (os === 'ios') return { available: false, reason: 'Recording other apps isn’t supported on iOS in this version. Attach screenshots or clips instead.' };
  if (os !== 'android') return { available: false, reason: 'Screen recording is unavailable on this device.' };
  if (Number(version) < 29) return { available: false, reason: 'Screen recording needs Android 10 or newer.' };
  if (!hasModule()) return { available: false, reason: 'This build doesn’t include the screen recorder. Use an Android dev build of Pocket QA.' };
  return { available: true };
}

export function walletCapability(os: string = Platform.OS): Capability {
  if (os === 'android') return { available: true };
  return {
    available: false,
    reason: os === 'web' ? 'Wallet linking uses Mobile Wallet Adapter, which works only in the Android app.' : 'Mobile Wallet Adapter is Android-only. Wallet linking isn’t available on this device.',
  };
}
