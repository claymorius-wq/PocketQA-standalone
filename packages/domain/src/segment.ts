import { DomainError } from './errors';

/**
 * Device-side lifecycle of one recorded or attached evidence segment. Every segment
 * starts `recorded` (unreviewed) and must be explicitly kept before it can upload.
 * `removed` is terminal: its bytes are deleted locally and never leave the device.
 */
export type SegmentState = 'recorded' | 'kept' | 'removed' | 'uploading' | 'uploaded' | 'failed';
export type SegmentAction = 'keep' | 'remove' | 'beginUpload' | 'uploadSucceeded' | 'uploadFailed';
export type Segment = { id: string; state: SegmentState };

const TRANSITIONS: Record<SegmentAction, Partial<Record<SegmentState, SegmentState>>> = {
  keep: { recorded: 'kept' },
  remove: { recorded: 'removed', kept: 'removed', failed: 'removed' },
  beginUpload: { kept: 'uploading', failed: 'uploading' },
  uploadSucceeded: { uploading: 'uploaded' },
  uploadFailed: { uploading: 'failed' },
};

export function transitionSegment(from: SegmentState, action: SegmentAction): SegmentState {
  const to = TRANSITIONS[action][from];
  if (!to) throw new DomainError('CONFLICT_STATE', `Cannot ${action} a ${from} segment.`);
  return to;
}

export function uploadQueue<T extends Segment>(segments: readonly T[]): T[] {
  return segments.filter((s) => s.state === 'kept' || s.state === 'failed');
}
