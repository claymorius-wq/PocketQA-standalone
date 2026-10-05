import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_POINTS,
  BADGE_IDS,
  badgeProgress,
  badgesFor,
  HELPFUL_MIN_MARKS,
  HELPFUL_POINTS,
  LEADERBOARD_MIN_DECIDED,
  RELIABLE_MIN_DECIDED,
  RELIABLE_MIN_SCORE,
  SPECIALIST_MIN_ACCEPTED,
  planApprovalPoints,
  planReversal,
  pointsTotal,
  rankLeaderboard,
  reputationStats,
  wilsonLowerBound,
  type DecidedWork,
  type PointsEvent,
} from './reputation';

const DAY = 24 * 3600_000;
const NOW = Date.parse('2026-10-05T12:00:00Z');
const work = (n: number, outcome: DecidedWork['outcome'], over: Partial<DecidedWork> = {}): DecidedWork[] =>
  Array.from({ length: n }, (_, i) => ({ participationId: `${outcome}-${i}-${over.platform ?? 'web'}`, outcome, decidedAtMs: NOW - DAY, platform: 'web', reversed: false, ...over }));

describe('points: only accepted work earns them, append-only, idempotent', () => {
  it('approval earns 10, plus 5 when the builder marks the feedback helpful', () => {
    expect(planApprovalPoints({ participationId: 'p1', helpful: false, platform: 'android' })).toEqual([{ participationId: 'p1', kind: 'accepted', points: ACCEPTED_POINTS, platform: 'android' }]);
    expect(planApprovalPoints({ participationId: 'p1', helpful: true, platform: 'web' }).map((e) => e.points)).toEqual([ACCEPTED_POINTS, HELPFUL_POINTS]);
  });

  it('a fraud reversal cancels exactly the events of that participation, once', () => {
    const events: PointsEvent[] = [
      { id: 'e1', participationId: 'p1', kind: 'accepted', points: 10, reversesId: null, platform: 'web' },
      { id: 'e2', participationId: 'p1', kind: 'helpful', points: 5, reversesId: null, platform: 'web' },
      { id: 'e3', participationId: 'p2', kind: 'accepted', points: 10, reversesId: null, platform: 'web' },
    ];
    const rev = planReversal(events, 'p1');
    expect(rev).toEqual([
      { participationId: 'p1', kind: 'reversal', points: -10, reversesId: 'e1', platform: 'web' },
      { participationId: 'p1', kind: 'reversal', points: -5, reversesId: 'e2', platform: 'web' },
    ]);
    const after: PointsEvent[] = [...events, ...rev.map((r, i) => ({ ...r, id: `r${i}`, reversesId: r.reversesId ?? null }))];
    expect(pointsTotal(after)).toBe(10);
    expect(planReversal(after, 'p1')).toEqual([]); // already reversed
  });
});

describe('quality score: Wilson lower bound, not volume', () => {
  it('is 0 with no data and grows with evidence, never above the raw rate', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
    expect(wilsonLowerBound(3, 3)).toBeLessThan(wilsonLowerBound(30, 30));
    expect(wilsonLowerBound(9, 10)).toBeLessThan(0.9);
    expect(wilsonLowerBound(9, 10)).toBeGreaterThan(0.5);
  });

  it('a careful tester with fewer, consistently accepted tests outranks a high-volume careless one', () => {
    const careful = reputationStats(work(8, 'accepted'), NOW);
    const careless = reputationStats([...work(40, 'accepted'), ...work(30, 'rejected')], NOW);
    expect(careful.qualityScore).toBeGreaterThan(careless.qualityScore);
  });
});

describe('reputationStats: what counts', () => {
  it('only the 90-day window counts; disputes pending count for nothing; reversals count as rejected', () => {
    const s = reputationStats(
      [
        ...work(2, 'accepted'),
        ...work(1, 'accepted', { decidedAtMs: NOW - 100 * DAY }),
        ...work(1, 'rejected'),
        ...work(1, 'accepted', { reversed: true }),
      ],
      NOW,
    );
    expect(s).toMatchObject({ accepted: 2, rejected: 2, decided: 4 });
  });

  it('opening a dispute is never a penalty: an overturned rejection counts as accepted', () => {
    // The caller passes outcome 'accepted' for an overturned dispute; a pending one is not passed.
    const s = reputationStats([...work(3, 'accepted'), ...work(1, 'accepted', { participationId: 'overturned' })], NOW);
    expect(s.rejected).toBe(0);
  });
});

