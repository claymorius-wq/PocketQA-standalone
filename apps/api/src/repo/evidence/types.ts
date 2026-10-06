import type { Evidence } from '@pocket-qa/contracts';
import type { EvidenceRow } from '../../views/evidence';

/**
 * Evidence repository (owner: see ../index.ts): evidence, direct-upload intents, local playback
 * tokens, the storage ownership registry and the deletion outbox. Intent-level async operations
 * only; object-store calls (R2, local files) stay in the callers, after these return.
 */

export type IntentStatus = 'pending' | 'completing' | 'completed' | 'rejected' | 'expired';

export type IntentRow = {
  id: string;
  participation_id: string;
  tester_id: string;
  kind: string;
  mime_type: EvidenceRow['mime_type'];
  declared_size: number;
  duration_ms: number | null;
  task_id: string | null;
  captured_on: string;
  client_segment_id: string;
  object_key: string;
  status: IntentStatus;
  evidence_id: string | null;
  expires_at: number;
};

/** A new evidence row; `created_at` is set by the repository from `now`. */
export type NewEvidence = Omit<EvidenceRow, 'created_at'>;

/** Evidence count and bytes for a participation. */
export type Usage = { n: number; bytes: number };

/** Why Pocket QA deletes a stored object (storage/sweep.ts DeletionPurpose). */
export type DeletionPurpose = 'failed_upload' | 'account_deletion';

export interface EvidenceRepo {
  // Reads.
  getEvidence(id: string): Promise<EvidenceRow | undefined>;
  /** A participation's evidence, oldest first. */
  listEvidence(participationId: string): Promise<EvidenceRow[]>;
  /** Stored evidence only (no intent reservations). */
  evidenceUsage(participationId: string): Promise<Usage>;
  segmentUploaded(participationId: string, clientSegmentId: string): Promise<boolean>;
  /** For findings (studies domain): the evidence exists and belongs to this participation. */
  evidenceInParticipation(evidenceId: string, participationId: string): Promise<boolean>;
  /** For submission (studies domain): intents still open (pending/completing, unexpired). */
  openIntentCount(participationId: string, now: number): Promise<number>;

  // Multipart upload (local storage). Re-checks participation state, quota and the segment in one transaction.
  addUploadedEvidence(e: NewEvidence, now: number): Promise<EvidenceRow>;

  // Direct upload (r2 storage).
  /** The open, unexpired intent for a segment, if any. */
  findOpenIntent(participationId: string, clientSegmentId: string, now: number): Promise<IntentRow | undefined>;
  /** Creates the intent (segment not uploaded, stale reservations released, quota) and registers its object key. */
  openUploadIntent(intent: IntentRow, now: number): Promise<void>;
  getIntent(id: string): Promise<IntentRow | undefined>;
  /** pending → expired (no-op otherwise). */
  expireIntent(id: string): Promise<void>;
  /** pending → completing with the evidence id it will produce; false if not pending. */
  claimIntent(id: string, evidenceId: string): Promise<boolean>;
  /** completing → `status` (no-op otherwise: never reopens an intent closed meanwhile). */
  releaseIntent(id: string, status: 'pending' | 'rejected'): Promise<void>;
  /** Creates the evidence and closes the claimed intent (state, segment, quota re-checked). */
  finalizeIntent(intent: IntentRow, e: NewEvidence, now: number): Promise<EvidenceRow>;

  // Local playback tokens (sqlite/local storage; hosted playback is a presigned GET).
  issuePlaybackToken(tokenHash: string, evidenceId: string, userId: string, expiresAt: number): Promise<void>;
  getPlaybackToken(tokenHash: string): Promise<{ evidence_id: string; user_id: string; expires_at: number } | undefined>;
  /** Logout and account deletion: every playback token the user holds stops working. */
  revokePlaybackTokens(userId: string): Promise<void>;

  // Storage ownership registry and deletion outbox (A5 scoped deletion).
  registerObject(key: string, now: number): Promise<void>;
  ownsObject(key: string): Promise<boolean>;
  /** Queues a key for retried deletion (first attempt failed); no-op if already queued. */
  enqueueDeletion(key: string, purpose: DeletionPurpose, now: number): Promise<void>;
  dueDeletions(now: number, limit: number): Promise<{ object_key: string; attempts: number; purpose: DeletionPurpose }[]>;
  deletionDone(key: string): Promise<void>;
  deletionRetry(key: string, nextAttemptAt: number): Promise<void>;

  // Sweep.
  /** Pending intents past expiry (each is then closed with `expireIntent`, one item at a time). */
  duePending(now: number, limit: number): Promise<string[]>;
  stuckCompleting(cutoff: number, limit: number): Promise<{ id: string; evidence_id: string | null }[]>;
  evidenceExists(id: string): Promise<boolean>;
  /** Unconditional close of a crashed completion. */
  expireIntentNow(id: string): Promise<void>;
  closedUnswept(now: number, limit: number): Promise<{ id: string; object_key: string; status: string }[]>;
  intentEvidenceExists(intentId: string): Promise<boolean>;
  markQuarantineSwept(id: string): Promise<void>;

  // Account (lead's handlers/account.ts).
  /** Evidence from the user's own participations (as a tester), as exported today. */
  exportUser(userId: string): Promise<{ evidence: Evidence[] }>;
  /**
   * Account deletion, evidence part: removes evidence the user recorded and evidence in studies
   * they own, revokes their playback tokens and closes their open intents. Returns the object keys
   * to delete or queue (final keys, retained quarantine copies, then open intents' quarantine keys).
   * `evidenceIds` are the removed evidence rows, for clearing findings' references (studies domain).
   * SQLite: runs synchronously inside the caller's transaction (opens none of its own).
   */
  purgeUser(userId: string, nowMs: number): Promise<{ mediaKeys: string[]; evidenceIds: string[] }>;
}
