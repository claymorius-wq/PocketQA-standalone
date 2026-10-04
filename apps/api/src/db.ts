import Database from 'better-sqlite3';

export type DB = Database.Database;

// Append-only migration list; never edit a shipped entry, add a new one.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('tester','builder','admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
    device_json TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE studies (
    id TEXT PRIMARY KEY,
    builder_id TEXT NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    objective TEXT NOT NULL,
    build_under_test TEXT,
    device_criteria_json TEXT NOT NULL,
    reward_credits INTEGER NOT NULL CHECK (reward_credits > 0),
    slots INTEGER NOT NULL CHECK (slots > 0),
    consent_text TEXT NOT NULL,
    consent_version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL CHECK (status IN ('draft','published','paused','closed')),
    moderation TEXT NOT NULL DEFAULT 'ok' CHECK (moderation IN ('ok','suspended')),
    created_at TEXT NOT NULL,
    published_at TEXT,
    closed_at TEXT
  );
  CREATE TABLE tasks (
    id TEXT PRIMARY KEY,
    study_id TEXT NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
    ord INTEGER NOT NULL,
    instruction TEXT NOT NULL,
    success_criteria TEXT
  );
  CREATE TABLE participations (
    id TEXT PRIMARY KEY,
    study_id TEXT NOT NULL REFERENCES studies(id),
    tester_id TEXT NOT NULL REFERENCES users(id),
    status TEXT NOT NULL,
    consent_version INTEGER NOT NULL,
    consented_at TEXT NOT NULL,
    started_at TEXT,
    submitted_at TEXT,
    decided_at TEXT,
    decided_by TEXT,
    decision_reason TEXT,
    reward_credits INTEGER NOT NULL,
    UNIQUE (study_id, tester_id)
  );
  CREATE TABLE task_notes (
    participation_id TEXT NOT NULL REFERENCES participations(id) ON DELETE CASCADE,
    task_id TEXT NOT NULL,
    note TEXT NOT NULL,
    PRIMARY KEY (participation_id, task_id)
  );
  CREATE TABLE evidence (
    id TEXT PRIMARY KEY,
    participation_id TEXT NOT NULL REFERENCES participations(id),
    kind TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    duration_ms INTEGER,
    task_id TEXT,
    captured_on TEXT NOT NULL,
    client_segment_id TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (participation_id, client_segment_id)
  );
  CREATE TABLE playback_tokens (
    token_hash TEXT PRIMARY KEY,
    evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE findings (
    id TEXT PRIMARY KEY,
    participation_id TEXT NOT NULL REFERENCES participations(id),
    title TEXT NOT NULL,
    severity TEXT NOT NULL,
    description TEXT NOT NULL,
    evidence_id TEXT,
    timestamp_ms INTEGER,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE ledger (
    id TEXT PRIMARY KEY,
    tx_id TEXT NOT NULL,
    account TEXT NOT NULL,
    amount INTEGER NOT NULL,
    kind TEXT NOT NULL,
    study_id TEXT,
    participation_id TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX ledger_account ON ledger(account);
  -- Idempotent rewards: at most one credit posting per participation and kind.
  CREATE UNIQUE INDEX ledger_one_reward ON ledger(participation_id, kind)
    WHERE kind IN ('reward_credit','dispute_credit') AND amount > 0;
  -- The ledger is append-only.
  CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
  CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is append-only'); END;
  CREATE TABLE disputes (
    id TEXT PRIMARY KEY,
    participation_id TEXT NOT NULL UNIQUE REFERENCES participations(id),
    opened_by TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL,
    outcome TEXT,
    resolution_note TEXT,
    resolved_by TEXT,
    created_at TEXT NOT NULL,
    resolved_at TEXT
  );
  CREATE TABLE audit (
    id TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE wallet_links (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    address TEXT NOT NULL UNIQUE,
    linked_at TEXT NOT NULL
  );
  CREATE TABLE wallet_nonces (
    nonce TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    address TEXT NOT NULL,
    input_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER
  );
  CREATE TABLE devnet_transfers (
    id TEXT PRIMARY KEY,
    participation_id TEXT NOT NULL REFERENCES participations(id),
    builder_id TEXT NOT NULL,
    tester_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    recipient TEXT NOT NULL,
    lamports INTEGER NOT NULL,
    signature TEXT UNIQUE,
    status TEXT NOT NULL,
    failure_reason TEXT,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    verified_at TEXT
  );
  CREATE UNIQUE INDEX one_open_transfer ON devnet_transfers(participation_id)
    WHERE status IN ('awaiting_signature','pending','confirmed');
  `,
  // 1: managed identity (ADR 0005). One provider identity maps to exactly one internal
  // user; `has_recovery` marks identities that can sign in without the wallet.
  `
  CREATE TABLE identities (
    provider TEXT NOT NULL,
    subject TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES users(id),
    has_recovery INTEGER NOT NULL DEFAULT 0,
    -- ID tokens whose auth time is at or before this (ms) are refused. Provider revocation
    -- has one-second granularity, so logout also records this server-side.
    valid_after_ms INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (provider, subject)
  );
  CREATE UNIQUE INDEX identities_user_provider ON identities(user_id, provider);
  `,
  // 2: wallet-first login challenges (ADR 0005 §2). Separate from wallet_nonces (account
  // linking), so a link signature can never be replayed as a login and vice versa.
  `
  CREATE TABLE wallet_login_challenges (
    nonce TEXT PRIMARY KEY,
    address TEXT NOT NULL,
    input_json TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX wallet_login_challenges_expiry ON wallet_login_challenges(expires_at);
  `,
  // 3: direct-to-storage uploads (ADR 0005 §3). An intent reserves quota until it is
  // completed, rejected or expired; storage_deletions is a retried outbox so object
  // deletion survives provider failures.
  `
  CREATE TABLE upload_intents (
    id TEXT PRIMARY KEY,
    participation_id TEXT NOT NULL REFERENCES participations(id),
    tester_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    declared_size INTEGER NOT NULL,
    duration_ms INTEGER,
    task_id TEXT,
    captured_on TEXT NOT NULL,
    client_segment_id TEXT NOT NULL,
    object_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('pending','completing','completed','rejected','expired')),
    evidence_id TEXT,
    -- Set once the sweep has removed the quarantine object after the intent closed (a
    -- re-PUT with a still-valid URL can recreate it until the URL expires).
    quarantine_swept INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX upload_intents_one_open_segment ON upload_intents(participation_id, client_segment_id)
    WHERE status IN ('pending','completing');
  CREATE TABLE storage_deletions (
    object_key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  // 4: scoped deletion (Hamza, A5, 2026-10-04): Pocket QA may delete only objects it created
  // itself. Every key the app writes is registered here before the write and the row is never
  // removed, so ownership stays provable (a still-valid presigned URL can recreate a deleted
  // quarantine object, which the sweep must still be allowed to remove). Deletion of any key
  // not registered here is refused (storage/sweep.ts deleteOrQueue). Backfilled from the rows
  // that already reference objects this database created.
  `
  CREATE TABLE storage_objects (
    object_key TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL
  );
  INSERT OR IGNORE INTO storage_objects (object_key, created_at) SELECT object_key, created_at FROM upload_intents;
  INSERT OR IGNORE INTO storage_objects (object_key, created_at)
    SELECT 'evidence/' || evidence_id, created_at FROM upload_intents WHERE evidence_id IS NOT NULL;
  INSERT OR IGNORE INTO storage_objects (object_key, created_at) SELECT storage_key, 0 FROM evidence;
  ALTER TABLE storage_deletions ADD COLUMN purpose TEXT NOT NULL DEFAULT 'unrecorded';
  `,
  // 5: wallet-funded escrow, SIMULATED settlement only (ADR 0007). A separate money ledger in
  // whole token base units: never mixed with test credits (ledger) or reputation points.
  // For escrow studies `studies.reward_credits` holds the reward in token base units (the
  // column means "reward in the study's unit"; payment_mode says which unit) and the test-credit
  // ledger is never touched for them.
  `
  ALTER TABLE studies ADD COLUMN payment_mode TEXT NOT NULL DEFAULT 'test_credits' CHECK (payment_mode IN ('test_credits','escrow'));
  -- Escrow participations: the payout wallet frozen at consent.
  ALTER TABLE participations ADD COLUMN payout_address TEXT;
  CREATE TABLE study_escrows (
    study_id TEXT PRIMARY KEY REFERENCES studies(id),
    settlement TEXT NOT NULL CHECK (settlement = 'simulated'),
    network TEXT NOT NULL,
    mint TEXT NOT NULL,
    vault TEXT NOT NULL UNIQUE,
    fee_bps INTEGER NOT NULL CHECK (fee_bps BETWEEN 0 AND 10000),
    -- Set from the verified funding transfer; refunds go only here.
    funding_wallet TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE escrow_fundings (
    id TEXT PRIMARY KEY,
    study_id TEXT NOT NULL REFERENCES studies(id),
    amount_units INTEGER NOT NULL CHECK (amount_units > 0),
    reference TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('awaiting_payment','pending','confirmed','failed','expired')),
    -- One transfer signature funds one request, ever.
    signature TEXT UNIQUE,
    source TEXT,
    failure_reason TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    confirmed_at INTEGER
  );
  CREATE UNIQUE INDEX escrow_one_confirmed_funding ON escrow_fundings(study_id) WHERE status = 'confirmed';
  CREATE TABLE escrow_ledger (
    id TEXT PRIMARY KEY,
    tx_id TEXT NOT NULL,
    account TEXT NOT NULL,
    amount INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('funding','payout_authorized','fee_earned','payout_settled','refund_authorized','refund_settled')),
    study_id TEXT NOT NULL,
    participation_id TEXT,
    ref TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX escrow_ledger_study ON escrow_ledger(study_id);
  -- Idempotency: each money event happens at most once.
  CREATE UNIQUE INDEX escrow_one_funding ON escrow_ledger(ref) WHERE kind = 'funding' AND amount > 0;
  CREATE UNIQUE INDEX escrow_one_authorization ON escrow_ledger(participation_id) WHERE kind = 'payout_authorized' AND amount > 0;
  CREATE UNIQUE INDEX escrow_one_settlement ON escrow_ledger(participation_id) WHERE kind = 'payout_settled' AND amount > 0;
  CREATE UNIQUE INDEX escrow_one_refund ON escrow_ledger(study_id) WHERE kind = 'refund_authorized' AND amount > 0;
  CREATE UNIQUE INDEX escrow_one_refund_settled ON escrow_ledger(study_id) WHERE kind = 'refund_settled' AND amount > 0;
  CREATE TRIGGER escrow_ledger_no_update BEFORE UPDATE ON escrow_ledger BEGIN SELECT RAISE(ABORT, 'escrow ledger is append-only'); END;
  CREATE TRIGGER escrow_ledger_no_delete BEFORE DELETE ON escrow_ledger BEGIN SELECT RAISE(ABORT, 'escrow ledger is append-only'); END;
  -- Outbound transfers (payouts and refunds), driven by the settlement worker. The amount and
  -- destination are fixed when the row is created and never change.
  CREATE TABLE settlements (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('payout','refund')),
    study_id TEXT NOT NULL REFERENCES studies(id),
    participation_id TEXT,
    tester_id TEXT,
    destination TEXT NOT NULL,
    amount_units INTEGER NOT NULL CHECK (amount_units > 0),
    status TEXT NOT NULL CHECK (status IN ('pending','submitted','confirmed','failed')),
    attempt INTEGER NOT NULL DEFAULT 0,
    -- Persisted before each submission, so a crash retries with the same key (no double send).
    attempt_key TEXT,
    signature TEXT UNIQUE,
    failure_reason TEXT,
    next_attempt_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    settled_at INTEGER
  );
  CREATE UNIQUE INDEX settlements_one_payout ON settlements(participation_id) WHERE kind = 'payout';
  CREATE UNIQUE INDEX settlements_one_refund ON settlements(study_id) WHERE kind = 'refund';
  -- The SIMULATED chain (ADR 0007 §4): a local stand-in, no network, no asset.
  CREATE TABLE sim_chain_transfers (
    signature TEXT PRIMARY KEY,
    network TEXT NOT NULL,
    mint TEXT NOT NULL,
    source TEXT NOT NULL,
    destination TEXT NOT NULL,
    amount_units INTEGER NOT NULL,
    reference TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('funding','payout','refund','other')),
    status TEXT NOT NULL CHECK (status IN ('processing','finalized','failed')),
    idempotency_key TEXT UNIQUE,
    block_time_ms INTEGER NOT NULL
  );
  `,
  // 6: reputation (points, fraud reversals, self-dealing flags, opt-in leaderboard). Points are
  // append-only and separate from money and test credits; they have no cash value.
  `
  CREATE TABLE points_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    participation_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('accepted','helpful','reversal')),
    points INTEGER NOT NULL,
    reverses_id TEXT UNIQUE REFERENCES points_events(id),
    platform TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX points_events_user ON points_events(user_id);
  -- One award of each kind per participation.
  CREATE UNIQUE INDEX points_one_award ON points_events(participation_id, kind) WHERE kind IN ('accepted','helpful');
  CREATE TRIGGER points_no_update BEFORE UPDATE ON points_events BEGIN SELECT RAISE(ABORT, 'points are append-only'); END;
  CREATE TRIGGER points_no_delete BEFORE DELETE ON points_events BEGIN SELECT RAISE(ABORT, 'points are append-only'); END;
  CREATE TABLE fraud_findings (
    participation_id TEXT PRIMARY KEY REFERENCES participations(id),
    reason TEXT NOT NULL,
    decided_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  -- Accepted work that earned no points because it looked like self-dealing.
  CREATE TABLE points_flags (
    participation_id TEXT PRIMARY KEY REFERENCES participations(id),
    reason TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE leaderboard_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    opted_in INTEGER NOT NULL CHECK (opted_in IN (0,1)),
    alias TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX leaderboard_alias ON leaderboard_profiles(lower(alias)) WHERE alias IS NOT NULL;
  `,
];

/** How many migrations this code ships; tools compare it with a live database's schema. */
export const MIGRATION_COUNT = MIGRATIONS.length;

export function openDb(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)');
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((r) => r.version),
  );
  MIGRATIONS.forEach((sql, i) => {
    if (applied.has(i)) return;
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(i);
    })();
  });
  return db;
}
