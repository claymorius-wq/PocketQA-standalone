import { requireOptionalNativeModule } from 'expo-modules-core';
import { SCREEN_CAPTURE_MODULE } from '../lib/capability';

/** Result of one consented MediaProjection session (modules/screen-capture). */
export type RecordedClip = { uri: string; durationMs: number; sizeBytes: number; mimeType: 'video/mp4' };

type NativeRecorder = {
  /** Shows the OS consent dialog every time; rejects if the user declines. */
  startAsync(): Promise<void>;
  stopAsync(): Promise<RecordedClip>;
  isRecording(): boolean;
  /** Stops an active session, if any, and deletes its file (screen left mid-recording). */
  discardAsync(): Promise<void>;
  /** Deletes every recording file except an active session's (a system stop may have landed just before unmount). */
  purgeAsync(): Promise<void>;
  addListener?(event: 'onStopped', cb: (e: { reason: 'user' | 'system' | 'error'; clip: RecordedClip | null }) => void): { remove(): void };
};

export function nativeRecorder(): NativeRecorder | null {
  return requireOptionalNativeModule<NativeRecorder>(SCREEN_CAPTURE_MODULE);
}