describe('badges', () => {
  it('First Accepted Test after one accepted test', () => {
    expect(badgesFor({ work: work(1, 'accepted'), events: [], nowMs: NOW }).map((b) => b.id)).toContain('first_accepted');
    expect(badgesFor({ work: work(1, 'rejected'), events: [], nowMs: NOW })).toEqual([]);
  });

  it('Reliable Tester needs 5 decided in 90 days and a quality score ≥ 60', () => {
    expect(badgesFor({ work: work(4, 'accepted'), events: [], nowMs: NOW }).map((b) => b.id)).not.toContain('reliable_tester');
    expect(badgesFor({ work: work(10, 'accepted'), events: [], nowMs: NOW }).map((b) => b.id)).toContain('reliable_tester');
    expect(badgesFor({ work: [...work(5, 'accepted'), ...work(5, 'rejected')], events: [], nowMs: NOW }).map((b) => b.id)).not.toContain('reliable_tester');
  });

  it('Helpful Feedback after 3 unreversed helpful marks', () => {
    const helpful = (n: number): PointsEvent[] => Array.from({ length: n }, (_, i) => ({ id: `h${i}`, participationId: `p${i}`, kind: 'helpful', points: 5, reversesId: null, platform: 'web' }));
    expect(badgesFor({ work: [], events: helpful(2), nowMs: NOW }).map((b) => b.id)).not.toContain('helpful_feedback');
    expect(badgesFor({ work: [], events: helpful(3), nowMs: NOW }).map((b) => b.id)).toContain('helpful_feedback');
    const reversed: PointsEvent[] = [...helpful(3), { id: 'r', participationId: 'p0', kind: 'reversal', points: -5, reversesId: 'h0', platform: 'web' }];
    expect(badgesFor({ work: [], events: reversed, nowMs: NOW }).map((b) => b.id)).not.toContain('helpful_feedback');
  });

  it('Device Specialist after 3 accepted tests on one platform, named for it', () => {
    const b = badgesFor({ work: [...work(3, 'accepted', { platform: 'android' }), ...work(2, 'accepted', { platform: 'ios' })], events: [], nowMs: NOW });
    expect(b.find((x) => x.id === 'device_specialist')).toMatchObject({ label: 'Android specialist' });
  });
});

describe('badgeProgress: the counts toward each badge, by the badges’ own rules', () => {
  const helpful = (n: number): PointsEvent[] => Array.from({ length: n }, (_, i) => ({ id: `h${i}`, participationId: `p${i}`, kind: 'helpful', points: 5, reversesId: null, platform: 'web' }));
  const byId = (p: ReturnType<typeof badgeProgress>) => Object.fromEntries(p.map((x) => [x.id, x]));

  it('lists every badge in order, nothing earned for a new tester', () => {
    const p = badgeProgress({ work: [], events: [], nowMs: NOW });
    expect(p.map((x) => x.id)).toEqual([...BADGE_IDS]);
    expect(p.every((x) => !x.earned && x.current === 0)).toBe(true);
    expect(p.map((x) => x.target)).toEqual([1, RELIABLE_MIN_DECIDED, HELPFUL_MIN_MARKS, SPECIALIST_MIN_ACCEPTED]);
  });

  it('counts toward each rule and caps at the target', () => {
    const p = byId(badgeProgress({ work: [...work(2, 'accepted', { platform: 'android' }), ...work(4, 'accepted', { platform: 'ios' })], events: helpful(2), nowMs: NOW }));
    expect(p.first_accepted).toMatchObject({ earned: true, current: 1, target: 1 });
    expect(p.reliable_tester).toMatchObject({ current: 5, target: 5 });
    expect(p.helpful_feedback).toMatchObject({ earned: false, current: 2, target: 3 });
    // The platform with the most accepted tests counts.
    expect(p.device_specialist).toMatchObject({ earned: true, current: 3, target: 3 });
  });

  it('Reliable tester: a full count is not the badge while the quality score is below its bar', () => {
    const p = byId(badgeProgress({ work: [...work(5, 'accepted'), ...work(5, 'rejected')], events: [], nowMs: NOW }));
    expect(p.reliable_tester).toMatchObject({ earned: false, current: 5, target: 5 });
    expect(reputationStats([...work(5, 'accepted'), ...work(5, 'rejected')], NOW).qualityScore).toBeLessThan(RELIABLE_MIN_SCORE);
  });

  it('a reversed helpful mark no longer counts', () => {
    const events: PointsEvent[] = [...helpful(3), { id: 'r', participationId: 'p0', kind: 'reversal', points: -5, reversesId: 'h0', platform: 'web' }];
    expect(byId(badgeProgress({ work: [], events, nowMs: NOW })).helpful_feedback).toMatchObject({ earned: false, current: 2 });
  });

  it('earned is exactly what badgesFor lists, for any history', () => {
    const histories = [
      { work: work(1, 'accepted'), events: [] },
      { work: [...work(9, 'accepted', { platform: 'android' }), ...work(1, 'rejected')], events: helpful(4) },
      { work: work(3, 'accepted', { reversed: true }), events: helpful(1) },
    ];
    for (const h of histories) {
      const input = { ...h, nowMs: NOW };
      const listed = badgesFor(input).map((b) => b.id).sort();
      expect(badgeProgress(input).filter((x) => x.earned).map((x) => x.id).sort()).toEqual(listed);
    }
  });
});

describe('rankLeaderboard: opt-in, minimum sample, quality-ranked, pseudonymous', () => {
  const entry = (alias: string, w: DecidedWork[], optedIn = true) => ({ userId: `u-${alias}`, alias, optedIn, work: w, events: [] as PointsEvent[] });
  it('excludes opted-out testers and those below the minimum sample; ranks by quality score', () => {
    const rows = rankLeaderboard(
      [
        entry('Volume', [...work(50, 'accepted'), ...work(40, 'rejected')]),
        entry('Careful', work(9, 'accepted')),
        entry('Hidden', work(30, 'accepted'), false),
        entry('New', work(LEADERBOARD_MIN_DECIDED - 1, 'accepted')),
      ],
      NOW,
    );
    expect(rows.map((r) => r.alias)).toEqual(['Careful', 'Volume']);
    expect(rows[0]).toEqual({ rank: 1, alias: 'Careful', qualityScore: expect.any(Number), decided: 9, badges: expect.any(Array) });
    // Pseudonymous: the row has no user id, wallet or email field.
    expect(Object.keys(rows[0]!).sort()).toEqual(['alias', 'badges', 'decided', 'qualityScore', 'rank']);
  });
});
