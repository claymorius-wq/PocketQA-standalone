import { describe, expect, it } from 'vitest';
import { DomainError } from './errors';
import { transitionSegment, uploadQueue, type Segment, type SegmentAction, type SegmentState } from './segment';

const ALL: SegmentState[] = ['recorded', 'kept', 'removed', 'uploading', 'uploaded', 'failed'];
const ACTIONS: SegmentAction[] = ['keep', 'remove', 'beginUpload', 'uploadSucceeded', 'uploadFailed'];
const ALLOWED: Record<string, SegmentState> = {
  'recorded:keep': 'kept',
  'recorded:remove': 'removed',
  'kept:remove': 'removed',
  'kept:beginUpload': 'uploading',
  'failed:beginUpload': 'uploading',
  'failed:remove': 'removed',
  'uploading:uploadSucceeded': 'uploaded',
  'uploading:uploadFailed': 'failed',
};

describe('evidence segment state machine (device side)', () => {
  for (const from of ALL) {
    for (const action of ACTIONS) {
      const key = `${from}:${action}`;
      if (ALLOWED[key]) {
        it(`${key} → ${ALLOWED[key]}`, () => expect(transitionSegment(from, action)).toBe(ALLOWED[key]));
      } else {
        it(`${key} is rejected`, () => expect(() => transitionSegment(from, action)).toThrowError(DomainError));
      }
    }
  }

  it('a removed segment can never re-enter the upload path', () => {
    for (const action of ACTIONS) {
      expect(() => transitionSegment('removed', action)).toThrowError(DomainError);
    }
  });
});

describe('uploadQueue', () => {
  const seg = (id: string, state: SegmentState): Segment => ({ id, state });

  it('contains only kept or previously failed segments, never removed or unreviewed ones', () => {
    const queue = uploadQueue([
      seg('a', 'recorded'),
      seg('b', 'kept'),
      seg('c', 'removed'),
      seg('d', 'failed'),
      seg('e', 'uploaded'),
      seg('f', 'uploading'),
    ]);
    expect(queue.map((s) => s.id)).toEqual(['b', 'd']);
  });
});
