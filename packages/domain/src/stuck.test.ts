import { describe, expect, it } from 'vitest';
import { STUCK_AFTER_DAYS } from '@pocket-qa/contracts';
import { stuckReason } from './stuck';

const day = 24 * 3600 * 1000;
const submittedAt = 1_000_000;

describe('stuckReason', () => {
  it('is null for anything not submitted', () => {
    for (const status of ['consented', 'in_progress', 'approved', 'rejected', 'disputed', 'resolved', 'withdrawn'] as const) {
      expect(stuckReason({ status, submittedAtMs: submittedAt, builderStatus: 'deleted' }, submittedAt + 30 * day)).toBeNull();
    }
  });
  it('flags a submission whose builder is suspended or deleted, immediately', () => {
    expect(stuckReason({ status: 'submitted', submittedAtMs: submittedAt, builderStatus: 'suspended' }, submittedAt)).toBe('builder_inactive');
    expect(stuckReason({ status: 'submitted', submittedAtMs: submittedAt, builderStatus: 'deleted' }, submittedAt)).toBe('builder_inactive');
  });
  it('flags an active builder only after the overdue window', () => {
    const p = { status: 'submitted' as const, submittedAtMs: submittedAt, builderStatus: 'active' as const };
    expect(stuckReason(p, submittedAt + STUCK_AFTER_DAYS * day - 1)).toBeNull();
    expect(stuckReason(p, submittedAt + STUCK_AFTER_DAYS * day)).toBe('overdue');
  });
  it('treats a missing submit time as not overdue', () => {
    expect(stuckReason({ status: 'submitted', submittedAtMs: null, builderStatus: 'active' }, submittedAt + 99 * day)).toBeNull();
  });
});
