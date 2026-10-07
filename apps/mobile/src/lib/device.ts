import { Platform } from 'react-native';
import type { DeviceProfile } from '@pocket-qa/contracts';

/** This device as a profile (Settings' starting point when none is saved, and "Use this phone's details"). */
export function guessDevice(): DeviceProfile {
  const os = Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'web';
  return {
    platform: os,
    osVersion: os === 'web' ? 'Browser' : String(Platform.Version),
    androidApiLevel: os === 'android' ? Number(Platform.Version) : null,
    model: os === 'web' ? 'Web preview' : 'My phone',
    languages: ['en'],
  };
}

/**
 * On a NATIVE app, whether the saved profile was evidently saved from another device: another
 * platform, an Android profile without this phone's API level, or the web preview's model. A
 * profile saved on the web would otherwise keep hiding every study with a minimum API level.
 * Always false on the web (a browser can't tell which phone it represents).
 */
export function profileMismatch(saved: DeviceProfile): boolean {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') return false;
  if (saved.platform !== Platform.OS) return true;
  if (saved.model === 'Web preview') return true;
  return Platform.OS === 'android' && saved.androidApiLevel !== Number(Platform.Version);
}
