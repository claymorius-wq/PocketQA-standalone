import type { DB } from './db';
import type { Repos } from './repo';
import { notFound } from './util';
import type { ParticipationRow, StudyRow, UserRow } from './views';

export function getStudyRow(db: DB, id: string): StudyRow | undefined {
  return db.prepare('SELECT * FROM studies WHERE id = ?').get(id) as StudyRow | undefined;
}

export function getParticipationRow(db: DB, id: string): ParticipationRow | undefined {
  return db.prepare('SELECT * FROM participations WHERE id = ?').get(id) as ParticipationRow | undefined;
}

/** Builder's own study, else 404 (no existence leak). */
export function ownStudy(db: DB, id: string, user: UserRow): StudyRow {
  const s = getStudyRow(db, id);
  if (!s || s.builder_id !== user.id) throw notFound('Study');
  return s;
}

// Access checks over the repository (sqlite or firestore). The synchronous `(db, …)` helpers
// above are for SQLite repository code running inside a db.transaction.

/** Builder's own study, else 404 (no existence leak). */
export async function ownStudyOf(repo: Repos, id: string, user: UserRow): Promise<StudyRow> {
  const s = await repo.studies.getStudy(id);
  if (!s || s.builder_id !== user.id) throw notFound('Study');
  return s;
}

/** Tester's own participation, else 404. */
export async function testerParticipationOf(repo: Repos, id: string, user: UserRow): Promise<{ p: ParticipationRow; s: StudyRow }> {
  const p = await repo.studies.getParticipation(id);
  if (!p || p.tester_id !== user.id) throw notFound('Participation');
  return { p, s: (await repo.studies.getStudy(p.study_id))! };
}

/** Participation in a study the builder owns, else 404. */
export async function ownerParticipationOf(repo: Repos, id: string, user: UserRow): Promise<{ p: ParticipationRow; s: StudyRow }> {
  const p = await repo.studies.getParticipation(id);
  const s = p ? await repo.studies.getStudy(p.study_id) : undefined;
  if (!p || !s || s.builder_id !== user.id) throw notFound('Participation');
  return { p, s };
}

/** Tester owner, study owner, or admin; everyone else gets 404. */
export async function partyParticipationOf(repo: Repos, id: string, user: UserRow): Promise<{ p: ParticipationRow; s: StudyRow; as: 'tester' | 'builder' | 'admin' }> {
  const p = await repo.studies.getParticipation(id);
  const s = p ? await repo.studies.getStudy(p.study_id) : undefined;
  if (!p || !s) throw notFound('Participation');
  if (p.tester_id === user.id) return { p, s, as: 'tester' };
  if (s.builder_id === user.id) return { p, s, as: 'builder' };
  if (user.role === 'admin') return { p, s, as: 'admin' };
  throw notFound('Participation');
}
