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
];

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
