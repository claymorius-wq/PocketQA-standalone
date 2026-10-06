import type { DeviceProfile } from '@pocket-qa/contracts';
import {
  assertCleanCopy,
  canEditTaskNotes,
  canOpenDispute,
  checkEligibility,
  closeStudyPlan,
  FAUCET,
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
import { AggregateField, type DocumentData, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { runTxCtx, type TxCtx, type TxHooks } from '../../firestore/tx';
import { fail, iso, newId, notFound } from '../../util';
import type { UserRow } from '../../views/core';
import type { DisputeRow, FindingRow, ParticipationRow, StudyRow } from '../../views/studies';
import { auditInTx, userInTx } from '../core/firestore';
import type { AuditRow } from '../core/types';
import {
  authorizePayoutInTx,
  authorizeRefundInTx,
  awardApprovalInTx,
  canReserveInTx,
  createEscrowInTx,
  escrowOfInTx,
  fundingStartedInTx,
  isFundedInTx,
  vaultBalanceInTx,
  walletAddressOfInTx,
  walletFundedBuilderInTx,
} from '../escrow/firestore';
import type { EscrowRow } from '../escrow/types';
import { evidenceInParticipationInTx, openIntentCountInTx } from '../evidence/firestore';
import type { KindSums, LedgerEntry, ParticipationStatus, StudiesRepo, StuckCandidate, Task, TaskInput } from './types';

/**
 * Studies repository on Firestore (plan §2.1, §3 T1–T3, T5, T6; r2 §R2 rows 2, 3, 7, 8, 11; R9 ids).
 *
 * Documents (field names are the SQLite row names, so rows and views are unchanged):
 *  studies/{id}                         StudyRow + join_seq (bumped by every join, see `consent`)
 *  studies/{sid}/tasks/{tid}            { id, study_id, ord, instruction, success_criteria }
 *  participations/{id}                  ParticipationRow (legacy id as doc id, plan R9)
 *  participationPairs/{study}_{tester}  guard: UNIQUE(study_id, tester_id) → { participation_id }
 *  participations/{pid}/notes/{taskId}  { task_id, note }: PK(participation_id, task_id), upsert
 *  findings/{id}                        FindingRow
 *  disputes/{id}                        DisputeRow + study_id (for the study's dispute list)
 *  disputeByParticipation/{pid}         guard: disputes.participation_id UNIQUE → { dispute_id }
 *  ledger/{txId}:{i}                    { id, tx_id, account, amount, kind, study_id, participation_id, created_at, seq }
 *  ledgerRewards/{pid}:{kind}           guard: ledger_one_reward, only kind reward_credit|dispute_credit AND amount > 0
 *  accounts/{account}                   { account, balance, by_kind, seq }: running totals, updated in the
 *                                       posting's transaction; `seq` orders the account's entries (SQLite rowid).
 *                                       The faucet has no totals doc (every top-up would contend on it); its
 *                                       balance is an aggregate over its entries.
 *
 * Invariants and how they hold under concurrency:
 *  - Slots never oversold, budget never over-committed: `consent` reads the study, the study's
 *    participations and the study account, and always writes the study doc (`join_seq`), so two
 *    joins of one study conflict and the loser reruns against the winner's participation.
 *  - One participation per (study, tester), one dispute per participation, one reward per
 *    (participation, kind): guard docs created with `create` in the same transaction.
 *  - The ledger is append-only: entries are only ever created.
 *  - No side effects in callbacks: every id that must be stable is generated before `runTxCtx`.
 *
 * Queries (R7 index coverage). Every query is a single-field equality or `in` filter with no
 * orderBy (ordering is done in code, bounded per study, tester, builder or account), plus
 * equality-only multi-field queries Firestore serves by merging single-field indexes, and
 * aggregates. No composite index is needed:
 *  studies          where builder_id ==
 *  studies          where status in ['published','paused','closed']
 *  studies          where status == 'published', moderation == 'ok'
 *  studies/{sid}/tasks  (whole subcollection)
 *  participations   where study_id ==
 *  participations   where tester_id ==
 *  participations   where status == 'submitted'
 *  participations/{pid}/notes  (whole subcollection)
 *  findings         where participation_id ==
 *  findings         where participation_id in [≤30]
 *  findings         where created_by ==
 *  disputes         where study_id ==
 *  disputes         where opened_by ==
 *  disputes         (whole collection: admin queue)
 *  ledger           where account ==
 *  ledger           where account == FAUCET, sum(amount)
 */

/** Bounded write steps (purge): Firestore commits stay well under its per-transaction limits. */
const MAX_WRITES = 450;

type AccountDoc = { account: Account; balance: number; by_kind: KindSums; seq: number };
type LedgerDoc = LedgerEntry & { tx_id: string; account: Account; seq: number };

const isRewardKind = (k: Kind) => k === 'reward_credit' || k === 'dispute_credit';
const byStringDesc = <T>(key: (r: T) => string | null) => (a: T, b: T) => (key(b) ?? '').localeCompare(key(a) ?? '');
const byStringAsc = <T>(key: (r: T) => string | null) => (a: T, b: T) => (key(a) ?? '').localeCompare(key(b) ?? '');
const rows = <T>(docs: QueryDocumentSnapshot<DocumentData>[]) => docs.map((d) => d.data() as T);
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export function firestoreStudiesRepo(fs: Firestore, hooks: TxHooks = {}): StudiesRepo {
  const studies = fs.collection('studies');
  const participations = fs.collection('participations');
  const findings = fs.collection('findings');
  const disputes = fs.collection('disputes');
  const ledger = fs.collection('ledger');
  const ref = {
    study: (id: string) => studies.doc(id),
    tasks: (sid: string) => studies.doc(sid).collection('tasks'),
    participation: (id: string) => participations.doc(id),
    pair: (sid: string, tid: string) => fs.collection('participationPairs').doc(`${sid}_${tid}`),
    notes: (pid: string) => participations.doc(pid).collection('notes'),
    finding: (id: string) => findings.doc(id),
    dispute: (id: string) => disputes.doc(id),
    disputeGuard: (pid: string) => fs.collection('disputeByParticipation').doc(pid),
    entry: (id: string) => ledger.doc(id),
    reward: (pid: string, kind: Kind) => fs.collection('ledgerRewards').doc(`${pid}:${kind}`),
    account: (a: Account) => fs.collection('accounts').doc(a),
  };
  const tx = <T>(fn: (t: TxCtx) => Promise<T>) => runTxCtx(fs, fn, hooks);

  // ── Reads shared by transactions (t) and plain reads (no t) ───────────────────────────
  const getStudy = async (id: string, t?: TxCtx) => {
    const s = t ? await t.get(ref.study(id)) : await ref.study(id).get();
    return s.exists ? (s.data() as StudyRow) : undefined;
  };
  const getParticipation = async (id: string, t?: TxCtx) => {
    const s = t ? await t.get(ref.participation(id)) : await ref.participation(id).get();
    return s.exists ? (s.data() as ParticipationRow) : undefined;
  };
  const getDispute = async (id: string, t?: TxCtx) => {
    const s = t ? await t.get(ref.dispute(id)) : await ref.dispute(id).get();
    return s.exists ? (s.data() as DisputeRow) : undefined;
  };
  const studyParticipations = async (studyId: string, t?: TxCtx) => {
    const q = participations.where('study_id', '==', studyId);
    return rows<ParticipationRow>((t ? await t.query(q) : await q.get()).docs);
  };
  const statusesOf = (ps: ParticipationRow[]): ParticipationStatus[] =>
    ps.map((r) => ({ id: r.id, status: r.status, decidedAtMs: r.decided_at ? Date.parse(r.decided_at) : null }));
  const filled = (ps: ParticipationRow[]) => ps.filter((p) => p.status !== 'withdrawn').length;
  const accountDoc = async (a: Account, t?: TxCtx): Promise<AccountDoc> => {
    const s = t ? await t.get(ref.account(a)) : await ref.account(a).get();
    return s.exists ? (s.data() as AccountDoc) : { account: a, balance: 0, by_kind: {}, seq: 0 };
  };
  const tasksOf = async (studyId: string, t?: TxCtx): Promise<(Task & { docId: string })[]> => {
    const q = ref.tasks(studyId);
    const docs = (t ? await t.query(q) : await q.get()).docs;
    return docs
      .map((d) => {
        const r = d.data() as { id: string; ord: number; instruction: string; success_criteria: string | null };
        return { docId: d.id, id: r.id, order: r.ord, instruction: r.instruction, ...(r.success_criteria ? { successCriteria: r.success_criteria } : {}) };
      })
      .sort((a, b) => a.order - b.order);
  };
  const openForNewWork = async (s: StudyRow, t?: TxCtx) => {
    if (s.status !== 'published' || s.moderation !== 'ok') return false;
    const b = t ? await userInTx(t, fs, s.builder_id) : ((await fs.collection('users').doc(s.builder_id).get()).data() as UserRow | undefined);
    return b?.status === 'active';
  };

  /** The test-credit budget's `available` (same formula as the study view), inside the transaction. */
  const availableInTx = async (t: TxCtx, s: StudyRow, ps: ParticipationRow[], nowMs: number) => {
    if (s.payment_mode === 'escrow') return 0;
    const by = (await accountDoc(studyAccount(s.id), t)).by_kind;
    const sum = (k: Kind) => by[k] ?? 0;
    return studyBudget({
      reserved: sum('study_reserve'),
      awarded: -(sum('reward_credit') + sum('dispute_credit')),
      released: -sum('study_release'),
      rewardCredits: s.reward_credits,
      committingCount: statusesOf(ps).filter((p) => holdsBudget(p, nowMs)).length,
      closed: s.status === 'closed',
    }).available;
  };
  const holdingCount = (ps: ParticipationRow[], nowMs: number) => statusesOf(ps).filter((p) => holdsBudget(p, nowMs)).length;

  /**
   * Append-only double-entry posting in the caller's transaction: account totals read first, the
   * reward guard claimed (partial: reward kinds with amount > 0 only), then entries created and
   * totals written. `txId` comes from outside the callback, so a rerun writes the same ids.
   */
  const postInTx = async (t: TxCtx, postings: Posting[], nowMs: number, txId: string) => {
    if (postings.length === 0) return;
    if (postings.reduce((s, p) => s + p.amount, 0) !== 0) throw new Error('unbalanced ledger transaction');
    const accounts = [...new Set(postings.map((p) => p.account))].filter((a) => a !== FAUCET);
    const state = new Map<Account, AccountDoc>();
    for (const a of accounts) state.set(a, await accountDoc(a, t));
    for (const p of postings) {
      if (isRewardKind(p.kind) && p.amount > 0) {
        const g = await t.claimGuard(ref.reward(p.participationId!, p.kind), { participation_id: p.participationId, kind: p.kind, tx_id: txId });
        if (!g.created) throw fail('CONFLICT_STATE', 'This participation was already credited.');
      }
    }
    postings.forEach((p, i) => {
      const a = state.get(p.account);
      if (a) {
        a.balance += p.amount;
        a.by_kind = { ...a.by_kind, [p.kind]: (a.by_kind[p.kind] ?? 0) + p.amount };
        a.seq += 1;
      }
      const id = `${txId}:${i}`;
      const entry: LedgerDoc = { id, tx_id: txId, account: p.account, amount: p.amount, kind: p.kind, study_id: p.studyId, participation_id: p.participationId, created_at: iso(nowMs), seq: a?.seq ?? 0 };
      t.create(ref.entry(id), entry);
    });
    for (const a of state.values()) t.set(ref.account(a.account), a);
  };

  const writeTasksInTx = async (t: TxCtx, studyId: string, tasks: TaskInput[], ids: string[], replace: boolean) => {
    if (replace) for (const old of await tasksOf(studyId, t)) t.delete(ref.tasks(studyId).doc(old.docId));
    tasks.forEach((x, i) => t.create(ref.tasks(studyId).doc(ids[i]!), { id: ids[i]!, study_id: studyId, ord: i, instruction: x.instruction, success_criteria: x.successCriteria ?? null }));
  };

  const audit = (t: TxCtx, row: Omit<AuditRow, 'created_at'> & { nowMs: number }) => {
    const { nowMs, ...rest } = row;
    auditInTx(t, fs, { ...rest, created_at: iso(nowMs) } as AuditRow);
  };

  /** Tester's own participation, else 404 (access.ts rule, inside the transaction). */
  const testerOwned = async (t: TxCtx, id: string, tester: UserRow) => {
    const p = await getParticipation(id, t);
    if (!p || p.tester_id !== tester.id) throw notFound('Participation');
    return { p, s: (await getStudy(p.study_id, t))! };
  };

  /** A reward credit (test credits) or payout authorisation (escrow) for an approval, plus its reads. */
  const payForApprovalInTx = async (
    t: TxCtx,
    s: StudyRow,
    p: ParticipationRow,
    kind: 'reward_credit' | 'dispute_credit',
    nowMs: number,
    actorId: string,
    escrow: { why: string; cosigner: 'builder' | 'arbiter' },
    txId: string,
  ) => {
    const ps = await studyParticipations(s.id, t);
    if (s.payment_mode === 'escrow') {
      await authorizePayoutInTx(t, fs, s, p, holdingCount(ps, nowMs) - 1, nowMs, actorId, escrow.why, escrow.cosigner);
      return;
    }
    // This participation is still counted as committed, so add its own hold back.
    const avail = (await availableInTx(t, s, ps, nowMs)) + p.reward_credits;
    await postInTx(t, planReward({ studyId: s.id, testerId: p.tester_id, participationId: p.id, amount: p.reward_credits, studyAvailableIncludingThis: avail, kind }), nowMs, txId);
  };

  return {
    // ── Studies and tasks ────────────────────────────────────────────────────────────────
    getStudy: (id) => getStudy(id),
    async listStudiesByBuilder(builderId) {
      return rows<StudyRow>((await studies.where('builder_id', '==', builderId).get()).docs).sort(byStringDesc((s) => s.created_at));
    },
    async listNonDraftStudies() {
      return rows<StudyRow>((await studies.where('status', 'in', ['published', 'paused', 'closed']).get()).docs).sort(byStringDesc((s) => s.created_at));
    },
    async listOpenStudiesFor(testerId) {
      const [open, mine] = await Promise.all([
        studies.where('status', '==', 'published').where('moderation', '==', 'ok').get(),
        participations.where('tester_id', '==', testerId).get(),
      ]);
      const joined = new Set(rows<ParticipationRow>(mine.docs).map((p) => p.study_id));
      const candidates = rows<StudyRow>(open.docs).filter((s) => !joined.has(s.id));
      const builderIds = [...new Set(candidates.map((s) => s.builder_id))];
      const builders = builderIds.length ? await fs.getAll(...builderIds.map((id) => fs.collection('users').doc(id))) : [];
      const active = new Set(builders.filter((b) => b.exists && (b.data() as UserRow).status === 'active').map((b) => b.id));
      return candidates.filter((s) => active.has(s.builder_id)).sort(byStringDesc((s) => s.published_at));
    },
    openForNewWork: (s) => openForNewWork(s),
    async tasksOf(studyId) {
      return (await tasksOf(studyId)).map(({ docId: _d, ...task }) => task);
    },
    async taskInStudy(taskId, studyId) {
      return (await tasksOf(studyId)).some((x) => x.id === taskId);
    },
    async slotsFilled(studyId) {
      return filled(await studyParticipations(studyId));
    },
    async participationStatuses(studyId) {
      return statusesOf(await studyParticipations(studyId));
    },

    async createStudy(n) {
      const taskIds = n.tasks.map((_, i) => n.taskIds[i] ?? newId());
      await tx(async (t) => {
        // Rule D (plan R12): a retry of a committed create (same id) writes nothing.
        if ((await t.get(ref.study(n.id))).exists) return;
        const row: StudyRow & { join_seq: number } = {
          id: n.id,
          builder_id: n.builderId,
          title: n.title,
          objective: n.objective,
          build_under_test: n.buildUnderTest,
          device_criteria_json: n.deviceCriteriaJson,
          reward_credits: n.rewardCredits,
          payment_mode: n.escrow ? 'escrow' : 'test_credits',
          slots: n.slots,
          consent_text: n.consentText,
          consent_version: 1,
          status: 'draft',
          moderation: 'ok',
          created_at: n.createdAt,
          published_at: null,
          closed_at: null,
          join_seq: 0,
        };
        if (n.escrow) {
          await createEscrowInTx(t, fs, {
            study_id: n.id,
            settlement: n.escrow.settlement as EscrowRow['settlement'],
            network: n.escrow.network,
            mint: n.escrow.mint,
            vault: n.escrow.vault,
            fee_bps: n.escrow.feeBps,
            created_at: n.createdAt,
            builder_id: n.builderId,
          });
        }
        t.create(ref.study(n.id), row);
        await writeTasksInTx(t, n.id, n.tasks, taskIds, false);
      });
    },

    async updateDraftStudy(studyId, builder, b) {
      const taskIds = b.tasks?.map(() => newId()) ?? [];
      await tx(async (t) => {
        const s = await getStudy(studyId, t);
        if (!s || s.builder_id !== builder.id) throw notFound('Study');
        if (s.status !== 'draft') throw fail('CONFLICT_STATE', 'Only draft studies can be edited.');
        const escrow = s.payment_mode === 'escrow';
        if (escrow && b.rewardCredits !== undefined) throw fail('VALIDATION', 'Escrow studies pay in tokens: change rewardUnits, not rewardCredits.');
        if (!escrow && b.rewardUnits !== undefined) throw fail('VALIDATION', 'Test-credit studies use rewardCredits.');
        if (escrow && (b.rewardUnits !== undefined || b.slots !== undefined)) {
          // The funded amount was fixed by the quote: the terms lock once funding has started.
          if (await fundingStartedInTx(t, fs, s.id)) throw fail('CONFLICT_STATE', 'The reward and slots are locked once funding has started.');
          quoteEscrow({ rewardUnits: b.rewardUnits ?? s.reward_credits, slots: b.slots ?? s.slots, feeBps: (await escrowOfInTx(t, fs, s.id))!.fee_bps });
        }
        const consentChanged = b.consentText !== undefined && b.consentText !== s.consent_text;
        if (b.tasks) await writeTasksInTx(t, s.id, b.tasks, taskIds, true);
        t.update(ref.study(s.id), {
          title: b.title ?? s.title,
          objective: b.objective ?? s.objective,
          build_under_test: b.buildUnderTest !== undefined ? b.buildUnderTest : s.build_under_test,
          device_criteria_json: b.deviceCriteria !== undefined ? JSON.stringify(b.deviceCriteria) : s.device_criteria_json,
          reward_credits: (escrow ? b.rewardUnits : b.rewardCredits) ?? s.reward_credits,
          slots: b.slots ?? s.slots,
          consent_text: b.consentText ?? s.consent_text,
          consent_version: consentChanged ? s.consent_version + 1 : s.consent_version,
        });
      });
    },

    async studyTransition(studyId, user, action, settlementEnabled, now) {
      const txId = newId();
      await tx(async (t) => {
        const s = await getStudy(studyId, t);
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
          const funded = await isFundedInTx(t, fs, s.id);
          const esc = (await escrowOfInTx(t, fs, s.id))!;
          if (!funded || (await vaultBalanceInTx(t, fs, s.id)) < quoteEscrow({ rewardUnits: s.reward_credits, slots: s.slots, feeBps: esc.fee_bps }).totalUnits) {
            throw fail('BUDGET_INSUFFICIENT', 'Fund this study from your wallet, and wait for the funding to be confirmed, before publishing.');
          }
          t.update(ref.study(s.id), { status: next, published_at: iso(now) });
        } else if (action === 'publish') {
          const amount = requiredReserve({ rewardCredits: s.reward_credits, slots: s.slots });
          const builderBalance = (await accountDoc(userAccount(user.id), t)).balance;
          await postInTx(t, planReserve({ builderId: user.id, studyId: s.id, amount, builderBalance }), now, txId);
          t.update(ref.study(s.id), { status: next, published_at: iso(now) });
        } else if (action === 'close') {
          const ps = await studyParticipations(s.id, t);
          const balance = escrow ? await vaultBalanceInTx(t, fs, s.id) : (await accountDoc(studyAccount(s.id), t)).balance;
          const plan = closeStudyPlan({ studyBalance: balance, nowMs: now, participations: statusesOf(ps) });
          if (plan.withdraw.length > MAX_WRITES) throw fail('CONFLICT_STATE', 'Too many testers are still in progress to close this study at once.');
          // Escrow: unused funds go back to the funding wallet once the refund settles. (Before the
          // withdrawals below: helpers may read participations, and a written doc can't be re-read.)
          if (escrow) await authorizeRefundInTx(t, fs, { ...s, status: 'closed' }, now, user.id, 'builder');
          else await postInTx(t, planRelease({ studyId: s.id, builderId: user.id, studyBalance: plan.release }), now, txId);
          for (const id of plan.withdraw) t.update(ref.participation(id), { status: 'withdrawn', decision_reason: 'Study closed by the builder.' });
          t.update(ref.study(s.id), { status: next, closed_at: iso(now) });
        } else {
          t.update(ref.study(s.id), { status: next });
        }
      });
    },

    async moderateStudy(studyId, state, a) {
      const auditId = a.id ?? newId();
      return tx(async (t) => {
        const s = await getStudy(studyId, t);
        if (!s) throw notFound('Study');
        // Rule D (plan R12): this audit row exists, so the moderation was already applied. (The
        // audit doc path is core's documented audit/{id}; read only, never written here.)
        if ((await t.get(fs.collection('audit').doc(auditId))).exists) return s;
        t.update(ref.study(s.id), { moderation: state });
        audit(t, { id: auditId, actor_id: a.actorId, action: a.action, target_type: 'study', target_id: s.id, reason: a.reason, nowMs: a.nowMs });
        return { ...s, moderation: state };
      });
    },

    // ── Participations ───────────────────────────────────────────────────────────────────
    getParticipation: (id) => getParticipation(id),
    async findParticipation(studyId, testerId) {
      const g = await ref.pair(studyId, testerId).get();
      return g.exists ? getParticipation((g.data() as { participation_id: string }).participation_id) : undefined;
    },
    async listParticipationsByTester(testerId) {
      return rows<ParticipationRow>((await participations.where('tester_id', '==', testerId).get()).docs).sort(byStringDesc((p) => p.consented_at));
    },
    async listParticipationsByStudy(studyId) {
      return (await studyParticipations(studyId)).sort(byStringAsc((p) => p.consented_at));
    },
    async listSubmittedWithStudy() {
      const ps = rows<ParticipationRow>((await participations.where('status', '==', 'submitted').get()).docs).sort(byStringAsc((p) => p.submitted_at));
      const studyIds = [...new Set(ps.map((p) => p.study_id))];
      const ss = new Map(
        (studyIds.length ? await fs.getAll(...studyIds.map((id) => ref.study(id))) : []).filter((d) => d.exists).map((d) => [d.id, d.data() as StudyRow]),
      );
      const builderIds = [...new Set([...ss.values()].map((s) => s.builder_id))];
      const bs = new Map(
        (builderIds.length ? await fs.getAll(...builderIds.map((id) => fs.collection('users').doc(id))) : []).filter((d) => d.exists).map((d) => [d.id, d.data() as UserRow]),
      );
      return ps.flatMap((p): StuckCandidate[] => {
        const s = ss.get(p.study_id);
        const b = s ? bs.get(s.builder_id) : undefined;
        return s && b ? [{ ...p, study_title: s.title, builder_status: b.status }] : [];
      });
    },
    async taskNotes(participationId) {
      return rows<{ task_id: string; note: string }>((await ref.notes(participationId).get()).docs).map((n) => ({ task_id: n.task_id, note: n.note }));
    },

    async consent({ studyId, tester: user, consentVersion, payoutAddress: confirmed, settlementEnabled, id, nowMs: now }) {
      return tx(async (t) => {
        const s = await getStudy(studyId, t);
        if (!s || !(await openForNewWork(s, t))) throw notFound('Study');
        // UNIQUE(study_id, tester_id): the guard is created only if this transaction commits.
        const pair = await t.claimGuard(ref.pair(s.id, user.id), { participation_id: id });
        if (!pair.created) throw fail('CONFLICT_STATE', 'You already joined this study.');
        if (consentVersion !== s.consent_version) {
          throw fail('CONFLICT_STATE', 'The consent text changed. Read the latest version and consent again.');
        }
        const device = user.device_json ? (JSON.parse(user.device_json) as DeviceProfile) : null;
        const elig = checkEligibility(JSON.parse(s.device_criteria_json), device);
        if (!elig.eligible) throw fail('CONFLICT_STATE', `Not eligible: ${elig.reasons.join(' ')}`);
        const ps = await studyParticipations(s.id, t);
        let payoutAddress: string | null = null;
        if (s.payment_mode === 'escrow') {
          if (!settlementEnabled) throw fail('FEATURE_UNAVAILABLE', 'Wallet-funded studies aren’t available on this deployment.');
          // The payout wallet is frozen here, with the tester's explicit confirmation of it.
          const linked = await walletAddressOfInTx(t, fs, user.id);
          if (!linked) throw fail('CONFLICT_STATE', 'Link the wallet you want rewards sent to before joining a wallet-funded study.');
          if (confirmed !== linked) throw fail('VALIDATION', 'Confirm your linked wallet as the payout wallet for this study.');
          // Self-dealing: a wallet that funded any of this builder's studies can't be paid by them.
          if (await walletFundedBuilderInTx(t, fs, s.builder_id, linked)) {
            throw fail('CONFLICT_STATE', 'This wallet funded a study by the same builder, so it can’t receive this study’s rewards.');
          }
          payoutAddress = linked;
          if (filled(ps) >= s.slots || !(await canReserveInTx(t, fs, s, holdingCount(ps, now), now))) throw fail('CONFLICT_STATE', 'This study is full.');
        } else if (filled(ps) >= s.slots || (await availableInTx(t, s, ps, now)) < s.reward_credits) {
          throw fail('CONFLICT_STATE', 'This study is full.');
        }
        const row: ParticipationRow = {
          id,
          study_id: s.id,
          tester_id: user.id,
          status: 'consented',
          consent_version: s.consent_version,
          consented_at: iso(now),
          started_at: null,
          submitted_at: null,
          decided_at: null,
          decided_by: null,
          decision_reason: null,
          reward_credits: s.reward_credits,
          payout_address: payoutAddress,
        };
        t.create(ref.participation(id), row);
        // Every join writes the study, so concurrent joins of one study conflict (slots, budget).
        t.update(ref.study(s.id), { join_seq: ((s as StudyRow & { join_seq?: number }).join_seq ?? 0) + 1 });
        if (payoutAddress) {
          audit(t, { id: `${id}:payout_wallet`, actor_id: user.id, action: 'escrow.payout_wallet_frozen', target_type: 'participation', target_id: id, reason: `Payout wallet ${payoutAddress} confirmed at consent`, nowMs: now });
        }
        return row;
      });
    },

    async testerTransition(participationId, user, action, reason, now) {
      return tx(async (t) => {
        const { p, s } = await testerOwned(t, participationId, user);
        if (action === 'start' && (s.status !== 'published' || s.moderation !== 'ok')) {
          throw fail('CONFLICT_STATE', 'This study is not accepting work right now.');
        }
        // Direct uploads still in flight would be silently dropped by submission (ADR 0005 §3).
        if (action === 'submit' && (await openIntentCountInTx(t, fs, p.id, now)) > 0) {
          throw fail('CONFLICT_STATE', 'Finish or cancel your evidence uploads before submitting.');
        }
        const next = transitionParticipation(p.status, action);
        const patch: Partial<ParticipationRow> =
          action === 'start' ? { status: next, started_at: iso(now) } : action === 'submit' ? { status: next, submitted_at: iso(now) } : { status: next, decision_reason: reason };
        t.update(ref.participation(p.id), patch);
        return { ...p, ...patch };
      });
    },

    async putTaskNote(participationId, user, taskId, note) {
      return tx(async (t) => {
        const { p, s } = await testerOwned(t, participationId, user);
        if (!canEditTaskNotes(p.status)) throw fail('CONFLICT_STATE', 'Notes can only change while the participation is in progress.');
        if (!(await tasksOf(s.id, t)).some((x) => x.id === taskId)) throw fail('VALIDATION', 'Unknown task for this study.');
        // PK(participation_id, task_id) upsert: last write wins, as in SQLite.
        t.set(ref.notes(p.id).doc(taskId), { task_id: taskId, note });
        return p;
      });
    },

    async decideParticipation(participationId, input, now) {
      const user = input.actor;
      const txId = newId();
      const auditId = newId();
      // An admin's reason is checked before anything is read (today's order).
      if (input.by === 'admin_stuck') assertCleanCopy({ reason: input.reason });
      return tx(async (t) => {
        if (input.by === 'builder') {
          const p = await getParticipation(participationId, t);
          const s = p ? await getStudy(p.study_id, t) : undefined;
          if (!p || !s || s.builder_id !== user.id) throw notFound('Participation');
          const d = validateDecision({ decision: input.decision, reviewerId: user.id, reason: input.reason });
          assertCleanCopy({ reason: d.reason ?? undefined, note: input.note });
          const next = transitionParticipation(p.status, input.decision);
          if (input.decision === 'approve') await payForApprovalInTx(t, s, p, 'reward_credit', now, user.id, { why: 'approved by the builder', cosigner: 'builder' }, txId);
          const patch = { status: next, decided_at: iso(now), decided_by: user.id, decision_reason: d.reason ?? input.note ?? null };
          if (input.decision === 'approve') await awardApprovalInTx(t, fs, s, p, input.helpful, now);
          t.update(ref.participation(p.id), patch);
          return { ...p, ...patch };
        }
        // Admin decision on a stuck submission only (builder inactive, or overdue): same rules
        // as a builder decision (one credit at most, budget never negative), reason audited.
        const { decision, reason } = input;
        const p = await getParticipation(participationId, t);
        if (!p) throw notFound('Participation');
        const s = (await getStudy(p.study_id, t))!;
        const builder = (await userInTx(t, fs, s.builder_id))!;
        const why = stuckReason({ status: p.status, submittedAtMs: p.submitted_at ? Date.parse(p.submitted_at) : null, builderStatus: builder.status }, now);
        if (!why) throw fail('CONFLICT_STATE', 'Only stuck submissions can be decided by an admin; the study owner reviews the rest.');
        const next = transitionParticipation(p.status, decision);
        if (decision === 'approve') await payForApprovalInTx(t, s, p, 'reward_credit', now, user.id, { why: `admin decision on stuck work (${why})`, cosigner: 'arbiter' }, txId);
        const patch = { status: next, decided_at: iso(now), decided_by: user.id, decision_reason: reason };
        if (decision === 'approve') await awardApprovalInTx(t, fs, s, p, false, now);
        t.update(ref.participation(p.id), patch);
        audit(t, { id: auditId, actor_id: user.id, action: `participation.${decision}`, target_type: 'participation', target_id: p.id, reason: `${reason} [stuck: ${why}]`, nowMs: now });
        return { ...p, ...patch };
      });
    },

    // ── Findings and disputes ────────────────────────────────────────────────────────────
    async listFindings(participationId) {
      return rows<FindingRow>((await findings.where('participation_id', '==', participationId).get()).docs).sort(byStringAsc((f) => f.created_at));
    },

    async createFinding(participationId, user, b, id, nowMs) {
      return tx(async (t) => {
        // Rule D (plan R12): a retry of a committed create (same id) returns that finding.
        const existing = await t.get(ref.finding(id));
        if (existing.exists) return existing.data() as FindingRow;
        const p = await getParticipation(participationId, t);
        const s = p ? await getStudy(p.study_id, t) : undefined;
        if (!p || !s || s.builder_id !== user.id) throw notFound('Participation');
        if (p.status === 'consented' || p.status === 'in_progress' || p.status === 'withdrawn') {
          throw fail('CONFLICT_STATE', 'Findings can be added once the tester has submitted.');
        }
        assertCleanCopy({ title: b.title, description: b.description });
        if (b.evidenceId && !(await evidenceInParticipationInTx(t, fs, b.evidenceId, p.id))) {
          throw fail('VALIDATION', 'evidenceId does not belong to this participation.');
        }
        const row: FindingRow = {
          id,
          participation_id: p.id,
          title: b.title,
          severity: b.severity,
          description: b.description,
          evidence_id: b.evidenceId ?? null,
          timestamp_ms: b.timestampMs ?? null,
          created_by: user.id,
          created_at: iso(nowMs),
        };
        t.create(ref.finding(id), row);
        return row;
      });
    },

    getDispute: (id) => getDispute(id),
    async listDisputesByStudy(studyId) {
      return rows<DisputeRow>((await disputes.where('study_id', '==', studyId).get()).docs).sort(byStringDesc((d) => d.created_at));
    },
    async listDisputesByOpener(userId) {
      return rows<DisputeRow>((await disputes.where('opened_by', '==', userId).get()).docs).sort(byStringDesc((d) => d.created_at));
    },
    async listAllDisputes() {
      return rows<DisputeRow>((await disputes.get()).docs).sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open') || b.created_at.localeCompare(a.created_at));
    },

    async openDispute(participationId, user, reason, id, now) {
      return tx(async (t) => {
        const { p } = await testerOwned(t, participationId, user);
        const next = transitionParticipation(p.status, 'dispute');
        if (!canOpenDispute({ status: p.status, decidedAtMs: p.decided_at ? Date.parse(p.decided_at) : null }, now)) {
          throw fail('CONFLICT_STATE', 'The 7-day dispute window for this decision has ended.');
        }
        // disputes.participation_id UNIQUE.
        const g = await t.claimGuard(ref.disputeGuard(p.id), { dispute_id: id });
        if (!g.created) throw fail('CONFLICT_STATE', 'This decision is already disputed.');
        const row: DisputeRow & { study_id: string } = {
          id,
          participation_id: p.id,
          study_id: p.study_id,
          opened_by: user.id,
          reason,
          status: 'open',
          outcome: null,
          resolution_note: null,
          resolved_by: null,
          created_at: iso(now),
          resolved_at: null,
        };
        t.update(ref.participation(p.id), { status: next });
        t.create(ref.dispute(id), row);
        return row;
      });
    },

    async resolveDispute(disputeId, admin, outcome, note, now) {
      assertCleanCopy({ note });
      const txId = newId();
      const auditId = newId();
      return tx(async (t) => {
        const d = await getDispute(disputeId, t);
        if (!d) throw notFound('Dispute');
        if (d.status !== 'open') throw fail('CONFLICT_STATE', 'This dispute is already resolved.');
        const p = (await getParticipation(d.participation_id, t))!;
        const s = (await getStudy(p.study_id, t))!;
        const next = transitionParticipation(p.status, 'resolve');
        // An overturn pays what was fixed earlier (amount, wallet); the admin decides the outcome only.
        if (outcome === 'overturned') await payForApprovalInTx(t, s, p, 'dispute_credit', now, admin.id, { why: `dispute ${d.id} overturned`, cosigner: 'arbiter' }, txId);
        if (outcome === 'overturned') await awardApprovalInTx(t, fs, s, p, false, now);
        t.update(ref.participation(p.id), { status: next });
        const patch = { status: 'resolved' as const, outcome, resolution_note: note, resolved_by: admin.id, resolved_at: iso(now) };
        t.update(ref.dispute(d.id), patch);
        audit(t, { id: auditId, actor_id: admin.id, action: `dispute.${outcome}`, target_type: 'dispute', target_id: d.id, reason: note, nowMs: now });
        return { ...d, ...patch };
      });
    },

    // ── Test-credit ledger ───────────────────────────────────────────────────────────────
    async accountBalance(account) {
      if (account === FAUCET) {
        const agg = await ledger.where('account', '==', FAUCET).aggregate({ s: AggregateField.sum('amount') }).get();
        return agg.data().s ?? 0;
      }
      return (await accountDoc(account)).balance;
    },
    async ledgerEntries(account) {
      return rows<LedgerDoc>((await ledger.where('account', '==', account).get()).docs)
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.seq - a.seq)
        .map((e) => ({ id: e.id, kind: e.kind, amount: e.amount, study_id: e.study_id, participation_id: e.participation_id, created_at: e.created_at }));
    },
    async studyKindSums(studyId) {
      return (await accountDoc(studyAccount(studyId))).by_kind;
    },
    async topUp(userId, amount, nowMs, txId = newId()) {
      const postings = planTopUp(userId, amount);
      await tx(async (t) => {
        // Rule D (plan R12): this ledger transaction was already posted.
        if ((await t.get(ref.entry(`${txId}:0`))).exists) return;
        await postInTx(t, postings, nowMs, txId);
      });
    },

    // ── Account export and deletion ──────────────────────────────────────────────────────
    async liveStudiesOf(userId) {
      return rows<StudyRow>((await studies.where('builder_id', '==', userId).get()).docs).filter((s) => s.status === 'published' || s.status === 'paused').length;
    },
    async openParticipationsOf(userId) {
      return rows<ParticipationRow>((await participations.where('tester_id', '==', userId).get()).docs).filter((p) => p.status === 'submitted' || p.status === 'disputed').length;
    },
    async exportUser(userId) {
      const [ss, ps, authored, ds] = await Promise.all([
        studies.where('builder_id', '==', userId).get(),
        participations.where('tester_id', '==', userId).get(),
        findings.where('created_by', '==', userId).get(),
        disputes.where('opened_by', '==', userId).get(),
      ]);
      const parts = rows<ParticipationRow>(ps.docs);
      const byId = new Map(rows<FindingRow>(authored.docs).map((f) => [f.id, f]));
      for (const ids of chunks(parts.map((p) => p.id), 30)) {
        for (const f of rows<FindingRow>((await findings.where('participation_id', 'in', ids).get()).docs)) byId.set(f.id, f);
      }
      return {
        studies: rows<StudyRow>(ss.docs),
        participations: parts,
        findings: [...byId.values()],
        disputes: rows<DisputeRow>(ds.docs).map(({ study_id: _s, ...d }: DisputeRow & { study_id?: string }) => d),
      };
    },

    /**
     * Each step re-reads its state and writes at most MAX_WRITES documents per transaction, looping
     * until nothing is left, so a rerun after a partial failure finishes the job (idempotent).
     */
    async purgeUser(userId, nowMs) {
      const builtStudies = rows<StudyRow>((await studies.where('builder_id', '==', userId).get()).docs);
      const testerParts = rows<ParticipationRow>((await participations.where('tester_id', '==', userId).get()).docs);
      const builtParts = (await Promise.all(builtStudies.map((s) => studyParticipations(s.id)))).flat();

      // 1. Findings lose links to evidence the user recorded or that sits in their studies. A
      //    finding's evidence always belongs to the finding's own participation (createFinding),
      //    so these are the linked findings on those participations.
      const pids = [...new Set([...testerParts, ...builtParts].map((p) => p.id))];
      for (const ids of chunks(pids, 30)) {
        const linked = (await findings.where('participation_id', 'in', ids).get()).docs.filter((d) => (d.data() as FindingRow).evidence_id !== null);
        for (const part of chunks(linked, MAX_WRITES)) {
          const b = fs.batch();
          for (const d of part) b.update(d.ref, { evidence_id: null });
          await b.commit();
        }
      }
      // 2. Task notes of the user's participations.
      for (const p of testerParts) {
        for (;;) {
          const notes = await ref.notes(p.id).limit(MAX_WRITES).get();
          if (notes.empty) break;
          const b = fs.batch();
          for (const d of notes.docs) b.delete(d.ref);
          await b.commit();
        }
      }
      // 3. In-flight participations are withdrawn and every decision reason cleared. Each one is
      //    re-read in its transaction, so a concurrent status change is never overwritten.
      for (const part of chunks(testerParts.map((p) => p.id), MAX_WRITES)) {
        await tx(async (t) => {
          const cur = (await t.getAll(...part.map((id) => ref.participation(id)))).filter((d) => d.exists).map((d) => d.data() as ParticipationRow);
          for (const p of cur) {
            const status = p.status === 'consented' || p.status === 'in_progress' ? 'withdrawn' : p.status;
            if (status !== p.status || p.decision_reason !== null) t.update(ref.participation(p.id), { status, decision_reason: null });
          }
        });
      }
      // 4. Disputes the user opened keep their shape; the reason goes.
      const opened = (await disputes.where('opened_by', '==', userId).get()).docs.filter((d) => (d.data() as DisputeRow).reason !== '[deleted]');
      for (const part of chunks(opened, MAX_WRITES)) {
        const b = fs.batch();
        for (const d of part) b.update(d.ref, { reason: '[deleted]' });
        await b.commit();
      }
      // 5. Escrow (ADR 0007): the builder's wallet-funded drafts close, refund authorised to the
      //    funding wallet; one study per transaction (each re-checked as a draft).
      for (const s0 of builtStudies.filter((s) => s.payment_mode === 'escrow' && s.status === 'draft')) {
        await tx(async (t) => {
          const s = await getStudy(s0.id, t);
          if (!s || s.status !== 'draft') return;
          await authorizeRefundInTx(t, fs, { ...s, status: 'closed' }, nowMs, userId, 'arbiter');
          t.update(ref.study(s.id), { status: 'closed', closed_at: iso(nowMs) });
        });
      }
      return { mediaKeys: [] };
    },
  };
}
