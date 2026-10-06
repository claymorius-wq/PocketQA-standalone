import type { DB } from '../../db';
import type { EvidenceRepo } from './types';

export function sqliteEvidenceRepo(_db: DB): EvidenceRepo {
  return {};
}
