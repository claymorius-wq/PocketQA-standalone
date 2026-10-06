import type { UserRow } from '../../views/core';

/** One audit entry (append-only). */
export type AuditRow = {
  id: string;
  actor_id: string;
  action: string;
  target_type: 'study' | 'user' | 'dispute' | 'participation' | 'storage_object';
  target_id: string;
  reason: string;
  created_at: string;
};

/** Result of an idempotent request lookup (plan r2 §R3). */
export type IdempotencyHit = { kind: 'new' } | { kind: 'replay'; status: number; body: unknown } | { kind: 'mismatch' };

/**
 * Core repository (owner: lead): users, identities, sessions, audit, idempotency, rate limits,
 * job leases. Intent-level async operations; sqlite.ts keeps today's SQL, firestore.ts is native.
 */
export interface CoreRepo {
  /** A cheap round trip to the data store (health check). */
  ping(): Promise<void>;

  userById(id: string): Promise<UserRow | null>;
  /** An account that can sign in (status != 'deleted'), by exact email. */
  activeUserByEmail(email: string): Promise<UserRow | null>;
  /** Any account row holds this email (deleted accounts hold a placeholder, so theirs is free again). */
  emailTaken(email: string): Promise<boolean>;
  /** Creates a local-password account; 'email_taken' if another holds the email (race-safe). */
  createUser(row: UserRow): Promise<'created' | 'email_taken'>;
  /** Creates a managed-identity account and its firebase identity atomically. */
  createUserWithIdentity(row: UserRow, uid: string, createdAt: string): Promise<'created' | 'email_taken' | 'identity_taken'>;
  setDevice(userId: string, deviceJson: string): Promise<void>;
  setStatus(userId: string, status: 'active' | 'suspended'): Promise<void>;
  /** An admin moderation: the status change and its audit row commit together (plan T6); idempotent by audit id. */
  setStatusAudited(userId: string, status: 'active' | 'suspended', audit: AuditRow): Promise<void>;
  setRole(userId: string, role: 'admin'): Promise<void>;

  /**
   * Plan §7(a): the first sign-in with a verified email claims a MIGRATED account with that email
   * (`migrated_link: 'verified_email'`, set only by the migration; never an admin) that has no sign-in yet. The
   * identity, the provider guard, clearing the marker and the audit row commit together, so it
   * happens at most once. Returns the account, or null when nothing is eligible: then the
   * normal rule applies, and accounts are never merged by email.
   */
  linkMigratedIdentity(email: string, uid: string, audit: { id: string; createdAt: string }): Promise<UserRow | null>;
  /** True if any account (even deleted) is mapped to this firebase uid. */
  identityMapped(uid: string): Promise<boolean>;
  /** The live account mapped to this firebase uid, with its server-side revocation time. */
  userByIdentity(uid: string): Promise<{ user: UserRow; validAfterMs: number } | null>;
  /** The user has signed in with a recoverable (verified email/Google) identity. */
  markRecovery(uid: string): Promise<void>;
  hasRecoverableIdentity(userId: string): Promise<boolean>;
  /** Firebase subjects of this user. */
  identitySubjects(userId: string): Promise<string[]>;
  /** Refuses this user's ID tokens issued at or before `nowMs` (server-side logout). */
  revokeIdentities(userId: string, nowMs: number): Promise<void>;

  createSession(tokenHash: string, userId: string, createdAt: string, expiresAtMs: number): Promise<void>;
  /** The live account behind an unexpired session. */
  userBySession(tokenHash: string, nowMs: number): Promise<UserRow | null>;
  deleteSession(tokenHash: string): Promise<void>;

  appendAudit(row: AuditRow): Promise<void>;
  /** Newest first, at most 500. */
  listAudit(): Promise<AuditRow[]>;

  /** Account deletion: audit reasons about these targets become '[redacted on account deletion]'. */
  redactAudit(targets: { type: 'user' | 'participation' | 'dispute'; id: string }[]): Promise<void>;
  /**
   * Account deletion, core part, exactly as today: sessions and identities deleted; the user row
   * anonymised (email `deleted-<id>@deleted.invalid`, no password, 'Deleted user', no device,
   * status 'deleted'), which frees the old email. Idempotent. On SQLite it runs inside the
   * caller's transaction; on Firestore it is its own bounded transaction (email guards moved).
   */
  purgeUserCore(userId: string): Promise<void>;

  /**
   * Idempotency reservation (plan R3, as revised in R10): the first request with a scope claims
   * it `pending`; a retry gets the stored response once `completeIdempotency` ran, `in_progress`
   * while the first is still running, and `mismatch` if the body fingerprint differs. Records
   * live 24 h, and the TTL is checked on read.
   */
  beginIdempotency(scope: string, fingerprint: string, nowMs: number): Promise<IdempotencyHit | { kind: 'in_progress' }>;
  completeIdempotency(scope: string, status: number, body: unknown): Promise<void>;
  /** The handler failed: drop the reservation so the client can retry. */
  abandonIdempotency(scope: string): Promise<void>;

  /** Shared fixed-window rate limit (plan R6): true if this hit is allowed. */
  rateLimitHit(bucket: string, windowMs: number, max: number, nowMs: number): Promise<boolean>;

  /**
   * Job leases with fencing (plan §5): the holder gets a fence number while the lease is live;
   * every item write checks `leaseValid(job, fence)`, so a stale holder is refused.
   */
  acquireLease(job: string, holder: string, ttlMs: number, nowMs: number): Promise<number | null>;
  leaseValid(job: string, fence: number, nowMs: number): Promise<boolean>;
  releaseLease(job: string, fence: number): Promise<void>;
}
