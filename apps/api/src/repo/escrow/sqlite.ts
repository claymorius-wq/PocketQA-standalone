import { assertCleanCopy, planFunding, planSettlePayout, planSettleRefund, transitionPayout, type DomainError, type LoginChallengeRecord, type NonceRecord } from '@pocket-qa/domain';
import { getParticipationRow, ownStudy } from '../../access';
import type { DB } from '../../db';
import { audit, authorizeRefund, escrowOf, paymentsExport, postEscrow, studyEscrowBooks, studyQuote } from '../../escrow';
import { leaderboardRows, reputationExport, reputationView, reverseForFraud } from '../../reputation';
import { fail, iso, newId, notFound } from '../../util';
import type { StudyRow } from '../../views/studies';
import type { UserRow } from '../../views/core';
import type { EscrowRepo, FundingRow, SettlementRow, SimTransferRow, TransferRow, WalletLink } from './types';

/**
 * SQLite escrow repository: today's SQL, moved verbatim out of the handlers, settlement worker and
 * views. A multi-statement operation keeps its `db.transaction` inside the method, except
 * `purgeUser`, which runs inside the caller's account-deletion transaction.
 *
 * The sync helpers in ../../escrow.ts and ../../reputation.ts (authorizePayout, authorizeRefund,
 * canReserve, awardApproval, …) stay: other domains' SQLite code calls them inside its own
 * transactions (decide, close, join).
 */
