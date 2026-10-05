import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BadgeProgress } from '@pocket-qa/contracts';
import { RELIABLE_MIN_SCORE } from '@pocket-qa/domain';
import { useEffect, useState } from 'react';
import type { GlyphName } from '../icons';

// What the app says and draws for each badge (the rules themselves are the domain's badgesFor and
// badgeProgress; the server sends earned badges' own labels). Badges have no cash value, aren't
// tokens or NFTs and can't be traded; nothing here names a reward, money or a promise.

export type BadgeId = BadgeProgress['id'];

type BadgeMeta = {
  glyph: GlyphName;
  /** The name before it is earned (an earned Device specialist is named for its platform). */
  name: string;
  /** How it is earned, as a condition. */
  rule: string;
  /** The thing being counted toward it, for "2 of 3 …". */
  unit: (n: number) => string;
};

export const BADGES: Record<BadgeId, BadgeMeta> = {
  first_accepted: { glyph: 'accepted', name: 'First accepted test', rule: 'A builder accepts one of your tests.', unit: (n) => (n === 1 ? 'accepted test' : 'accepted tests') },
  reliable_tester: { glyph: 'reliable', name: 'Reliable tester', rule: 'At least 5 decided tests in the last 90 days, with a quality score of 60 or more.', unit: (n) => (n === 1 ? 'decided test' : 'decided tests') },
  helpful_feedback: { glyph: 'helpful', name: 'Helpful feedback', rule: 'Builders mark your feedback helpful 3 times.', unit: (n) => (n === 1 ? 'helpful mark' : 'helpful marks') },
  device_specialist: { glyph: 'deviceSpec', name: 'Device specialist', rule: '3 accepted tests on the same platform: Android, iOS or the web.', unit: (n) => (n === 1 ? 'accepted test on one platform' : 'accepted tests on one platform') },
};

/** The badge that leads where only one is shown (a leaderboard row, the hero): the hardest earned. */
const KEY_ORDER: readonly BadgeId[] = ['reliable_tester', 'device_specialist', 'helpful_feedback', 'first_accepted'];
export function keyBadge(earned: readonly BadgeId[]): BadgeId | null {
  return KEY_ORDER.find((id) => earned.includes(id)) ?? null;
}

/**
 * The count toward a badge in words ("1 of 3 helpful marks"). Reliable tester's count can be full
 * while its quality bar is not: then the bar is what is left.
 */
export function progressText(p: BadgeProgress, qualityScore: number): string {
  if (p.id === 'reliable_tester' && !p.earned && p.current >= p.target && qualityScore < RELIABLE_MIN_SCORE) {
    return `Needs a quality score of ${RELIABLE_MIN_SCORE}; yours is ${qualityScore}`;
  }
  return `${p.current} of ${p.target} ${BADGES[p.id].unit(p.target)}`;
}

/**
 * How much of the arc a locked badge fills (0 … 1). Reliable tester needs its count and its
 * quality bar both, so its arc shows the one further behind: a full count never draws a full ring
 * while the quality score is short.
 */
export function arcShare(p: BadgeProgress, qualityScore: number): number {
  const count = p.target > 0 ? p.current / p.target : 0;
  if (p.id !== 'reliable_tester' || p.earned) return count;
  return Math.min(count, Math.max(0, qualityScore) / RELIABLE_MIN_SCORE);
}

/** The medallion's one spoken label (`counted` false: no count is known, so none is said). */
export function medalLabel(name: string, p: BadgeProgress, opts: { isNew: boolean; qualityScore: number; counted?: boolean }): string {
  if (p.earned) return `${name}, earned${opts.isNew ? ', new' : ''}`;
  if (opts.counted === false) return `${name}, not earned yet`;
  return `${name}, locked. ${progressText(p, opts.qualityScore)}`;
}

// ---------- "New": an earned badge this device hasn't shown its tester yet ----------

const seenKey = (userId: string) => `pocketqa.badgesSeen.${userId}`;

/** The ids this device has shown; `null` when storage can't be read. A value that isn't a list of ids counts as none (rewritten the next time a badge is new). */
async function readSeen(userId: string): Promise<BadgeId[] | null> {
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(seenKey(userId));
  } catch {
    return null;
  }
  try {
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as BadgeId[]) : [];
  } catch {
    return [];
  }
}

/** Forget which badges this device has shown an account (deleting it leaves nothing of it here). */
export async function forgetSeenBadges(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  await AsyncStorage.removeItem(seenKey(userId)).catch(() => {});
}

/**
 * The earned badges that are new on this visit: earned, and never shown on this device before.
 * Decided once per visit (when the earned list first arrives) and then recorded, so "New" shows this
 * time and not the next. Storage that can't be read shows nothing as new; if the record can't be
 * written, the badge shows as new again next time. A first visit on a device (a new phone, a
 * reinstall) shows every earned badge as new once. Signing out keeps the record (badge ids only), so
 * "New" stays true after signing back in; deleting the account clears it (`forgetSeenBadges`).
 */
export function useNewBadges(userId: string | null | undefined, earned: readonly BadgeId[] | undefined): ReadonlySet<BadgeId> {
  const [fresh, setFresh] = useState<ReadonlySet<BadgeId>>(() => new Set());
  const ready = !!userId && !!earned;
  const key = earned ? [...earned].sort().join(',') : '';
  useEffect(() => {
    if (!ready || !userId || !earned) return;
    let live = true;
    void readSeen(userId).then(async (seen) => {
      if (!live || seen === null) return;
      const unseen = earned.filter((id) => !seen.includes(id));
      if (unseen.length === 0) return;
      setFresh((prev) => new Set([...prev, ...unseen]));
      try {
        await AsyncStorage.setItem(seenKey(userId), JSON.stringify([...new Set([...seen, ...earned])]));
      } catch {
        // Not recorded: the badge shows as new again next time, which is harmless.
      }
    });
    return () => {
      live = false;
    };
    // `key` stands for the earned list's contents.
  }, [ready, userId, key]);
  return fresh;
}
