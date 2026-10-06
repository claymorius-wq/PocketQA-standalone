import type { DeviceProfile } from '@pocket-qa/contracts';
import {
  assertCleanCopy,
  balanceOf,
  canEditTaskNotes,
  canOpenDispute,
  checkEligibility,
  closeStudyPlan,
  holdsBudget,
  planRelease,
  planReserve,
  planReward,
  planTopUp,
  quoteEscrow,
  requiredReserve,
  stuckReason,
  studyAccount,
  studyBudget,
  transitionParticipation,
  transitionStudy,
  userAccount,
  validateDecision,
  type Account,
  type Kind,
  type Posting,
} from '@pocket-qa/domain';
import type { DB } from '../../db';
import { audit, authorizePayout, authorizeRefund, canReserve, escrowOf, studyQuote, vaultBalance } from '../../escrow';
import { awardApproval } from '../../reputation';
import { fail, iso, newId, notFound } from '../../util';
import type { UserRow } from '../../views/core';
import type { DisputeRow, FindingRow, ParticipationRow, StudyRow } from '../../views/studies';
import type { KindSums, LedgerEntry, ParticipationStatus, StudiesRepo, Task, TaskInput } from './types';

/**
 * SQLite studies repository: today's SQL, moved verbatim out of the handlers. Every multi-statement
 * operation keeps its `db.transaction` inside the method; the composite ones (publish, close,
 * consent, decisions, disputes) call the legacy synchronous escrow, reputation and audit helpers
 * INSIDE that transaction, because better-sqlite3 transaction bodies must be synchronous and the
 * one-reward / budget / slot invariants only hold if everything commits together.
 */
