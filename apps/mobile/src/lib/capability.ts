import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';
import { PREVIEW_BUILD } from '../preview/demoAccounts';
import { availableWallets } from '../wallet/registry';

export type Capability = { available: true } | { available: false; reason: string };
/** How the native recorder captures OTHER apps: Android MediaProjection, or the iPhone system broadcast extension. */
export type RecordingCapability = { available: true; mode: 'projection' | 'broadcast' } | { available: false; reason: string };

/** Native module name exported by modules/screen-capture (Phase 5). */
export const SCREEN_CAPTURE_MODULE = 'PocketQaScreenCapture';

/**
 * Capability matrix (ADR 0001 §7; docs/plans/native-screen-voice-recording.md). The native app
 * records OTHER apps with microphone narration: on Android 10+ with the MediaProjection module, on
 * iPhone with the system broadcast extension (both shipped in the native builds). Everywhere else
 * the UI says so plainly and offers attaching existing screenshots or clips instead.
 */
export function recordingCapability(os: string = Platform.OS, version: number | string = Platform.Version, hasModule = () => !!requireOptionalNativeModule(SCREEN_CAPTURE_MODULE)): RecordingCapability {
  if (os === 'web') return { available: false, reason: 'Screen recording isn’t available in the web preview. Attach screenshots or clips from your files instead.' };
  if (os === 'ios') {
    if (!hasModule()) return { available: false, reason: 'Recording other apps needs the Pocket QA iPhone app with its screen broadcast extension. Attach screenshots or clips instead.' };
    return { available: true, mode: 'broadcast' };
  }
  if (os !== 'android') return { available: false, reason: 'Screen recording is unavailable on this device.' };
  if (Number(version) < 29) return { available: false, reason: 'Screen recording needs Android 10 or newer.' };
  if (!hasModule()) return { available: false, reason: 'This build doesn’t include the screen recorder. Use an Android dev build of Pocket QA.' };
  return { available: true, mode: 'projection' };
}

/**
 * Wallet linking: Android uses Mobile Wallet Adapter; web uses a Wallet Standard browser
 * extension when one is installed (ADR 0005 §4); iOS has neither in this version.
 */
export function walletCapability(os: string = Platform.OS, webWallets: () => number = () => availableWallets().length, sharedPreview: boolean = PREVIEW_BUILD): Capability {
  if (os === 'android') return { available: true };
  if (os === 'web') {
    // Shared demo accounts: a visitor's real wallet must never be attached to them.
    if (sharedPreview) return { available: false, reason: 'Wallet linking is not available in the shared preview.' };
    return webWallets() > 0 ? { available: true } : { available: false, reason: 'No Solana wallet extension found. Install one to link a devnet wallet.' };
  }
  return { available: false, reason: 'Mobile Wallet Adapter is Android-only. Wallet linking isn’t available on this device.' };
}

/** Signing a devnet demo transfer needs Mobile Wallet Adapter: Android only (web links but never sends). */
export function transferSignCapability(os: string = Platform.OS): Capability {
  return os === 'android' ? { available: true } : { available: false, reason: 'Signing a devnet transfer needs the Android app with your linked wallet.' };
}
