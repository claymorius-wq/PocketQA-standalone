import type { BadgeProgress } from '@pocket-qa/contracts';
import { lintCopy } from '@pocket-qa/domain';
import { arcShare, BADGES, keyBadge, medalLabel, progressText } from '../src/lib/badges';

// What the app says and draws for each badge: the lead badge, counts in words, the arc, the label.

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const p = (id: BadgeProgress['id'], current: number, target: number, earned = false): BadgeProgress => ({ id, earned, current, target });

describe('badges', () => {
  it('the lead badge is the hardest one earned', () => {
    expect(keyBadge(['first_accepted', 'helpful_feedback'])).toBe('helpful_feedback');
    expect(keyBadge(['first_accepted', 'device_specialist', 'reliable_tester'])).toBe('reliable_tester');
    expect(keyBadge([])).toBeNull();
  });

  it('counts read as counts, never percentages', () => {
    expect(progressText(p('helpful_feedback', 1, 3), 80)).toBe('1 of 3 helpful marks');
    expect(progressText(p('first_accepted', 0, 1), 0)).toBe('0 of 1 accepted test');
    expect(progressText(p('device_specialist', 2, 3), 80)).toBe('2 of 3 accepted tests on one platform');
  });

  it('Reliable tester with its count full names the quality bar, and its arc follows the shorter of the two', () => {
    const full = p('reliable_tester', 5, 5);
    expect(progressText(full, 37)).toBe('Needs a quality score of 60; yours is 37');
    expect(arcShare(full, 37)).toBeCloseTo(37 / 60);
    expect(arcShare(p('reliable_tester', 2, 5), 90)).toBeCloseTo(0.4);
    expect(arcShare(p('helpful_feedback', 2, 3), 0)).toBeCloseTo(2 / 3);
    expect(arcShare(p('reliable_tester', 5, 5, true), 61)).toBe(1);
  });

  it('one spoken label per medallion', () => {
    expect(medalLabel('Android specialist', p('device_specialist', 3, 3, true), { isNew: true, qualityScore: 60 })).toBe('Android specialist, earned, new');
    expect(medalLabel('Helpful feedback', p('helpful_feedback', 2, 3), { isNew: false, qualityScore: 60 })).toBe('Helpful feedback, locked. 2 of 3 helpful marks');
  });

  it('the copy promises nothing and names no money', () => {
    const text = Object.values(BADGES)
      .flatMap((b) => [b.name, b.rule, b.unit(1), b.unit(3)])
      .join('\n');
    expect(lintCopy(text)).toEqual([]);
  });
});