export function sqliteStudiesRepo(db: DB): StudiesRepo {
  const getStudy = (id: string) => db.prepare('SELECT * FROM studies WHERE id = ?').get(id) as StudyRow | undefined;
  const getParticipation = (id: string) => db.prepare('SELECT * FROM participations WHERE id = ?').get(id) as ParticipationRow | undefined;
  const getDispute = (id: string) => db.prepare('SELECT * FROM disputes WHERE id = ?').get(id) as DisputeRow | undefined;

  const tasksOf = (studyId: string): Task[] =>
    (
      db.prepare('SELECT id, ord, instruction, success_criteria FROM tasks WHERE study_id = ? ORDER BY ord').all(studyId) as {
        id: string;
        ord: number;
        instruction: string;
        success_criteria: string | null;
      }[]
    ).map((t) => ({ id: t.id, order: t.ord, instruction: t.instruction, ...(t.success_criteria ? { successCriteria: t.success_criteria } : {}) }));

  const participationStatuses = (studyId: string): ParticipationStatus[] =>
    (db.prepare('SELECT id, status, decided_at FROM participations WHERE study_id = ?').all(studyId) as { id: string; status: ParticipationStatus['status']; decided_at: string | null }[]).map(
      (r) => ({ id: r.id, status: r.status, decidedAtMs: r.decided_at ? Date.parse(r.decided_at) : null }),
    );

  const slotsFilled = (studyId: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM participations WHERE study_id = ? AND status != 'withdrawn'`).get(studyId) as { n: number }).n;

  const studyBalance = (studyId: string) =>
    (db.prepare('SELECT COALESCE(SUM(amount),0) AS s FROM ledger WHERE account = ?').get(studyAccount(studyId)) as { s: number }).s;

  const kindSums = (studyId: string): KindSums => {
    const rows = db.prepare(`SELECT kind, COALESCE(SUM(amount),0) AS s FROM ledger WHERE account = ? GROUP BY kind`).all(studyAccount(studyId)) as { kind: Kind; s: number }[];
    return Object.fromEntries(rows.map((r) => [r.kind, r.s]));
  };

  /** The test-credit budget (same formula as the study view), read inside the caller's transaction. */
  const available = (s: StudyRow, nowMs: number) => {
    if (s.payment_mode === 'escrow') return 0;
    const by = kindSums(s.id);
    const sum = (k: Kind) => by[k] ?? 0;
    return studyBudget({
      reserved: sum('study_reserve'),
      awarded: -(sum('reward_credit') + sum('dispute_credit')),
      released: -sum('study_release'),
      rewardCredits: s.reward_credits,
      committingCount: participationStatuses(s.id).filter((p) => holdsBudget(p, nowMs)).length,
      closed: s.status === 'closed',
    }).available;
  };

  const accountBalance = (account: Account) =>
    balanceOf(db.prepare('SELECT account, amount FROM ledger WHERE account = ?').all(account) as { account: Account; amount: number }[], account);

  /** Append-only double-entry posting (ledger.ts `post`). */
  const post = (postings: Posting[], nowMs: number, txId: string = newId()) => {
    if (postings.length === 0) return;
    if (postings.reduce((s, p) => s + p.amount, 0) !== 0) throw new Error('unbalanced ledger transaction');
    const ins = db.prepare('INSERT INTO ledger (id, tx_id, account, amount, kind, study_id, participation_id, created_at) VALUES (?,?,?,?,?,?,?,?)');
    postings.forEach((p, i) => ins.run(`${txId}:${i}`, txId, p.account, p.amount, p.kind, p.studyId, p.participationId, iso(nowMs)));
  };

  const builderStatus = (builderId: string) => (db.prepare('SELECT status FROM users WHERE id = ?').get(builderId) as { status: UserRow['status'] } | undefined)?.status;
  const openForNewWork = (s: StudyRow) => s.status === 'published' && s.moderation === 'ok' && builderStatus(s.builder_id) === 'active';

  const writeTasks = (studyId: string, tasks: TaskInput[], ids: string[] = []) => {
    db.prepare('DELETE FROM tasks WHERE study_id = ?').run(studyId);
    const ins = db.prepare('INSERT INTO tasks (id, study_id, ord, instruction, success_criteria) VALUES (?,?,?,?,?)');
    tasks.forEach((t, i) => ins.run(ids[i] ?? newId(), studyId, i, t.instruction, t.successCriteria ?? null));
  };

  const adminAudit = (actorId: string, action: string, targetType: 'study' | 'user' | 'dispute' | 'participation', targetId: string, reason: string, nowMs: number, id: string = newId()) =>
    db.prepare('INSERT INTO audit (id, actor_id, action, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?,?)').run(id, actorId, action, targetType, targetId, reason, iso(nowMs));

  /** Tester's own participation, else 404 (access.ts rule, inside the transaction). */
  const testerOwned = (id: string, tester: UserRow) => {
    const p = getParticipation(id);
    if (!p || p.tester_id !== tester.id) throw notFound('Participation');
    return { p, s: getStudy(p.study_id)! };
  };

  return {
    // ── Studies and tasks ────────────────────────────────────────────────────────────────
    async getStudy(id) {
      return getStudy(id);
    },
    async listStudiesByBuilder(builderId) {
      return db.prepare('SELECT * FROM studies WHERE builder_id = ? ORDER BY created_at DESC').all(builderId) as StudyRow[];
    },
    async listNonDraftStudies() {
      return db.prepare(`SELECT * FROM studies WHERE status != 'draft' ORDER BY created_at DESC`).all() as StudyRow[];
    },
    async listOpenStudiesFor(testerId) {
      return db
        .prepare(
          `SELECT s.* FROM studies s JOIN users b ON b.id = s.builder_id
           WHERE s.status = 'published' AND s.moderation = 'ok' AND b.status = 'active'
           AND s.id NOT IN (SELECT study_id FROM participations WHERE tester_id = ?) ORDER BY s.published_at DESC`,
        )
        .all(testerId) as StudyRow[];
    },
    async openForNewWork(s) {
      return openForNewWork(s);
    },
    async tasksOf(studyId) {
      return tasksOf(studyId);
    },
    async taskInStudy(taskId, studyId) {
      return tasksOf(studyId).some((t) => t.id === taskId);
    },
    async slotsFilled(studyId) {
      return slotsFilled(studyId);
    },
    async participationStatuses(studyId) {
      return participationStatuses(studyId);
    },

    async createStudy(n) {
      db.transaction(() => {
        // Rule D (plan R12): a retry of a committed create (same id) writes nothing.
        if (getStudy(n.id)) return;
        db.prepare(
          `INSERT INTO studies (id, builder_id, title, objective, build_under_test, device_criteria_json, reward_credits, payment_mode, slots, consent_text, consent_version, status, created_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,1,'draft',?)`,
        ).run(n.id, n.builderId, n.title, n.objective, n.buildUnderTest, n.deviceCriteriaJson, n.rewardCredits, n.escrow ? 'escrow' : 'test_credits', n.slots, n.consentText, n.createdAt);
        if (n.escrow) {
          db.prepare(`INSERT INTO study_escrows (study_id, settlement, network, mint, vault, fee_bps, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
            n.id,
            n.escrow.settlement,
            n.escrow.network,
            n.escrow.mint,
            n.escrow.vault,
            n.escrow.feeBps,
            n.createdAt,
          );
        }
        writeTasks(n.id, n.tasks, n.taskIds);
      })();
    },

    async updateDraftStudy(studyId, builder, b) {
      db.transaction(() => {
        const s = getStudy(studyId);
        if (!s || s.builder_id !== builder.id) throw notFound('Study');
        if (s.status !== 'draft') throw fail('CONFLICT_STATE', 'Only draft studies can be edited.');
        const escrow = s.payment_mode === 'escrow';
        if (escrow && b.rewardCredits !== undefined) throw fail('VALIDATION', 'Escrow studies pay in tokens: change rewardUnits, not rewardCredits.');
        if (!escrow && b.rewardUnits !== undefined) throw fail('VALIDATION', 'Test-credit studies use rewardCredits.');
        if (escrow && (b.rewardUnits !== undefined || b.slots !== undefined)) {
          // The funded amount was fixed by the quote: the terms lock once funding has started.
          if (db.prepare(`SELECT 1 FROM escrow_fundings WHERE study_id = ? AND status IN ('awaiting_payment','pending','confirmed')`).get(s.id)) {
            throw fail('CONFLICT_STATE', 'The reward and slots are locked once funding has started.');
          }
          quoteEscrow({ rewardUnits: b.rewardUnits ?? s.reward_credits, slots: b.slots ?? s.slots, feeBps: escrowOf(db, s.id)!.fee_bps });
        }
        const consentChanged = b.consentText !== undefined && b.consentText !== s.consent_text;
        db.prepare(
          `UPDATE studies SET title = ?, objective = ?, build_under_test = ?, device_criteria_json = ?, reward_credits = ?, slots = ?, consent_text = ?, consent_version = ? WHERE id = ?`,
        ).run(
          b.title ?? s.title,
          b.objective ?? s.objective,
          b.buildUnderTest !== undefined ? b.buildUnderTest : s.build_under_test,
          b.deviceCriteria !== undefined ? JSON.stringify(b.deviceCriteria) : s.device_criteria_json,
          (escrow ? b.rewardUnits : b.rewardCredits) ?? s.reward_credits,
          b.slots ?? s.slots,
          b.consentText ?? s.consent_text,
          consentChanged ? s.consent_version + 1 : s.consent_version,
          s.id,
        );
        if (b.tasks) writeTasks(s.id, b.tasks);
      })();
    },

    async studyTransition(studyId, user, action, settlementEnabled, now) {
      db.transaction(() => {
        const s = getStudy(studyId);
        if (!s || s.builder_id !== user.id) throw notFound('Study');
        const next = transitionStudy(s.status, action);
        if ((action === 'publish' || action === 'resume') && s.moderation === 'suspended') {
          throw fail('CONFLICT_STATE', 'This study is suspended by moderation.');
        }
        const escrow = s.payment_mode === 'escrow';
        if (escrow && (action === 'publish' || action === 'resume') && !settlementEnabled) {
          throw fail('FEATURE_UNAVAILABLE', 'Wallet-funded studies aren’t available on this deployment.');
        }
        if (action === 'publish' && escrow) {
          // Publish only on a confirmed funding that covers the whole quote (no holds exist yet).
          const funded = db.prepare(`SELECT 1 FROM escrow_fundings WHERE study_id = ? AND status = 'confirmed'`).get(s.id);
          if (!funded || vaultBalance(db, s.id) < studyQuote(s, escrowOf(db, s.id)!).totalUnits) {
            throw fail('BUDGET_INSUFFICIENT', 'Fund this study from your wallet, and wait for the funding to be confirmed, before publishing.');
          }
          db.prepare('UPDATE studies SET status = ?, published_at = ? WHERE id = ?').run(next, iso(now), s.id);
        } else if (action === 'publish') {
          const amount = requiredReserve({ rewardCredits: s.reward_credits, slots: s.slots });
          post(planReserve({ builderId: user.id, studyId: s.id, amount, builderBalance: accountBalance(userAccount(user.id)) }), now);
          db.prepare('UPDATE studies SET status = ?, published_at = ? WHERE id = ?').run(next, iso(now), s.id);
        } else if (action === 'close') {
          const plan = closeStudyPlan({ studyBalance: escrow ? vaultBalance(db, s.id) : studyBalance(s.id), nowMs: now, participations: participationStatuses(s.id) });
          for (const id of plan.withdraw) {
            db.prepare(`UPDATE participations SET status = 'withdrawn', decision_reason = 'Study closed by the builder.' WHERE id = ?`).run(id);
          }
          db.prepare('UPDATE studies SET status = ?, closed_at = ? WHERE id = ?').run(next, iso(now), s.id);
          // Escrow: unused funds go back to the funding wallet once the refund settles.
          if (escrow) authorizeRefund(db, { ...s, status: 'closed' }, now, user.id);
          else post(planRelease({ studyId: s.id, builderId: user.id, studyBalance: plan.release }), now);
        } else {
          db.prepare('UPDATE studies SET status = ? WHERE id = ?').run(next, s.id);
        }
      })();
    },

    async moderateStudy(studyId, state, a) {
      const s = getStudy(studyId);
      if (!s) throw notFound('Study');
      db.transaction(() => {
        // Rule D (plan R12): this audit row exists, so the moderation was already applied.
        if (a.id && db.prepare('SELECT 1 FROM audit WHERE id = ?').get(a.id)) return;
        db.prepare('UPDATE studies SET moderation = ? WHERE id = ?').run(state, s.id);
        adminAudit(a.actorId, a.action, 'study', s.id, a.reason, a.nowMs, a.id);
      })();
      return getStudy(s.id)!;
    },

    // ── Participations ───────────────────────────────────────────────────────────────────
    async getParticipation(id) {
      return getParticipation(id);
    },
    async findParticipation(studyId, testerId) {
      return db.prepare('SELECT * FROM participations WHERE study_id = ? AND tester_id = ?').get(studyId, testerId) as ParticipationRow | undefined;
    },
    async listParticipationsByTester(testerId) {
      return db.prepare('SELECT * FROM participations WHERE tester_id = ? ORDER BY consented_at DESC').all(testerId) as ParticipationRow[];
    },
    async listParticipationsByStudy(studyId) {
      return db.prepare('SELECT * FROM participations WHERE study_id = ? ORDER BY consented_at').all(studyId) as ParticipationRow[];
    },
    async listSubmittedWithStudy() {
      return db
        .prepare(
          `SELECT p.*, s.title AS study_title, u.status AS builder_status FROM participations p
           JOIN studies s ON s.id = p.study_id JOIN users u ON u.id = s.builder_id
           WHERE p.status = 'submitted' ORDER BY p.submitted_at`,
        )
        .all() as Awaited<ReturnType<StudiesRepo['listSubmittedWithStudy']>>;
    },
    async taskNotes(participationId) {
      return db.prepare('SELECT task_id, note FROM task_notes WHERE participation_id = ?').all(participationId) as { task_id: string; note: string }[];
    },

    async consent({ studyId, tester: user, consentVersion, payoutAddress: confirmed, settlementEnabled, id, nowMs: now }) {
      db.transaction(() => {
        const s = getStudy(studyId);
        if (!s || !openForNewWork(s)) throw notFound('Study');
        if (db.prepare('SELECT 1 FROM participations WHERE study_id = ? AND tester_id = ?').get(s.id, user.id)) {
          throw fail('CONFLICT_STATE', 'You already joined this study.');
        }
        if (consentVersion !== s.consent_version) {
          throw fail('CONFLICT_STATE', 'The consent text changed. Read the latest version and consent again.');
        }
        const device = user.device_json ? (JSON.parse(user.device_json) as DeviceProfile) : null;
        const elig = checkEligibility(JSON.parse(s.device_criteria_json), device);
        if (!elig.eligible) throw fail('CONFLICT_STATE', `Not eligible: ${elig.reasons.join(' ')}`);
        let payoutAddress: string | null = null;
        if (s.payment_mode === 'escrow') {
          if (!settlementEnabled) throw fail('FEATURE_UNAVAILABLE', 'Wallet-funded studies aren’t available on this deployment.');
          // The payout wallet is frozen here, with the tester's explicit confirmation of it.
          const linked = (db.prepare('SELECT address FROM wallet_links WHERE user_id = ?').get(user.id) as { address: string } | undefined)?.address;
          if (!linked) throw fail('CONFLICT_STATE', 'Link the wallet you want rewards sent to before joining a wallet-funded study.');
          if (confirmed !== linked) throw fail('VALIDATION', 'Confirm your linked wallet as the payout wallet for this study.');
          // Self-dealing: a wallet that funded any of this builder's studies can't be paid by them.
          const funder = db
            .prepare(`SELECT 1 FROM study_escrows e JOIN studies x ON x.id = e.study_id WHERE x.builder_id = ? AND e.funding_wallet = ?`)
            .get(s.builder_id, linked);
          if (funder) throw fail('CONFLICT_STATE', 'This wallet funded a study by the same builder, so it can’t receive this study’s rewards.');
          payoutAddress = linked;
          if (slotsFilled(s.id) >= s.slots || !canReserve(db, s, now)) throw fail('CONFLICT_STATE', 'This study is full.');
        } else if (slotsFilled(s.id) >= s.slots || available(s, now) < s.reward_credits) {
          throw fail('CONFLICT_STATE', 'This study is full.');
        }
        db.prepare(
          `INSERT INTO participations (id, study_id, tester_id, status, consent_version, consented_at, reward_credits, payout_address) VALUES (?,?,?,'consented',?,?,?,?)`,
        ).run(id, s.id, user.id, s.consent_version, iso(now), s.reward_credits, payoutAddress);
        if (payoutAddress) audit(db, user.id, 'escrow.payout_wallet_frozen', 'participation', id, `Payout wallet ${payoutAddress} confirmed at consent`, now);
      })();
      return getParticipation(id)!;
    },

    async testerTransition(participationId, user, action, reason, now) {
      db.transaction(() => {
        const { p, s } = testerOwned(participationId, user);
        if (action === 'start' && (s.status !== 'published' || s.moderation !== 'ok')) {
          throw fail('CONFLICT_STATE', 'This study is not accepting work right now.');
        }
        // Direct uploads still in flight would be silently dropped by submission (ADR 0005 §3).
        if (action === 'submit') {
          const open = db.prepare(`SELECT COUNT(*) AS n FROM upload_intents WHERE participation_id = ? AND status IN ('pending','completing') AND expires_at > ?`).get(p.id, now) as { n: number };
          if (open.n > 0) throw fail('CONFLICT_STATE', 'Finish or cancel your evidence uploads before submitting.');
        }
        const next = transitionParticipation(p.status, action);
        const col = action === 'start' ? 'started_at' : action === 'submit' ? 'submitted_at' : null;
        if (col) db.prepare(`UPDATE participations SET status = ?, ${col} = ? WHERE id = ?`).run(next, iso(now), p.id);
        else db.prepare('UPDATE participations SET status = ?, decision_reason = ? WHERE id = ?').run(next, reason, p.id);
      })();
      return getParticipation(participationId)!;
    },

    async putTaskNote(participationId, user, taskId, note) {
      // Today's statement order, now in one transaction (async callers can interleave).
      db.transaction(() => {
        const { p, s } = testerOwned(participationId, user);
        if (!canEditTaskNotes(p.status)) throw fail('CONFLICT_STATE', 'Notes can only change while the participation is in progress.');
        if (!tasksOf(s.id).some((t) => t.id === taskId)) throw fail('VALIDATION', 'Unknown task for this study.');
        db.prepare(
          'INSERT INTO task_notes (participation_id, task_id, note) VALUES (?,?,?) ON CONFLICT (participation_id, task_id) DO UPDATE SET note = excluded.note',
        ).run(p.id, taskId, note);
      })();
      return getParticipation(participationId)!;
    },

    async decideParticipation(participationId, input, now) {
      const user = input.actor;
      // An admin's reason is checked before anything is read (today's order).
      if (input.by === 'admin_stuck') assertCleanCopy({ reason: input.reason });
      db.transaction(() => {
        if (input.by === 'builder') {
          const p = getParticipation(participationId);
          const s = p ? getStudy(p.study_id) : undefined;
          if (!p || !s || s.builder_id !== user.id) throw notFound('Participation');
          const d = validateDecision({ decision: input.decision, reviewerId: user.id, reason: input.reason });
          assertCleanCopy({ reason: d.reason ?? undefined, note: input.note });
          const next = transitionParticipation(p.status, input.decision);
          if (input.decision === 'approve' && s.payment_mode === 'escrow') {
            authorizePayout(db, s, p, now, user.id, 'approved by the builder');
          } else if (input.decision === 'approve') {
            // This participation is still counted as committed, so add its own hold back.
            const avail = available(s, now) + p.reward_credits;
            post(
              planReward({ studyId: s.id, testerId: p.tester_id, participationId: p.id, amount: p.reward_credits, studyAvailableIncludingThis: avail, kind: 'reward_credit' }),
              now,
            );
          }
          db.prepare('UPDATE participations SET status = ?, decided_at = ?, decided_by = ?, decision_reason = ? WHERE id = ?').run(
            next,
            iso(now),
            user.id,
            d.reason ?? input.note ?? null,
            p.id,
          );
          if (input.decision === 'approve') awardApproval(db, s, p, input.helpful, now);
          return;
        }
        // Admin decision on a stuck submission only (builder inactive, or overdue): same rules
        // as a builder decision (one credit at most, budget never negative), reason audited.
        const { decision, reason } = input;
        const p = getParticipation(participationId);
        if (!p) throw notFound('Participation');
        const s = getStudy(p.study_id)!;
        const builder = db.prepare('SELECT status FROM users WHERE id = ?').get(s.builder_id) as { status: 'active' | 'suspended' | 'deleted' };
        const why = stuckReason({ status: p.status, submittedAtMs: p.submitted_at ? Date.parse(p.submitted_at) : null, builderStatus: builder.status }, now);
        if (!why) throw fail('CONFLICT_STATE', 'Only stuck submissions can be decided by an admin; the study owner reviews the rest.');
        const next = transitionParticipation(p.status, decision);
        if (decision === 'approve' && s.payment_mode === 'escrow') {
          authorizePayout(db, s, p, now, user.id, `admin decision on stuck work (${why})`, 'arbiter');
        } else if (decision === 'approve') {
          const avail = available(s, now) + p.reward_credits;
          post(planReward({ studyId: s.id, testerId: p.tester_id, participationId: p.id, amount: p.reward_credits, studyAvailableIncludingThis: avail, kind: 'reward_credit' }), now);
        }
        db.prepare('UPDATE participations SET status = ?, decided_at = ?, decided_by = ?, decision_reason = ? WHERE id = ?').run(next, iso(now), user.id, reason, p.id);
        if (decision === 'approve') awardApproval(db, s, p, false, now);
        adminAudit(user.id, `participation.${decision}`, 'participation', p.id, `${reason} [stuck: ${why}]`, now);
      })();
      return getParticipation(participationId)!;
    },

    // ── Findings and disputes ────────────────────────────────────────────────────────────
    async listFindings(participationId) {
      return db.prepare('SELECT * FROM findings WHERE participation_id = ? ORDER BY created_at').all(participationId) as FindingRow[];
    },

    async createFinding(participationId, user, b, id, nowMs) {
      db.transaction(() => {
        // Rule D (plan R12): a retry of a committed create (same id) returns that finding.
        if (db.prepare('SELECT 1 FROM findings WHERE id = ?').get(id)) return;
        const p = getParticipation(participationId);
        const s = p ? getStudy(p.study_id) : undefined;
        if (!p || !s || s.builder_id !== user.id) throw notFound('Participation');
        if (p.status === 'consented' || p.status === 'in_progress' || p.status === 'withdrawn') {
          throw fail('CONFLICT_STATE', 'Findings can be added once the tester has submitted.');
        }
        assertCleanCopy({ title: b.title, description: b.description });
        if (b.evidenceId && !db.prepare('SELECT 1 FROM evidence WHERE id = ? AND participation_id = ?').get(b.evidenceId, p.id)) {
          throw fail('VALIDATION', 'evidenceId does not belong to this participation.');
        }
        db.prepare(
          'INSERT INTO findings (id, participation_id, title, severity, description, evidence_id, timestamp_ms, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
        ).run(id, p.id, b.title, b.severity, b.description, b.evidenceId ?? null, b.timestampMs ?? null, user.id, iso(nowMs));
      })();
      return db.prepare('SELECT * FROM findings WHERE id = ?').get(id) as FindingRow;
    },

    async getDispute(id) {
      return getDispute(id);
    },
    async listDisputesByStudy(studyId) {
      return db
        .prepare(`SELECT d.* FROM disputes d JOIN participations p ON p.id = d.participation_id WHERE p.study_id = ? ORDER BY d.created_at DESC`)
        .all(studyId) as DisputeRow[];
    },
    async listDisputesByOpener(userId) {
      return db.prepare('SELECT * FROM disputes WHERE opened_by = ? ORDER BY created_at DESC').all(userId) as DisputeRow[];
    },
    async listAllDisputes() {
      return db.prepare(`SELECT * FROM disputes ORDER BY status = 'open' DESC, created_at DESC`).all() as DisputeRow[];
    },

    async openDispute(participationId, user, reason, id, now) {
      db.transaction(() => {
        const { p } = testerOwned(participationId, user);
        const next = transitionParticipation(p.status, 'dispute');
        if (!canOpenDispute({ status: p.status, decidedAtMs: p.decided_at ? Date.parse(p.decided_at) : null }, now)) {
          throw fail('CONFLICT_STATE', 'The 7-day dispute window for this decision has ended.');
        }
        db.prepare('UPDATE participations SET status = ? WHERE id = ?').run(next, p.id);
        db.prepare(`INSERT INTO disputes (id, participation_id, opened_by, reason, status, created_at) VALUES (?,?,?,?,'open',?)`).run(id, p.id, user.id, reason, iso(now));
      })();
      return getDispute(id)!;
    },

    async resolveDispute(disputeId, admin, outcome, note, now) {
      assertCleanCopy({ note });
      db.transaction(() => {
        const d = getDispute(disputeId);
        if (!d) throw notFound('Dispute');
        if (d.status !== 'open') throw fail('CONFLICT_STATE', 'This dispute is already resolved.');
        const p = getParticipation(d.participation_id)!;
        const s = getStudy(p.study_id)!;
        const next = transitionParticipation(p.status, 'resolve');
        if (outcome === 'overturned' && s.payment_mode === 'escrow') {
          // The admin decides the outcome only; the amount and wallet were fixed earlier.
          authorizePayout(db, s, p, now, admin.id, `dispute ${d.id} overturned`, 'arbiter');
        } else if (outcome === 'overturned') {
          // The disputed participation still holds its reward, so add that hold back.
          const avail = available(s, now) + p.reward_credits;
          post(planReward({ studyId: s.id, testerId: p.tester_id, participationId: p.id, amount: p.reward_credits, studyAvailableIncludingThis: avail, kind: 'dispute_credit' }), now);
        }
        db.prepare('UPDATE participations SET status = ? WHERE id = ?').run(next, p.id);
        if (outcome === 'overturned') awardApproval(db, s, p, false, now);
        db.prepare(`UPDATE disputes SET status = 'resolved', outcome = ?, resolution_note = ?, resolved_by = ?, resolved_at = ? WHERE id = ?`).run(
          outcome,
          note,
          admin.id,
          iso(now),
          d.id,
        );
        adminAudit(admin.id, `dispute.${outcome}`, 'dispute', d.id, note, now);
      })();
      return getDispute(disputeId)!;
    },

    // ── Test-credit ledger ───────────────────────────────────────────────────────────────
    async accountBalance(account) {
      return accountBalance(account);
    },
    async ledgerEntries(account) {
      return db
        .prepare('SELECT id, kind, amount, study_id, participation_id, created_at FROM ledger WHERE account = ? ORDER BY created_at DESC, rowid DESC')
        .all(account) as LedgerEntry[];
    },
    async studyKindSums(studyId) {
      return kindSums(studyId);
    },
    async topUp(userId, amount, nowMs, txId = newId()) {
      const postings = planTopUp(userId, amount);
      db.transaction(() => {
        // Rule D (plan R12): this ledger transaction was already posted.
        if (db.prepare('SELECT 1 FROM ledger WHERE tx_id = ?').get(txId)) return;
        post(postings, nowMs, txId);
      })();
    },

    // ── Account export and deletion ──────────────────────────────────────────────────────
    async liveStudiesOf(userId) {
      return (db.prepare(`SELECT COUNT(*) AS n FROM studies WHERE builder_id = ? AND status IN ('published','paused')`).get(userId) as { n: number }).n;
    },
    async openParticipationsOf(userId) {
      return (db.prepare(`SELECT COUNT(*) AS n FROM participations WHERE tester_id = ? AND status IN ('submitted','disputed')`).get(userId) as { n: number }).n;
    },
    async exportUser(userId) {
      const studies = db.prepare('SELECT * FROM studies WHERE builder_id = ?').all(userId) as StudyRow[];
      const participations = db.prepare('SELECT * FROM participations WHERE tester_id = ?').all(userId) as ParticipationRow[];
      const partIds = participations.map((p) => p.id);
      const inList = partIds.length ? partIds.map(() => '?').join(',') : `''`;
      const findings = db.prepare(`SELECT * FROM findings WHERE created_by = ? OR participation_id IN (${inList})`).all(userId, ...partIds) as FindingRow[];
      const disputes = db.prepare('SELECT * FROM disputes WHERE opened_by = ?').all(userId) as DisputeRow[];
      return { studies, participations, findings, disputes };
    },

    // Deliberately not `async`: it runs inside the caller's synchronous db.transaction, so a
    // failure must throw synchronously to roll that transaction back.
    purgeUser(userId, nowMs) {
      // Evidence the user recorded, and evidence inside studies the user owns.
      db.prepare(
        `UPDATE findings SET evidence_id = NULL WHERE evidence_id IN (
           SELECT e.id FROM evidence e JOIN participations p ON p.id = e.participation_id
           JOIN studies s ON s.id = p.study_id WHERE p.tester_id = ? OR s.builder_id = ?)`,
      ).run(userId, userId);
      db.prepare('DELETE FROM task_notes WHERE participation_id IN (SELECT id FROM participations WHERE tester_id = ?)').run(userId);
      db.prepare(`UPDATE participations SET status = CASE WHEN status IN ('consented','in_progress') THEN 'withdrawn' ELSE status END, decision_reason = NULL WHERE tester_id = ?`).run(userId);
      db.prepare(`UPDATE disputes SET reason = '[deleted]' WHERE opened_by = ?`).run(userId);
      // Escrow (ADR 0007): a builder's wallet-funded drafts close with the account, so funds are
      // never stranded; a funded vault is set aside for refund to the wallet that funded it.
      for (const s of db.prepare(`SELECT * FROM studies WHERE builder_id = ? AND payment_mode = 'escrow' AND status = 'draft'`).all(userId) as StudyRow[]) {
        db.prepare(`UPDATE studies SET status = 'closed', closed_at = ? WHERE id = ?`).run(iso(nowMs), s.id);
        authorizeRefund(db, { ...s, status: 'closed' }, nowMs, userId, 'arbiter');
      }
      return Promise.resolve({ mediaKeys: [] });
    },
  };
}
