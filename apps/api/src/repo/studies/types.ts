import type { Participation } from '@pocket-qa/contracts';
import type { Account, Kind, StudyAction } from '@pocket-qa/domain';
import type { DisputeRow, FindingRow, ParticipationRow, StudyRow } from '../../views/studies';
import type { UserRow } from '../../views/core';

/**
 * Studies repository (owner: pqa-be1, see ../index.ts): studies, tasks, participations, task
 * notes, the test-credit ledger, findings and disputes. Intent-level async operations only; rows
 * keep today's SQLite shapes so views and contracts don't change.
 *
 * Every write that SQLite does in one `db.transaction` is ONE operation here, including the parts
 * that touch other domains' tables in that same transaction (escrow holds and payouts, reputation
 * points, audit), because those invariants (one reward per participation, budgets never
 * negative, slots never oversold) only hold if it all commits together. Domain rule failures
 * throw the same `fail(...)` / `notFound(...)` errors the handlers threw before.
 */

export type Task = { id: string; order: number; instruction: string; successCriteria?: string };
export type TaskInput = { instruction: string; successCriteria?: string };

/** `participationStatuses`: what budgets, holds and closing look at. */
export type ParticipationStatus = { id: string; status: Participation['status']; decidedAtMs: number | null };

/** Sum of the study account's postings per ledger kind (signed, as stored). */
export type KindSums = Partial<Record<Kind, number>>;

export type LedgerEntry = {
  id: string;
  kind: Kind;
  amount: number;
  study_id: string | null;
  participation_id: string | null;
  created_at: string;
};

export type NewStudy = {
  id: string;
  builderId: string;
  title: string;
  objective: string;
  buildUnderTest: string | null;
  deviceCriteriaJson: string;
  /** Test credits, or token base units for an escrow study. */
  rewardCredits: number;
  slots: number;
  consentText: string;
  tasks: TaskInput[];
  /** One id per task, from the caller (deterministic under an Idempotency-Key, plan R12). */
  taskIds: string[];
  createdAt: string;
  /** Wallet-funded study: its escrow row is created in the same transaction. */
  escrow: { settlement: string; network: string; mint: string; vault: string; feeBps: number } | null;
};

export type StudyPatch = {
  title?: string;
  objective?: string;
  buildUnderTest?: string;
  deviceCriteria?: unknown;
  rewardCredits?: number;
  rewardUnits?: number;
  slots?: number;
  consentText?: string;
  tasks?: TaskInput[];
};

export type ConsentInput = {
  studyId: string;
  tester: UserRow;
  consentVersion: number;
  payoutAddress?: string;
  /** Wallet-funded studies need a settlement provider on this deployment. */
  settlementEnabled: boolean;
  id: string;
  nowMs: number;
};

/** Who decides a submission, and on what grounds (all paths share the one-reward rules). */
export type DecisionInput =
  | { by: 'builder'; actor: UserRow; decision: 'approve' | 'reject'; reason?: string; note?: string; helpful: boolean }
  | { by: 'admin_stuck'; actor: UserRow; decision: 'approve' | 'reject'; reason: string };

export type FindingInput = {
  title: string;
  severity: FindingRow['severity'];
  description: string;
  evidenceId?: string;
  timestampMs?: number;
};

/** A submitted participation with what the stuck-work queue shows about its study. */
export type StuckCandidate = ParticipationRow & { study_title: string; builder_status: UserRow['status'] };

/** The user's own rows in this domain, exactly as the account export reads them today. */
export type StudiesExport = {
  /** Studies the user built. */
  studies: StudyRow[];
  /** The user's participations as a tester. */
  participations: ParticipationRow[];
  /** Findings the user authored (builder) or that concern their own participations (tester). */
  findings: FindingRow[];
  /** Disputes the user opened. */
  disputes: DisputeRow[];
};

export interface StudiesRepo {
  // ── Studies and tasks ──────────────────────────────────────────────────────────────────
  getStudy(id: string): Promise<StudyRow | undefined>;
  /** The builder's studies, newest first. */
  listStudiesByBuilder(builderId: string): Promise<StudyRow[]>;
  /** Every non-draft study, newest first (admin moderation). */
  listNonDraftStudies(): Promise<StudyRow[]>;
  /**
   * Studies a tester could join: published, not moderated, builder active, not already joined,
   * newest published first. Device eligibility and free slots are filtered by the caller.
   */
  listOpenStudiesFor(testerId: string): Promise<StudyRow[]>;
  /** Published, not moderated, and its builder's account is active. */
  openForNewWork(s: StudyRow): Promise<boolean>;
  tasksOf(studyId: string): Promise<Task[]>;
  taskInStudy(taskId: string, studyId: string): Promise<boolean>;
  /** Participations that are not withdrawn. */
  slotsFilled(studyId: string): Promise<number>;
  participationStatuses(studyId: string): Promise<ParticipationStatus[]>;

  /** Rule D (plan R12): if a study with this id already exists, nothing is written. */
  createStudy(input: NewStudy): Promise<void>;
  /**
   * A draft's edit, re-checked atomically: own draft, test-credit vs token terms, terms locked
   * once escrow funding started, quote validity; consent version +1 if the text changed.
   */
  updateDraftStudy(studyId: string, builder: UserRow, patch: StudyPatch): Promise<void>;
  /**
   * publish / pause / resume / close, with the reserve (test credits) or confirmed funding
   * (escrow) on publish, and on close the withdrawal of in-flight testers plus the release
   * (test credits) or refund authorisation (escrow).
   */
  studyTransition(studyId: string, builder: UserRow, action: StudyAction, settlementEnabled: boolean, nowMs: number): Promise<void>;
  /**
   * Admin moderation of a study, audited in the same transaction (audit row `audit.id`). Returns
   * the updated row. Rule D (plan R12): if that audit row already exists, nothing is written.
   * Callers pass `ctx.idemId('audit')`; without an id it is a fresh one (no retry protection).
   */
  moderateStudy(studyId: string, state: StudyRow['moderation'], audit: { id?: string; actorId: string; action: string; reason: string; nowMs: number }): Promise<StudyRow>;

