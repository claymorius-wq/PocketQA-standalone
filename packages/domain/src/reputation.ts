/**
 * Tester reputation: points, badges and the leaderboard (plan workstreams E and F).
 *
 * - Points are append-only events, earned ONLY for work a builder (or an admin deciding stuck
 *   work, or an overturned dispute) accepted. Uploading, submitting, disputing or writing an
 *   honest negative finding never earns or costs points. They have no cash value, aren't
 *   tradeable, and aren't a token or NFT.
 * - A fraud finding upheld by an admin appends reversal events; nothing is deleted.
 * - The leaderboard is opt-in and pseudonymous, and ranks by quality: the Wilson lower bound of
 *   the acceptance rate over a recency window, with a minimum sample. Never by volume, points or
 *   money.
 */
export const ACCEPTED_POINTS = 10;
export const HELPFUL_POINTS = 5;
export const REPUTATION_WINDOW_DAYS = 90;
export const REPUTATION_WINDOW_MS = REPUTATION_WINDOW_DAYS * 24 * 3600_000;
export const LEADERBOARD_MIN_DECIDED = 3;
const RELIABLE_MIN_DECIDED = 5;
const RELIABLE_MIN_SCORE = 60;

export type PointsKind = 'accepted' | 'helpful' | 'reversal';
export type PointsEvent = { id: string; participationId: string; kind: PointsKind; points: number; reversesId: string | null; platform: string | null };
export type NewPointsEvent = Omit<PointsEvent, 'id' | 'reversesId'> & { reversesId?: string | null };

/** One decided participation, as reputation sees it (`reversed`: an upheld fraud finding). */
export type DecidedWork = { participationId: string; outcome: 'accepted' | 'rejected'; decidedAtMs: number; platform: string | null; reversed: boolean };

export function planApprovalPoints(input: { participationId: string; helpful: boolean; platform: string | null }): NewPointsEvent[] {
  const events: NewPointsEvent[] = [{ participationId: input.participationId, kind: 'accepted', points: ACCEPTED_POINTS, platform: input.platform }];
  if (input.helpful) events.push({ participationId: input.participationId, kind: 'helpful', points: HELPFUL_POINTS, platform: input.platform });
  return events;
}

/** Reverses every not-yet-reversed positive event of the participation. */
export function planReversal(events: readonly PointsEvent[], participationId: string): NewPointsEvent[] {
  const reversed = new Set(events.filter((e) => e.reversesId).map((e) => e.reversesId));
  return events
    .filter((e) => e.participationId === participationId && e.points > 0 && !reversed.has(e.id))
    .map((e) => ({ participationId, kind: 'reversal' as const, points: -e.points, reversesId: e.id, platform: e.platform }));
}

export const pointsTotal = (events: readonly Pick<PointsEvent, 'points'>[]) => events.reduce((s, e) => s + e.points, 0);

/** 95% Wilson score lower bound of `successes / n`; 0 when there is no data. */
export function wilsonLowerBound(successes: number, n: number): number {
  if (n === 0) return 0;
  const z = 1.96;
  const p = successes / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
}

/** Decided work in the recency window; reversed work counts as rejected. */
export function reputationStats(work: readonly DecidedWork[], nowMs: number) {
  const recent = work.filter((w) => nowMs - w.decidedAtMs <= REPUTATION_WINDOW_MS);
  const accepted = recent.filter((w) => w.outcome === 'accepted' && !w.reversed).length;
  const decided = recent.length;
  return { accepted, rejected: decided - accepted, decided, qualityScore: Math.floor(wilsonLowerBound(accepted, decided) * 100) };
}

export type Badge = { id: 'first_accepted' | 'reliable_tester' | 'helpful_feedback' | 'device_specialist'; label: string; description: string };
const PLATFORM_NAMES: Record<string, string> = { android: 'Android', ios: 'iOS', web: 'Web' };

export function badgesFor(input: { work: readonly DecidedWork[]; events: readonly PointsEvent[]; nowMs: number }): Badge[] {
  const badges: Badge[] = [];
  const everAccepted = input.work.filter((w) => w.outcome === 'accepted' && !w.reversed);
  if (everAccepted.length >= 1) badges.push({ id: 'first_accepted', label: 'First accepted test', description: 'A builder accepted your first test.' });
  const stats = reputationStats(input.work, input.nowMs);
  if (stats.decided >= RELIABLE_MIN_DECIDED && stats.qualityScore >= RELIABLE_MIN_SCORE) {
    badges.push({ id: 'reliable_tester', label: 'Reliable tester', description: 'Consistently accepted work over the last 90 days.' });
  }
  const reversed = new Set(input.events.filter((e) => e.reversesId).map((e) => e.reversesId));
  if (input.events.filter((e) => e.kind === 'helpful' && !reversed.has(e.id)).length >= 3) {
    badges.push({ id: 'helpful_feedback', label: 'Helpful feedback', description: 'Builders marked your feedback helpful three times.' });
  }
  const byPlatform = new Map<string, number>();
  for (const w of everAccepted) if (w.platform) byPlatform.set(w.platform, (byPlatform.get(w.platform) ?? 0) + 1);
  const top = [...byPlatform.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1])[0];
  if (top) {
    const name = PLATFORM_NAMES[top[0]] ?? top[0];
    badges.push({ id: 'device_specialist', label: `${name} specialist`, description: `Three or more accepted tests on ${name}.` });
  }
  return badges;
}

export type LeaderboardInput = { userId: string; alias: string; optedIn: boolean; work: readonly DecidedWork[]; events: readonly PointsEvent[] };
export type LeaderboardRow = { rank: number; alias: string; qualityScore: number; decided: number; badges: Badge['id'][] };

/** Only opted-in testers with enough recent decided work; quality first, then sample size, then alias. */
export function rankLeaderboard(entries: readonly LeaderboardInput[], nowMs: number): LeaderboardRow[] {
  return entries
    .filter((e) => e.optedIn)
    .map((e) => ({ e, s: reputationStats(e.work, nowMs) }))
    .filter(({ s }) => s.decided >= LEADERBOARD_MIN_DECIDED)
    .sort((a, b) => b.s.qualityScore - a.s.qualityScore || b.s.decided - a.s.decided || a.e.alias.localeCompare(b.e.alias))
    .map(({ e, s }, i) => ({ rank: i + 1, alias: e.alias, qualityScore: s.qualityScore, decided: s.decided, badges: badgesFor({ work: e.work, events: e.events, nowMs }).map((b) => b.id) }));
}
