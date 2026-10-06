import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDb } from '../src/db';

/**
 * Plan r2 §R2 (pqa-qa freeze r1 P3-1): every uniqueness the SQLite schema enforces has its Firestore
 * guard. The schema is introspected (not read from a list), so a new UNIQUE, partial unique index or
 * composite key fails here until it is mapped to its plan row and a guard the Firestore repositories
 * really use. Single-column primary keys are document ids by construction.
 */
type Guard = { row: number; guard: string } | { row: number; sqliteOnly: string };
const GUARDS: Record<string, Guard> = {
  'users(email)': { row: 1, guard: 'userEmails' },
  'participations(study_id,tester_id)': { row: 2, guard: 'participationPairs' },
  'evidence(participation_id,client_segment_id)': { row: 4, guard: 'evidenceSegments' },
  'upload_intents(object_key)': { row: 5, guard: 'uploadIntents' },
  'upload_intents(participation_id,client_segment_id)': { row: 6, guard: 'openSegments' },
  'disputes(participation_id)': { row: 7, guard: 'disputeByParticipation' },
  'ledger(participation_id,kind)': { row: 8, guard: 'ledgerRewards' },
  'identities(provider,subject)': { row: 9, guard: 'identities' },
  'identities(user_id,provider)': { row: 10, guard: 'userProviders' },
  'task_notes(participation_id,task_id)': { row: 11, guard: 'notes' },
  'wallet_links(address)': { row: 13, guard: 'walletAddresses' },
  'devnet_transfers(signature)': { row: 14, guard: 'transferSignatures' },
  'devnet_transfers(participation_id)': { row: 15, guard: 'openTransfers' },
  'study_escrows(vault)': { row: 16, guard: 'escrowVaults' },
  'escrow_fundings(reference)': { row: 18, guard: 'fundingRefs' },
  'escrow_fundings(signature)': { row: 19, guard: 'fundingSignatures' },
  'escrow_fundings(study_id)': { row: 20, guard: 'confirmedFunding' },
  'escrow_ledger(ref)': { row: 21, guard: 'funding:' },
  'escrow_ledger(participation_id)#escrow_one_authorization': { row: 22, guard: 'payoutAuthorized' },
  'escrow_ledger(participation_id)#escrow_one_settlement': { row: 23, guard: 'payoutSettled' },
  'escrow_ledger(study_id)#escrow_one_refund': { row: 24, guard: 'refundAuthorized' },
  'escrow_ledger(study_id)#escrow_one_refund_settled': { row: 25, guard: 'refundSettled' },
  'settlements(participation_id)': { row: 26, guard: 'payout:' },
  'settlements(study_id)': { row: 27, guard: 'refund:' },
  'settlements(signature)': { row: 28, guard: 'settlementSignatures' },
  'sim_chain_transfers(idempotency_key)': { row: 29, guard: 'simIdempotency' },
  'points_events(participation_id,kind)': { row: 30, guard: 'pointsAwards' },
  'points_events(reverses_id)': { row: 31, guard: 'pointsReversals' },
  'leaderboard_profiles(expr)': { row: 32, guard: 'leaderboardAliases' },
  'squads_attempts(multisig,tx_index)': { row: 33, sqliteOnly: 'the Squads devnet pilot is SQLite-only and refused on hosted (plan R11, R13)' },
};

const dir = mkdtempSync(join(tmpdir(), 'pqa-guards-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Every enforced uniqueness except single-column primary keys, keyed as table(cols), with the index name when a table has two on the same columns. */
function schemaUniques(): string[] {
  const db = openDb(join(dir, 'schema.sqlite'));
  const keys: string[] = [];
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[];
  for (const { name } of tables) {
    const found: { cols: string; index: string }[] = [];
    for (const ix of db.prepare(`PRAGMA index_list('${name}')`).all() as { name: string; unique: number }[]) {
      if (!ix.unique) continue;
      const cols = (db.prepare(`PRAGMA index_info('${ix.name}')`).all() as { name: string | null }[]).map((c) => c.name ?? 'expr');
      found.push({ cols: cols.join(','), index: ix.name });
    }
    const pk = (db.prepare(`PRAGMA table_info('${name}')`).all() as { name: string; pk: number }[]).filter((c) => c.pk > 0);
    for (const f of found) {
      if (pk.length === 1 && f.cols === pk[0]!.name) continue; // a document id
      const twin = found.filter((o) => o.cols === f.cols).length > 1;
      keys.push(`${name}(${f.cols})${twin ? `#${f.index}` : ''}`);
    }
  }
  db.close();
  return keys.sort();
}

const firestoreSource = readdirSync(join(__dirname, '../src/repo'))
  .flatMap((d) => {
    try {
      return [readFileSync(join(__dirname, '../src/repo', d, 'firestore.ts'), 'utf8')];
    } catch {
      return [];
    }
  })
  .join('\n');

describe('SQLite uniqueness -> Firestore guard coverage (plan R2)', () => {
  const uniques = schemaUniques();

  it('every enforced uniqueness in the schema is mapped (a new one fails until its guard is declared)', () => {
    expect(uniques.filter((k) => !(k in GUARDS))).toEqual([]);
  });

  it('every mapping still matches the schema (no stale rows)', () => {
    expect(Object.keys(GUARDS).filter((k) => !uniques.includes(k))).toEqual([]);
  });

  it.each(Object.entries(GUARDS).filter(([, g]) => 'guard' in g))('%s: its guard is used by the Firestore repositories', (_key, g) => {
    expect(firestoreSource).toContain((g as { guard: string }).guard);
  });

  it('SQLite-only constraints are only the documented ones', () => {
    expect(Object.entries(GUARDS).filter(([, g]) => 'sqliteOnly' in g).map(([k]) => k)).toEqual(['squads_attempts(multisig,tx_index)']);
  });
});
