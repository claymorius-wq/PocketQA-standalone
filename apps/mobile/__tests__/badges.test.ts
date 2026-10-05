import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BadgeProgress } from '@pocket-qa/contracts';
import { lintCopy } from '@pocket-qa/domain';
import { act, renderHook } from '@testing-library/react-native';
import { arcShare, BADGES, forgetSeenBadges, keyBadge, medalLabel, progressText, useNewBadges } from '../src/lib/badges';

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

  it('the medallion with no count known says so, and no count', () => {
    expect(medalLabel('Helpful feedback', p('helpful_feedback', 0, 1), { isNew: false, qualityScore: 60, counted: false })).toBe('Helpful feedback, not earned yet');
  });

  it('the copy promises nothing and names no money', () => {
    const text = Object.values(BADGES)
      .flatMap((b) => [b.name, b.rule, b.unit(1), b.unit(3)])
      .join('\n');
    expect(lintCopy(text)).toEqual([]);
  });
});

describe('useNewBadges', () => {
  const KEY = 'pocketqa.badgesSeen.t1';
  const flush = () => act(() => new Promise((r) => setTimeout(r, 20)));
  // The storage mock's functions are jest.fn()s shared by every test: fail them once, never for good.
  const storage = AsyncStorage as unknown as { getItem: jest.Mock; setItem: jest.Mock; removeItem: jest.Mock };
  beforeEach(async () => {
    await AsyncStorage.clear();
    storage.setItem.mockClear();
  });

  it('new once: shown on the first visit, recorded, and not the next', async () => {
    const first = await renderHook(() => useNewBadges('t1', ['first_accepted']));
    await flush();
    expect([...first.result.current]).toEqual(['first_accepted']);
    expect(JSON.parse((await AsyncStorage.getItem(KEY))!)).toEqual(['first_accepted']);
    const next = await renderHook(() => useNewBadges('t1', ['first_accepted']));
    await flush();
    expect(next.result.current.size).toBe(0);
  });

  it('storage that can’t be read shows nothing as new, and writes nothing', async () => {
    storage.getItem.mockRejectedValueOnce(new Error('denied'));
    const set = storage.setItem;
    const r = await renderHook(() => useNewBadges('t1', ['first_accepted']));
    await flush();
    expect(r.result.current.size).toBe(0);
    expect(set).not.toHaveBeenCalled();
  });

  it('a stored value that isn’t a list of ids counts as none seen, and is rewritten', async () => {
    for (const bad of ['{}', 'not json', '[1, null]']) {
      await AsyncStorage.setItem(KEY, bad);
      const r = await renderHook(() => useNewBadges('t1', ['helpful_feedback']));
      await flush();
      expect([...r.result.current]).toEqual(['helpful_feedback']);
      expect(JSON.parse((await AsyncStorage.getItem(KEY))!)).toEqual(['helpful_feedback']);
    }
  });

  it('a record that can’t be written still shows the badge as new now', async () => {
    storage.setItem.mockRejectedValueOnce(new Error('full'));
    const r = await renderHook(() => useNewBadges('t1', ['first_accepted']));
    await flush();
    expect([...r.result.current]).toEqual(['first_accepted']);
  });

  it('deleting the account forgets the record', async () => {
    await AsyncStorage.setItem(KEY, '["first_accepted"]');
    await forgetSeenBadges('t1');
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    await expect(forgetSeenBadges(undefined)).resolves.toBeUndefined();
    // Storage that refuses never blocks the sign-out that follows.
    storage.removeItem.mockRejectedValueOnce(new Error('denied'));
    await expect(forgetSeenBadges('t1')).resolves.toBeUndefined();
  });
});
