import type { DB } from '../../db';
import type { EscrowRepo } from './types';

export function sqliteEscrowRepo(_db: DB): EscrowRepo {
  return {};
}
