import { appIdentityUri, SOLANA_DEVNET_CHAIN, WALLET_NONCE_TTL_SECONDS, type SiwsInput } from '@pocket-qa/contracts';
import { type DomainError, verifyWalletLogin, type LoginChallengeRecord } from '@pocket-qa/domain';
import type { Ctx, Handler } from '../context';
import { RateLimiter } from '../rateLimit';
import { fail, iso, newId, newNonce } from '../util';
import { userView, type UserRow } from '../views';
import { issueSession } from './account';

// Per process (see rateLimit.ts). The address limit is keyed by address *and* client, so
// nobody can lock a wallet's owner out by asking for challenges from elsewhere; the
// per-client cap bounds how many challenges one client can create overall.
const perAddressClient = new RateLimiter(5, 60_000);
const perClient = new RateLimiter(30, 60_000);
const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

function assertEnabled(ctx: Ctx) {
  if (!ctx.deps.config.walletLogin) throw fail('CONFLICT_STATE', 'Wallet sign-in is not enabled on this deployment.');
}

function limit(ctx: Ctx, address: string) {
  const now = ctx.deps.now();
  if (!perClient.take(`ip:${ctx.req.ip}`, now) || !perAddressClient.take(`addr:${address}|ip:${ctx.req.ip}`, now)) {
    throw fail('RATE_LIMITED', 'Too many wallet sign-in attempts. Try again in a minute.');
  }
}

/**
 * Firebase UID for a wallet sign-in, inside the login transaction: the account's existing
 * Firebase UID (e.g. its Google sign-in), or a new one keyed by its id for wallet-only
 * accounts (not a recovery method).
 */
function firebaseSubject(ctx: Ctx, userId: string): string {
  const db = ctx.deps.db;
  const row = db.prepare(`SELECT subject FROM identities WHERE provider = 'firebase' AND user_id = ?`).get(userId) as { subject: string } | undefined;
  if (row) return row.subject;
  db.prepare(`INSERT INTO identities (provider, subject, user_id, has_recovery, created_at) VALUES ('firebase', ?, ?, 0, ?)`).run(userId, userId, iso(ctx.deps.now()));
  return userId;
}

export const walletLoginHandlers = {
  walletLoginChallenge: (ctx) => {
    assertEnabled(ctx);
    const { address } = ctx.body;
    limit(ctx, address);
    const db = ctx.deps.db;
    const now = ctx.deps.now();
    const nonce = newNonce();
    // Web: bound to the deployment's real origin, so a solana:signIn wallet can compare it
    // with the page it is asked from (ADR 0005 §2). MWA (Android): bound to the app identity
    // the app declares to the wallet (docs/production/wallet-login-design.md). The stored
    // input is what verification rebuilds, so a signature for one surface fails the other.
    const origin = ctx.deps.config.publicOrigin!;
    const mwa = ctx.body.surface === 'mwa';
    const domain = mwa ? ctx.deps.config.siwsDomain : new URL(origin).host;
    const uri = mwa ? appIdentityUri(domain) : origin;
    const statement = mwa
      ? 'Sign in to Pocket QA in the Pocket QA Android app with this devnet wallet. Only sign this in the Pocket QA Android app, never on a website. This is not a payment and sends nothing.'
      : `Sign in to Pocket QA at ${origin} with this devnet wallet. Only sign this on ${domain}. This is not a payment and sends nothing.`;
    const input: SiwsInput = {
      domain,
      address,
      statement,
      uri,
      version: '1',
      chainId: SOLANA_DEVNET_CHAIN,
      nonce,
      issuedAt: iso(now),
      expirationTime: iso(now + WALLET_NONCE_TTL_SECONDS * 1000),
    };
    db.prepare('DELETE FROM wallet_login_challenges WHERE expires_at < ?').run(now - 3600_000);
    db.prepare('INSERT INTO wallet_login_challenges (nonce, address, input_json, expires_at, used_at, created_at) VALUES (?,?,?,?,NULL,?)').run(
      nonce,
      address,
      JSON.stringify(input),
      now + WALLET_NONCE_TTL_SECONDS * 1000,
      now,
    );
    return { input };
  },

  walletLogin: async (ctx) => {
    assertEnabled(ctx);
    const db = ctx.deps.db;
    const now = ctx.deps.now();
    const { address, nonce, signedMessage, signature, newAccount } = ctx.body;
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
      if (row && row.used_at === null) db.prepare('UPDATE wallet_login_challenges SET used_at = ? WHERE nonce = ?').run(now, nonce);
      try {
        verifyWalletLogin({ record, request: { address, nonce, signedMessage: b64(signedMessage), signature: b64(signature) }, nowMs: now });
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
        if (ctx.deps.config.authMode === 'firebase') subject = firebaseSubject(ctx, linked.id);
        return;
      }
      if (!newAccount) {
        outcome = fail('NOT_FOUND', 'No Pocket QA account uses this wallet yet.');
        return;
      }
      const created: UserRow = {
        id: newId(),
        // Wallet-only accounts have no email; a reserved .invalid address keeps users.email unique.
        email: '',
        password_hash: null,
        display_name: newAccount.displayName,
        role: newAccount.role,
        status: 'active',
        device_json: null,
        created_at: iso(now),
      };
      created.email = `wallet-${created.id}@wallet.pocketqa.invalid`;
      db.prepare(
        'INSERT INTO users (id, email, password_hash, display_name, role, status, device_json, created_at) VALUES (@id,@email,@password_hash,@display_name,@role,@status,@device_json,@created_at)',
      ).run(created);
      db.prepare('INSERT INTO wallet_links (user_id, address, linked_at) VALUES (?,?,?)').run(created.id, address, iso(now));
      user = created;
      if (ctx.deps.config.authMode === 'firebase') subject = firebaseSubject(ctx, created.id);
    })();
    if (outcome) throw outcome;
    const signedIn = user as unknown as UserRow;
    const session =
      ctx.deps.config.authMode === 'local'
        ? { kind: 'local' as const, token: issueSession(ctx, signedIn).token }
        : { kind: 'firebase_custom_token' as const, customToken: await ctx.deps.identity!.createCustomToken(subject!) };
    return { user: userView(db, signedIn), session };
  },
} satisfies Record<string, Handler>;
