import { transitionSegment, uploadQueue, type SegmentAction, type SegmentState } from '@pocket-qa/domain';

/**
 * A piece of evidence that exists only on this device until the tester keeps it and
 * uploads it. Removing a segment deletes it locally; it can never re-enter the queue.
 */
export type LocalSegment = {
  id: string;
  state: SegmentState;
  kind: 'screen_recording' | 'screenshot';
  name: string;
  mimeType: string;
  size: number | null;
  uri: string;
  /** Web only: the picked File, sent as the multipart body. */
  file?: Blob;
  taskId?: string;
  durationMs?: number;
  capturedOn: 'android' | 'ios' | 'web';
  error?: string;
};

export function applySegment(list: LocalSegment[], id: string, action: SegmentAction, patch: Partial<LocalSegment> = {}): LocalSegment[] {
  return list.map((s) => (s.id === id ? { ...s, ...patch, state: transitionSegment(s.state, action) } : s));
}

/**
 * Removes a segment only if its current state allows it, and deletes the local copy only
 * after the transition succeeded. An item already uploading can't be removed (the
 * button may still be on screen for one render), so nothing is deleted and nothing changes.
 */
export function removeSegment(list: LocalSegment[], id: string, deleteLocal: (s: LocalSegment) => void): LocalSegment[] {
  const seg = list.find((s) => s.id === id);
  if (!seg || !['recorded', 'kept', 'failed'].includes(seg.state)) return list;
  const next = applySegment(list, id, 'remove', { uri: '', file: undefined });
  deleteLocal(seg);
  return next;
}

export type Uploader = (segment: LocalSegment) => Promise<unknown>;
export type Update = (fn: (list: LocalSegment[]) => LocalSegment[]) => void;

/**
 * Uploads every kept (or previously failed) segment, one at a time. It always works on
 * the live list: before each item it re-reads the current state and skips anything the
 * tester removed meanwhile, and every transition is a functional update so it never
 * overwrites a concurrent removal. Only `uploadQueue` decides what is eligible, so
 * removed or unreviewed segments are never sent (pinned by __tests__/upload-queue.test.ts).
 */
export async function uploadKept(get: () => LocalSegment[], upload: Uploader, update: Update): Promise<LocalSegment[]> {
  const ids = uploadQueue(get()).map((s) => s.id);
  for (const id of ids) {
    const current = get().find((s) => s.id === id);
    if (!current || (current.state !== 'kept' && current.state !== 'failed')) continue;
    update((l) => applySegment(l, id, 'beginUpload', { error: undefined }));
    try {
      await upload(current);
      update((l) => applySegment(l, id, 'uploadSucceeded'));
    } catch (e) {
      update((l) => applySegment(l, id, 'uploadFailed', { error: e instanceof Error ? e.message : 'Upload failed' }));
    }
  }
  return get();
}
