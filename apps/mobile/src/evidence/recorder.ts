import { requireOptionalNativeModule } from 'expo-modules-core';
import { SCREEN_CAPTURE_MODULE } from '../lib/capability';

/** Result of one consented recording session (modules/screen-capture): screen video + microphone audio. */
export type RecordedClip = { uri: string; durationMs: number; sizeBytes: number; mimeType: 'video/mp4' };
/** Why a session ended: user Stop, the system (chip, lock, revoke), microphone loss, an error, or a cap. */
export type StopReason = 'user' | 'system' | 'mic' | 'error' | 'limit';

type NativeRecorder = {
  /**
   * Android: shows the OS consent dialog every time; rejects if the user declines or the
   * microphone permission is missing. `tag` (the participation id) labels the clip so a clip that
   * finishes while the tester is in another app is handed back to this session.
   */
  startAsync(tag: string): Promise<void>;
  /** iPhone: opens the system broadcast picker for the Pocket QA extension (user taps Start Broadcast there). */
  showBroadcastPicker?(tag: string): void;
  /** Finished clips for this tag not yet handed to JS (they survive app switches and JS reloads). */
  takePendingAsync?(tag: string): Promise<RecordedClip[]>;
  stopAsync(): Promise<RecordedClip>;
  isRecording(): boolean;
  /** Stops an active session, if any, and deletes its file (screen left mid-recording). */
  discardAsync(): Promise<void>;
  /** Deletes every recording file except an active session's (a system stop may have landed just before unmount). */
  purgeAsync(): Promise<void>;
  addListener?(event: 'onStopped', cb: (e: { reason: StopReason; clip: RecordedClip | null }) => void): { remove(): void };
};

export function nativeRecorder(): NativeRecorder | null {
  return requireOptionalNativeModule<NativeRecorder>(SCREEN_CAPTURE_MODULE);
}
