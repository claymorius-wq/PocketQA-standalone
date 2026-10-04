import type { Reputation } from '@pocket-qa/contracts';
import { badgesFor, LEADERBOARD_MIN_DECIDED, planApprovalPoints, planReversal, pointsTotal, rankLeaderboard, REPUTATION_WINDOW_DAYS, reputationStats, type DecidedWork, type NewPointsEvent, type PointsEvent } from '@pocket-qa/domain';
import type { DB } from './db';
import { iso, newId } from './util';
import type { ParticipationRow, StudyRow } from './views';

/**
 * Reputation on the API side: points for accepted work, fraud reversals, self-dealing flags and
 * the opt-in leaderboard. Separate from money (escrow) and from test credits.
 */
type EventRow = { id: string; user_id: string; participation_id: string; kind: PointsEvent['kind']; points: number; reverses_id: string | null; platform: string | null; created_at: string };
const toEvent = (r: EventRow): PointsEvent => ({ id: r.id, participationId: r.participation_id, kind: r.kind, points: r.points, reversesId: r.reverses_id, platform: r.platform });

function append(db: DB, userId: string, events: NewPointsEvent[], nowMs: number) {
  const ins = db.prepare('INSERT INTO points_events (id, user_id, participation_id, kind, points, reverses_id, platform, created_at) VALUES (?,?,?,?,?,?,?,?)');
  for (const e of events) ins.run(newId(), userId, e.participationId, e.kind, e.points, e.reversesId ?? null, e.platform, iso(nowMs));
}

/**
 * Why accepted work should earn no points: its payout wallet (or the tester's linked wallet) is a
 * wallet that funded one of the same builder's studies. Null when nothing looks wrong.
 */
function selfDealing(db: DB, s: StudyRow, p: ParticipationRow): string | null {
  const linked = (db.prepare('SELECT address FROM wallet_links WHERE user_id = ?').get(p.tester_id) as { address: string } | undefined)?.address ?? null;
  for (const w of [p.payout_address, linked]) {
    if (!w) continue;
    const funded = db.prepare(`SELECT 1 FROM study_escrows e JOIN studies x ON x.id = e.study_id WHERE x.builder_id = ? AND e.funding_wallet = ?`).get(s.builder_id, w);
    if (funded) return 'The tester’s wallet funded a study by the same builder (possible self-dealing); points withheld for review.';
  }
  return null;
}

/**
 * Points for accepted work, inside the caller's write transaction. `helpful` comes only from the
 * study owner's approval. Unique indexes make a second award impossible.
 */
export function awardApproval(db: DB, s: StudyRow, p: ParticipationRow, helpful: boolean, nowMs: number) {
  if (db.prepare('SELECT 1 FROM points_events WHERE participation_id = ? AND kind = ?').get(p.id, 'accepted')) return;
  const why = selfDealing(db, s, p);
  if (why) {
    db.prepare('INSERT OR IGNORE INTO points_flags (participation_id, reason, created_at) VALUES (?,?,?)').run(p.id, why, iso(nowMs));
    return;
  }
  const device = db.prepare('SELECT device_json FROM users WHERE id = ?').get(p.tester_id) as { device_json: string | null } | undefined;
  const platform = device?.device_json ? (JSON.parse(device.device_json) as { platform?: string }).platform ?? null : null;
  append(db, p.tester_id, planApprovalPoints({ participationId: p.id, helpful, platform }), nowMs);
}

/** An upheld fraud finding: append reversals of that participation's points. */
export function reverseForFraud(db: DB, p: ParticipationRow, nowMs: number) {
  const events = (db.prepare('SELECT * FROM points_events WHERE user_id = ?').all(p.tester_id) as EventRow[]).map(toEvent);
  append(db, p.tester_id, planReversal(events, p.id), nowMs);
}

/** A tester's decided work, as reputation counts it (see domain `reputationStats`). */
function decidedWork(db: DB, userId: string): DecidedWork[] {
  const rows = db
    .prepare(
      `SELECT p.id, p.status, p.decided_at, d.outcome, d.resolved_at, f.participation_id AS fraud,
              (SELECT platform FROM points_events e WHERE e.participation_id = p.id AND e.kind = 'accepted') AS platform
       FROM participations p
       LEFT JOIN disputes d ON d.participation_id = p.id
       LEFT JOIN fraud_findings f ON f.participation_id = p.id
       WHERE p.tester_id = ? AND p.status IN ('approved','rejected','resolved')`,
    )
    .all(userId) as { id: string; status: string; decided_at: string | null; outcome: 'upheld' | 'overturned' | null; resolved_at: string | null; fraud: string | null; platform: string | null }[];
  return rows.map((r) => ({
    participationId: r.id,
    outcome: r.status === 'approved' || (r.status === 'resolved' && r.outcome === 'overturned') ? 'accepted' : 'rejected',
    decidedAtMs: Date.parse((r.status === 'resolved' ? r.resolved_at : r.decided_at) ?? new Date(0).toISOString()),
    platform: r.platform,
    reversed: r.fraud !== null,
  }));
}

const eventsOf = (db: DB, userId: string) => (db.prepare('SELECT * FROM points_events WHERE user_id = ? ORDER BY created_at, rowid').all(userId) as EventRow[]);

export function leaderboardRows(db: DB, nowMs: number) {
  const profiles = db.prepare(`SELECT l.user_id, l.alias FROM leaderboard_profiles l JOIN users u ON u.id = l.user_id WHERE l.opted_in = 1 AND l.alias IS NOT NULL AND u.status = 'active'`).all() as { user_id: string; alias: string }[];
  return rankLeaderboard(
    profiles.map((x) => ({ userId: x.user_id, alias: x.alias, optedIn: true, work: decidedWork(db, x.user_id), events: eventsOf(db, x.user_id).map(toEvent) })),
    nowMs,
  );
}

export function reputationView(db: DB, userId: string, nowMs: number): Reputation {
  const rows = eventsOf(db, userId);
  const events = rows.map(toEvent);
  const work = decidedWork(db, userId);
  const profile = db.prepare('SELECT opted_in, alias FROM leaderboard_profiles WHERE user_id = ?').get(userId) as { opted_in: 0 | 1; alias: string | null } | undefined;
  const optedIn = profile?.opted_in === 1;
  const rank = optedIn ? (leaderboardRows(db, nowMs).find((r) => r.alias === profile!.alias)?.rank ?? null) : null;
  const titleOf = db.prepare('SELECT s.title FROM participations p JOIN studies s ON s.id = p.study_id WHERE p.id = ?');
  return {
    points: pointsTotal(events),
    noCashValue: true,
    events: rows.map((r) => ({ kind: r.kind, points: r.points, createdAt: r.created_at, studyTitle: (titleOf.get(r.participation_id) as { title: string }).title })),
    badges: badgesFor({ work, events, nowMs }),
    stats: { ...reputationStats(work, nowMs), windowDays: REPUTATION_WINDOW_DAYS },
    leaderboard: { optedIn, alias: profile?.alias ?? null, rank, minDecided: LEADERBOARD_MIN_DECIDED },
  };
}
