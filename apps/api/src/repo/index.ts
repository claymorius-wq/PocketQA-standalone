import type { Firestore } from 'firebase-admin/firestore';
import type { DB } from '../db';
import { devnetFirestore } from '../firestore/namespace';
import { firestoreCoreRepo } from './core/firestore';
import { sqliteCoreRepo } from './core/sqlite';
import type { CoreRepo } from './core/types';
import { firestoreEscrowRepo } from './escrow/firestore';
import { sqliteEscrowRepo } from './escrow/sqlite';
import type { EscrowRepo } from './escrow/types';
import { firestoreEvidenceRepo } from './evidence/firestore';
import { sqliteEvidenceRepo } from './evidence/sqlite';
import type { EvidenceRepo } from './evidence/types';
import { firestoreStudiesRepo } from './studies/firestore';
import { sqliteStudiesRepo } from './studies/sqlite';
import type { StudiesRepo } from './studies/types';

/**
 * Data access behind intent-level repositories (docs/plans/firebase-vercel-refactor.md §2).
 * Handlers and views depend only on `Repos`; each domain has a `sqlite` implementation (local and
 * USB testing, unchanged behaviour) and a `firestore` one (hosted). No SQL-to-Firestore adapter:
 * each operation is written natively for its backend. Conventions: ./README.md.
 *
 * Domain ownership (Herdr panes, disjoint folders; this file is lead-owned and complete):
 *  - core     (lead):    users, identities, audit, idempotency, rate limits, jobs
 *  - studies  (pqa-be1): studies, tasks, participations, notes, ledger, findings, disputes
 *  - evidence (pqa-be2): evidence, upload intents, storage objects and deletions
 *  - escrow   (pqa-be3): wallet, wallet login, escrow, settlements, sim chain, devnet transfers, reputation
 */
/** `namespace: 'devnet'`: POCKETQA_ENV=devnet's isolated data (CH-D2), through devnetFirestore only. */
export type Backend = { kind: 'sqlite'; db: DB } | { kind: 'firestore'; fs: Firestore; namespace?: 'devnet' };

export type Repos = { kind: Backend['kind']; core: CoreRepo; studies: StudiesRepo; evidence: EvidenceRepo; escrow: EscrowRepo };

export function makeRepos(backend: Backend): Repos {
  if (backend.kind === 'sqlite') {
    const { db } = backend;
    return { kind: 'sqlite', core: sqliteCoreRepo(db), studies: sqliteStudiesRepo(db), evidence: sqliteEvidenceRepo(db), escrow: sqliteEscrowRepo(db) };
  }
  const fs = backend.namespace === 'devnet' ? devnetFirestore(backend.fs) : backend.fs;
  return { kind: 'firestore', core: firestoreCoreRepo(fs), studies: firestoreStudiesRepo(fs), evidence: firestoreEvidenceRepo(fs), escrow: firestoreEscrowRepo(fs) };
}