  // ── Participations ─────────────────────────────────────────────────────────────────────
  getParticipation(id: string): Promise<ParticipationRow | undefined>;
  findParticipation(studyId: string, testerId: string): Promise<ParticipationRow | undefined>;
  /** By tester, newest consent first. */
  listParticipationsByTester(testerId: string): Promise<ParticipationRow[]>;
  /** By study, in consent order. */
  listParticipationsByStudy(studyId: string): Promise<ParticipationRow[]>;
  /** Submitted participations (oldest submission first) with their study title and builder status. */
  listSubmittedWithStudy(): Promise<StuckCandidate[]>;
  taskNotes(participationId: string): Promise<{ task_id: string; note: string }[]>;

  /**
   * Joining: open for new work, not joined yet, current consent version, device eligible, a free
   * slot and budget (test credits) or a reservable vault (escrow, with the payout wallet frozen
   * and self-dealing refused). Returns the new participation.
   */
  consent(input: ConsentInput): Promise<ParticipationRow>;
  /** The tester's start / submit / withdraw; submit refuses while direct uploads are open. */
  testerTransition(participationId: string, tester: UserRow, action: 'start' | 'submit' | 'withdraw', reason: string | null, nowMs: number): Promise<ParticipationRow>;
  /** Upsert of the tester's note for one task while the participation is in progress. */
  putTaskNote(participationId: string, tester: UserRow, taskId: string, note: string): Promise<ParticipationRow>;
  /**
   * Approve or reject a submission (the study's builder, or an admin on stuck work): at most one
   * reward per participation, budget never negative, escrow payout authorised, points awarded,
   * admin decisions audited. Returns the decided participation.
   */
  decideParticipation(participationId: string, input: DecisionInput, nowMs: number): Promise<ParticipationRow>;

  // ── Findings and disputes ──────────────────────────────────────────────────────────────
  /** Oldest first. */
  listFindings(participationId: string): Promise<FindingRow[]>;
  /** The study's builder, once the tester has submitted; evidence must belong to the participation. */
  /** Rule D (plan R12): if a finding with this id already exists, it is returned and nothing is written. */
  createFinding(participationId: string, builder: UserRow, input: FindingInput, id: string, nowMs: number): Promise<FindingRow>;
  getDispute(id: string): Promise<DisputeRow | undefined>;
  /** Disputes on a study's participations, newest first. */
  listDisputesByStudy(studyId: string): Promise<DisputeRow[]>;
  /** Newest first. */
  listDisputesByOpener(userId: string): Promise<DisputeRow[]>;
  /** Open disputes first, then newest first (admin queue). */
  listAllDisputes(): Promise<DisputeRow[]>;
  /** The tester disputes a rejection inside its 7-day window. */
  openDispute(participationId: string, tester: UserRow, reason: string, id: string, nowMs: number): Promise<DisputeRow>;
  /** Admin resolution: an overturn pays the reward (or authorises the payout) exactly once; audited. */
  resolveDispute(disputeId: string, admin: UserRow, outcome: 'upheld' | 'overturned', note: string, nowMs: number): Promise<DisputeRow>;

  // ── Test-credit ledger (append-only, double-entry) ─────────────────────────────────────
  accountBalance(account: Account): Promise<number>;
  /** The account's postings, newest first. */
  ledgerEntries(account: Account): Promise<LedgerEntry[]>;
  /** The study account's postings summed per kind (budget views). */
  studyKindSums(studyId: string): Promise<KindSums>;
  /**
   * A faucet top-up of test credits, posted as ledger transaction `txId` (entries `${txId}:${i}`).
   * Rule D (plan R12): if that transaction was already posted, nothing is written. Callers pass
   * `ctx.idemId('ledger')`; without one it is a fresh id (no retry protection).
   */
  topUp(userId: string, amount: number, nowMs: number, txId?: string): Promise<void>;

  // ── Account export and deletion (called by handlers/account.ts) ────────────────────────
  /** Deletion precondition: the builder's published or paused studies. */
  liveStudiesOf(userId: string): Promise<number>;
  /** Deletion precondition: the tester's submitted or disputed participations. */
  openParticipationsOf(userId: string): Promise<number>;
  exportUser(userId: string): Promise<StudiesExport>;
  /**
   * Account deletion, studies part, exactly as today: findings lose links to evidence the user
   * recorded or that sits in their studies (run BEFORE the evidence purge, which deletes those
   * rows); task notes deleted; consented / in-progress participations withdrawn and every
   * decision reason cleared; disputes' reasons '[deleted]'; draft escrow studies closed with
   * their refund authorised (run AFTER the escrow purge, which expires those drafts' unpaid
   * fundings). Ledger postings are never touched. Idempotent. On SQLite it runs synchronously
   * inside the caller's transaction (never opens its own, and throws synchronously); on Firestore
   * it is bounded transactions looped until done. Returns no media keys (the evidence purge does).
   */
  purgeUser(userId: string, nowMs: number): Promise<{ mediaKeys: string[] }>;
}