export function sqliteEscrowRepo(db: DB): EscrowRepo {
  const transfer = (id: string) => db.prepare('SELECT * FROM devnet_transfers WHERE id = ?').get(id) as TransferRow;
  const funding = (id: string) => db.prepare('SELECT * FROM escrow_fundings WHERE id = ?').get(id) as FundingRow;
  const linkedAddress = (userId: string) => (db.prepare('SELECT address FROM wallet_links WHERE user_id = ?').get(userId) as { address: string } | undefined)?.address ?? null;

  /** Firebase UID for a wallet sign-in: the account's existing one, or a new one keyed by its id. */
  const firebaseSubject = (userId: string, nowMs: number): string => {
    const row = db.prepare(`SELECT subject FROM identities WHERE provider = 'firebase' AND user_id = ?`).get(userId) as { subject: string } | undefined;
    if (row) return row.subject;
    db.prepare(`INSERT INTO identities (provider, subject, user_id, has_recovery, created_at) VALUES ('firebase', ?, ?, 0, ?)`).run(userId, userId, iso(nowMs));
    return userId;
  };

  return {
    devnet: null,

    async walletLinkOf(userId) {
      const r = db.prepare('SELECT address, linked_at FROM wallet_links WHERE user_id = ?').get(userId) as { address: string; linked_at: string } | undefined;
      return r ? ({ address: r.address, linkedAt: r.linked_at } satisfies WalletLink) : null;
    },

    async createLinkNonce(n) {
      db.prepare('INSERT INTO wallet_nonces (nonce, user_id, address, input_json, expires_at, used_at) VALUES (?,?,?,?,?,NULL)').run(n.nonce, n.userId, n.address, n.inputJson, n.expiresAtMs);
    },

    async linkWallet({ userId, address, nonce, nowMs, verify }) {
      let outcome: DomainError | null = null;
      db.transaction(() => {
        const row = db.prepare('SELECT * FROM wallet_nonces WHERE nonce = ?').get(nonce) as
          | { nonce: string; user_id: string; address: string; input_json: string; expires_at: number; used_at: number | null }
          | undefined;
        const record: NonceRecord | null = row
          ? { userId: row.user_id, address: row.address, nonce: row.nonce, input: JSON.parse(row.input_json), expiresAtMs: row.expires_at, usedAtMs: row.used_at }
          : null;
        // Burn the nonce on any attempt by its owner, successful or not (single use).
        if (row && row.user_id === userId && row.used_at === null) {
          db.prepare('UPDATE wallet_nonces SET used_at = ? WHERE nonce = ?').run(nowMs, nonce);
        }
        try {
          verify(record);
        } catch (e) {
          outcome = e as DomainError;
          return; // keep the burn committed
        }
        const owner = db.prepare('SELECT user_id FROM wallet_links WHERE address = ?').get(address) as { user_id: string } | undefined;
        if (owner && owner.user_id !== userId) {
          outcome = fail('CONFLICT_STATE', 'This wallet is already linked to another account.');
          return;
        }
        db.prepare('INSERT INTO wallet_links (user_id, address, linked_at) VALUES (?,?,?) ON CONFLICT (user_id) DO UPDATE SET address = excluded.address, linked_at = excluded.linked_at').run(
          userId,
          address,
          iso(nowMs),
        );
      })();
      return outcome;
    },

    async unlinkWallet(user) {
      const recoverable = db.prepare(`SELECT 1 FROM identities WHERE user_id = ? AND has_recovery = 1`).get(user.id);
      if (!user.hasPassword && !recoverable) return false;
      db.prepare('DELETE FROM wallet_links WHERE user_id = ?').run(user.id);
      return true;
    },

    async createLoginChallenge(c) {
      db.prepare('DELETE FROM wallet_login_challenges WHERE expires_at < ?').run(c.nowMs - 3600_000);
      db.prepare('INSERT INTO wallet_login_challenges (nonce, address, input_json, expires_at, used_at, created_at) VALUES (?,?,?,?,NULL,?)').run(
        c.nonce,
        c.address,
        c.inputJson,
        c.expiresAtMs,
        c.nowMs,
      );
    },

    async walletLogin({ address, nonce, nowMs, verify, newAccount, firebase }) {
      let outcome: DomainError | null = null;
      let user: UserRow | null = null;
      let subject: string | null = null;
      db.transaction(() => {
        const row = db.prepare('SELECT * FROM wallet_login_challenges WHERE nonce = ?').get(nonce) as
          | { nonce: string; address: string; input_json: string; expires_at: number; used_at: number | null }
          | undefined;
        const record: LoginChallengeRecord | null = row
          ? { address: row.address, nonce: row.nonce, input: JSON.parse(row.input_json), expiresAtMs: row.expires_at, usedAtMs: row.used_at }
          : null;
        // Single use: burn on any attempt, successful or not.
        if (row && row.used_at === null) db.prepare('UPDATE wallet_login_challenges SET used_at = ? WHERE nonce = ?').run(nowMs, nonce);
        try {
          verify(record);
        } catch (e) {
          outcome = e as DomainError;
          return; // keep the burn committed
        }
        // The wallet resolves only to the account it is linked to (address is UNIQUE).
        const linked = db.prepare(`SELECT u.* FROM wallet_links w JOIN users u ON u.id = w.user_id WHERE w.address = ? AND u.status != 'deleted'`).get(address) as UserRow | undefined;
        if (linked) {
          // Admins sign in with email or Google only: one wallet signature is not enough.
          if (linked.role === 'admin') {
            outcome = fail('FORBIDDEN_ROLE', 'Admin accounts sign in with email or Google.');
            return;
          }
          user = linked;
          if (firebase) subject = firebaseSubject(linked.id, nowMs);
          return;
        }
        if (!newAccount) {
          outcome = fail('NOT_FOUND', 'No Pocket QA account uses this wallet yet.');
          return;
        }
        const created: UserRow = {
          id: newAccount.id,
          // Wallet-only accounts have no email; a reserved .invalid address keeps users.email unique.
          email: `wallet-${newAccount.id}@wallet.pocketqa.invalid`,
          password_hash: null,
          display_name: newAccount.displayName,
          role: newAccount.role,
          status: 'active',
          device_json: null,
          created_at: iso(nowMs),
        };
        db.prepare(
          'INSERT INTO users (id, email, password_hash, display_name, role, status, device_json, created_at) VALUES (@id,@email,@password_hash,@display_name,@role,@status,@device_json,@created_at)',
        ).run(created);
        db.prepare('INSERT INTO wallet_links (user_id, address, linked_at) VALUES (?,?,?)').run(created.id, address, iso(nowMs));
        user = created;
        if (firebase) subject = firebaseSubject(created.id, nowMs);
      })();
      if (outcome) return { error: outcome };
      return { user: user as unknown as UserRow, subject };
    },

    async createTransfer(r) {
      // Rule D: the same (deterministic) id again is the same transfer, returned as it is.
      const existing = db.prepare('SELECT * FROM devnet_transfers WHERE id = ?').get(r.id) as TransferRow | undefined;
      if (existing) return existing;
      try {
        db.prepare(
          `INSERT INTO devnet_transfers (id, participation_id, builder_id, tester_id, sender, recipient, lamports, status, created_at, expires_at)
           VALUES (?,?,?,?,?,?,?,'awaiting_signature',?,?)`,
        ).run(r.id, r.participation_id, r.builder_id, r.tester_id, r.sender, r.recipient, r.lamports, r.created_at, r.expires_at);
      } catch {
        return null; // one_open_transfer
      }
      return transfer(r.id);
    },

    async transferById(id) {
      return (db.prepare('SELECT * FROM devnet_transfers WHERE id = ?').get(id) as TransferRow | undefined) ?? null;
    },

    async builderTransfer(id, builderId) {
      return (db.prepare('SELECT * FROM devnet_transfers WHERE id = ? AND builder_id = ?').get(id, builderId) as TransferRow | undefined) ?? null;
    },

    async transfersOf(participationId) {
      return db.prepare('SELECT * FROM devnet_transfers WHERE participation_id = ? ORDER BY created_at DESC').all(participationId) as TransferRow[];
    },

    async expireTransfer(id, reason) {
      db.prepare(`UPDATE devnet_transfers SET status = 'expired', failure_reason = ? WHERE id = ?`).run(reason, id);
      return transfer(id);
    },

    async recordTransferVerdict(id, v) {
      db.prepare('UPDATE devnet_transfers SET status = ?, failure_reason = ?, verified_at = ? WHERE id = ?').run(v.status, v.reason, v.verifiedAt, id);
      return transfer(id);
    },

    async attachTransferSignature(id, signature, expiresAt) {
      try {
        db.prepare(`UPDATE devnet_transfers SET signature = ?, status = 'pending', expires_at = ? WHERE id = ? AND status = 'awaiting_signature'`).run(signature, expiresAt, id);
      } catch {
        return null; // devnet_transfers.signature UNIQUE
      }
      return transfer(id);
    },

    async escrowOf(studyId) {
      return escrowOf(db, studyId);
    },

    async settlementById(id) {
      return (db.prepare('SELECT * FROM settlements WHERE id = ?').get(id) as SettlementRow | undefined) ?? null;
    },

    async payoutSettlementOf(participationId) {
      return db.prepare(`SELECT * FROM settlements WHERE kind = 'payout' AND participation_id = ?`).get(participationId) as SettlementRow | undefined;
    },

    async setEscrowAccounts(studyId, multisig, vaultAuthority) {
      db.prepare('UPDATE study_escrows SET multisig = ?, vault_authority = ? WHERE study_id = ?').run(multisig, vaultAuthority, studyId);
    },

    async openFunding({ studyId, user, nowMs, reference, ttlMs }) {
      let id = '';
      db.transaction(() => {
        const s = ownStudy(db, studyId, user);
        const esc = escrowOf(db, s.id);
        if (s.payment_mode !== 'escrow' || !esc) throw fail('CONFLICT_STATE', 'This study is paid with test credits, not a wallet.');
        if (s.status !== 'draft') throw fail('CONFLICT_STATE', 'Fund a study before publishing it.');
        if (!linkedAddress(user.id)) throw fail('CONFLICT_STATE', 'Link the wallet you’ll fund this study from first.');
        if (db.prepare(`SELECT 1 FROM escrow_fundings WHERE study_id = ? AND status = 'confirmed'`).get(s.id)) throw fail('CONFLICT_STATE', 'This study is already funded.');
        const open = db.prepare(`SELECT id FROM escrow_fundings WHERE study_id = ? AND status IN ('awaiting_payment','pending') AND expires_at > ?`).get(s.id, nowMs) as { id: string } | undefined;
        if (open) {
          id = open.id;
          return;
        }
        id = newId();
        db.prepare(`INSERT INTO escrow_fundings (id, study_id, amount_units, reference, status, created_at, expires_at) VALUES (?,?,?,?, 'awaiting_payment', ?, ?)`).run(
          id,
          s.id,
          studyQuote(s, esc).totalUnits,
          reference,
          nowMs,
          nowMs + ttlMs,
        );
      })();
      return funding(id);
    },

    async fundingById(id) {
      return (db.prepare('SELECT * FROM escrow_fundings WHERE id = ?').get(id) as FundingRow | undefined) ?? null;
    },

    async fundingSignatureUsedElsewhere(signature, fundingId) {
      return db.prepare('SELECT 1 FROM escrow_fundings WHERE signature = ? AND id != ?').get(signature, fundingId) !== undefined;
    },

    async recordFundingVerdict({ fundingId, signature, verdict: v, source, nowMs, actorId, label }) {
      const verdict = { ...v };
      db.transaction(() => {
        const cur = funding(fundingId);
        if (cur.status === 'confirmed' || cur.status === 'failed' || cur.status === 'expired') return;
        if (cur.signature && cur.signature !== signature) throw fail('CONFLICT_STATE', 'This funding request already has a different transfer.');
        const usedElsewhere = db.prepare('SELECT 1 FROM escrow_fundings WHERE signature = ? AND id != ?').get(signature, fundingId);
        if (usedElsewhere) throw fail('CONFLICT_STATE', 'This transfer already funded another request.');
        // A refund needs somewhere to go: never confirm a transfer whose funding wallet is unknown.
        if (verdict.status === 'confirmed' && !source) {
          verdict.status = 'failed';
          verdict.reason = 'The transfer has no identifiable funding wallet, so a refund would have nowhere to go.';
        }
        if (verdict.status === 'pending') {
          db.prepare(`UPDATE escrow_fundings SET status = 'pending', signature = ? WHERE id = ?`).run(signature, fundingId);
        } else if (verdict.status === 'failed') {
          db.prepare(`UPDATE escrow_fundings SET status = 'failed', signature = ?, failure_reason = ? WHERE id = ?`).run(signature, verdict.reason, fundingId);
        } else {
          db.prepare(`UPDATE escrow_fundings SET status = 'confirmed', signature = ?, source = ?, confirmed_at = ? WHERE id = ?`).run(signature, source, nowMs, fundingId);
          db.prepare('UPDATE study_escrows SET funding_wallet = ? WHERE study_id = ?').run(source, cur.study_id);
          postEscrow(db, planFunding({ studyId: cur.study_id, fundingId, amountUnits: cur.amount_units }), nowMs, fundingId);
          audit(db, actorId, 'escrow.funding_confirmed', 'study', cur.study_id, `${cur.amount_units} units from ${source} (${label})`, nowMs);
          // A funding that lands after its study closed (its builder deleted the account while the
          // transfer was in flight) is refunded at once to the wallet it came from.
          const study = db.prepare('SELECT * FROM studies WHERE id = ?').get(cur.study_id) as StudyRow;
          // The builder can no longer sign once the study was closed by their account's deletion.
          if (study.status === 'closed') authorizeRefund(db, study, nowMs, actorId, 'arbiter');
        }
      })();
      return funding(fundingId);
    },

    async isFunded(studyId) {
      return db.prepare(`SELECT 1 FROM escrow_fundings WHERE study_id = ? AND status = 'confirmed'`).get(studyId) !== undefined;
    },

    async studyBooks(studyId, nowMs) {
      return studyEscrowBooks(db, studyId, nowMs);
    },

    async feeSweepOf() {
      return null;
    },

    async refundOf(studyId) {
      return (db.prepare(`SELECT id, status, amount_units FROM settlements WHERE kind = 'refund' AND study_id = ?`).get(studyId) as Pick<SettlementRow, 'id' | 'status' | 'amount_units'> | undefined) ?? null;
    },

    async payoutsOfTester(testerId) {
      return db.prepare(`SELECT * FROM settlements WHERE kind = 'payout' AND tester_id = ? ORDER BY created_at DESC`).all(testerId) as SettlementRow[];
    },

    async allPayouts() {
      return db.prepare(`SELECT * FROM settlements WHERE kind = 'payout' ORDER BY status = 'failed' DESC, created_at DESC`).all() as SettlementRow[];
    },

    async studyTitle(studyId) {
      return (db.prepare('SELECT title FROM studies WHERE id = ?').get(studyId) as { title: string }).title;
    },

    async expireUnpaidFundings(nowMs) {
      db.prepare(`UPDATE escrow_fundings SET status = 'expired' WHERE status = 'awaiting_payment' AND expires_at <= ?`).run(nowMs);
    },

    async pendingFundings() {
      return db.prepare(`SELECT * FROM escrow_fundings WHERE status = 'pending'`).all() as FundingRow[];
    },

    async dueSettlements(nowMs) {
      return db
        .prepare(`SELECT * FROM settlements WHERE status = 'pending' OR (status = 'failed' AND next_attempt_at <= ?) OR (status = 'submitted' AND signature IS NULL) OR status = 'awaiting_approval' ORDER BY created_at`)
        .all(nowMs) as SettlementRow[];
    },

    async setInFlightStatus(id, status) {
      db.prepare(`UPDATE settlements SET status = ? WHERE id = ? AND status IN ('submitted','awaiting_approval')`).run(status, id);
    },

    async beginAttempt(id, key) {
      db.prepare(`UPDATE settlements SET status = 'submitted', attempt = attempt + 1, attempt_key = ?, signature = NULL, failure_reason = NULL WHERE id = ?`).run(key, id);
    },

    async recordSubmitSignature(id, signature) {
      db.prepare('UPDATE settlements SET signature = ? WHERE id = ?').run(signature, id);
    },

    async recordAttemptFailure(s, reason, auditReason, nextAttemptAtMs, nowMs) {
      db.prepare(`UPDATE settlements SET status = 'failed', failure_reason = ?, next_attempt_at = ? WHERE id = ?`).run(reason, nextAttemptAtMs, s.id);
      audit(db, 'system', `escrow.${s.kind}_failed`, s.kind === 'payout' ? 'participation' : 'study', s.participation_id ?? s.study_id, auditReason, nowMs);
    },

    async submittedSettlements() {
      return db.prepare(`SELECT * FROM settlements WHERE status = 'submitted' AND signature IS NOT NULL`).all() as SettlementRow[];
    },

    async confirmSettlement(s, nowMs, label) {
      // The fee sweep exists only in POCKETQA_ENV=devnet (Firestore); SQLite never creates one.
      if (s.kind === 'fee') throw new Error('A fee sweep settlement on SQLite: the devnet fee sweep runs only on Firestore.');
      db.transaction(() => {
        const cur = db.prepare('SELECT status FROM settlements WHERE id = ?').get(s.id) as { status: SettlementRow['status'] };
        if (cur.status !== 'submitted') return;
        transitionPayout('submitted', 'confirm');
        db.prepare(`UPDATE settlements SET status = 'confirmed', settled_at = ? WHERE id = ?`).run(nowMs, s.id);
        if (s.kind === 'payout') {
          postEscrow(db, planSettlePayout({ studyId: s.study_id, participationId: s.participation_id!, testerId: s.tester_id!, amountUnits: s.amount_units }), nowMs, s.signature);
        } else {
          postEscrow(db, planSettleRefund({ studyId: s.study_id, funder: s.destination, amountUnits: s.amount_units }), nowMs, s.signature);
        }
        audit(db, 'system', `escrow.${s.kind}_settled`, s.kind === 'payout' ? 'participation' : 'study', s.participation_id ?? s.study_id, `${s.amount_units} units to ${s.destination} (${label})`, nowMs);
      })();
    },

    async markSettlementFailed(id, reason, nextAttemptAtMs) {
      db.prepare(`UPDATE settlements SET status = 'failed', failure_reason = ?, next_attempt_at = ? WHERE id = ? AND status = 'submitted'`).run(reason, nextAttemptAtMs, id);
    },

    async escalations(minAttempts) {
      return db.prepare(`SELECT id, kind, attempt, failure_reason FROM settlements WHERE status = 'failed' AND attempt >= ?`).all(minAttempts) as Pick<SettlementRow, 'id' | 'kind' | 'attempt' | 'failure_reason'>[];
    },

    async inFlightUnits(studyId) {
      return (db.prepare(`SELECT COALESCE(SUM(amount_units),0) AS s FROM settlements WHERE study_id = ? AND status IN ('submitted','failed')`).get(studyId) as { s: number }).s;
    },

    async hasOpenFunding(studyId) {
      return db.prepare(`SELECT 1 FROM escrow_fundings WHERE study_id = ? AND status IN ('awaiting_payment','pending')`).get(studyId) !== undefined;
    },

    async escrowStudiesWithMultisig(mode) {
      return (db.prepare(`SELECT study_id FROM study_escrows WHERE settlement = ? AND multisig IS NOT NULL`).all(mode) as { study_id: string }[]).map((r) => r.study_id);
    },

    async simRecordTransfer(r) {
      db.prepare(
        `INSERT INTO sim_chain_transfers (signature, network, mint, source, destination, amount_units, reference, kind, status, idempotency_key, block_time_ms) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      ).run(r.signature, r.network, r.mint, r.source, r.destination, r.amount_units, r.reference, r.kind, r.status, r.idempotency_key, r.block_time_ms);
      return r.signature;
    },

    async simTransfer(signature) {
      return (db.prepare('SELECT * FROM sim_chain_transfers WHERE signature = ?').get(signature) as SimTransferRow | undefined) ?? null;
    },

    async simSignatureForKey(key) {
      return (db.prepare('SELECT signature FROM sim_chain_transfers WHERE idempotency_key = ?').get(key) as { signature: string } | undefined)?.signature ?? null;
    },

    async simFinalizeProcessing(signature) {
      db.prepare(`UPDATE sim_chain_transfers SET status = 'finalized' WHERE signature = ? AND status = 'processing'`).run(signature);
    },

    async simTransfersOfKind(kind) {
      return db.prepare('SELECT * FROM sim_chain_transfers WHERE kind = ?').all(kind) as SimTransferRow[];
    },

    async simFundingSignature(reference) {
      return (db.prepare(`SELECT signature FROM sim_chain_transfers WHERE reference = ? AND kind = 'funding'`).get(reference) as { signature: string } | undefined)?.signature ?? null;
    },

    async reputationOf(userId, nowMs) {
      return reputationView(db, userId, nowMs);
    },

    async leaderboard(nowMs) {
      return leaderboardRows(db, nowMs);
    },

    async putLeaderboard(userId, optIn, alias, nowMs) {
      db.transaction(() => {
        const cur = db.prepare('SELECT alias FROM leaderboard_profiles WHERE user_id = ?').get(userId) as { alias: string | null } | undefined;
        const next = alias ?? cur?.alias ?? null;
        if (optIn && !next) throw fail('VALIDATION', 'Choose an alias to appear on the leaderboard.');
        if (next && db.prepare('SELECT 1 FROM leaderboard_profiles WHERE lower(alias) = lower(?) AND user_id != ?').get(next, userId)) {
          throw fail('CONFLICT_STATE', 'That alias is taken.');
        }
        db.prepare(
          'INSERT INTO leaderboard_profiles (user_id, opted_in, alias, updated_at) VALUES (?,?,?,?) ON CONFLICT (user_id) DO UPDATE SET opted_in = excluded.opted_in, alias = excluded.alias, updated_at = excluded.updated_at',
        ).run(userId, optIn ? 1 : 0, next, iso(nowMs));
      })();
    },

    async upholdFraud(participationId, reason, adminId, nowMs) {
      assertCleanCopy({ reason });
      db.transaction(() => {
        const p = getParticipationRow(db, participationId);
        if (!p) throw notFound('Participation');
        const accepted =
          p.status === 'approved' || (p.status === 'resolved' && (db.prepare(`SELECT outcome FROM disputes WHERE participation_id = ?`).get(p.id) as { outcome: string } | undefined)?.outcome === 'overturned');
        if (!accepted) throw fail('CONFLICT_STATE', 'Only accepted work can be marked fraudulent.');
        if (db.prepare('SELECT 1 FROM fraud_findings WHERE participation_id = ?').get(p.id)) throw fail('CONFLICT_STATE', 'This work is already marked fraudulent.');
        db.prepare('INSERT INTO fraud_findings (participation_id, reason, decided_by, created_at) VALUES (?,?,?,?)').run(p.id, reason, adminId, iso(nowMs));
        reverseForFraud(db, p, nowMs);
        audit(db, adminId, 'reputation.fraud_upheld', 'participation', p.id, reason, nowMs);
      })();
    },

    async exportUser(userId, nowMs) {
      return { payments: paymentsExport(db, userId), reputation: reputationExport(db, userId, nowMs) };
    },

    // NOT async: this runs inside the caller's account-deletion db.transaction, so it must do its
    // work and throw synchronously (a rejected promise would not roll that transaction back).
    purgeUser(userId, nowMs) {
      // Demo transfers carry wallet addresses (on-chain pseudonyms) and no ledger value.
      db.prepare('DELETE FROM devnet_transfers WHERE builder_id = ? OR tester_id = ?').run(userId, userId);
      db.prepare('DELETE FROM wallet_links WHERE user_id = ?').run(userId);
      db.prepare('DELETE FROM wallet_nonces WHERE user_id = ?').run(userId);
      // Escrow (ADR 0007): a builder's wallet-funded drafts close with the account, so funds are
      // never stranded. Unpaid funding requests expire; a funded vault is set aside for refund to
      // the wallet that funded it; a funding still in flight is refunded once it confirms
      // (recordFundingVerdict). The studies purge then closes the study rows, so this runs first.
      for (const s of db.prepare(`SELECT * FROM studies WHERE builder_id = ? AND payment_mode = 'escrow' AND status = 'draft'`).all(userId) as StudyRow[]) {
        db.prepare(`UPDATE escrow_fundings SET status = 'expired' WHERE study_id = ? AND status = 'awaiting_payment'`).run(s.id);
        authorizeRefund(db, { ...s, status: 'closed' }, nowMs, userId, 'arbiter');
      }
      // The leaderboard pseudonym goes with the account; points stay append-only under the
      // now-anonymous id (like ledger postings, ADR 0002).
      db.prepare('DELETE FROM leaderboard_profiles WHERE user_id = ?').run(userId);
      return Promise.resolve({ mediaKeys: [] });
    },
  };
}
