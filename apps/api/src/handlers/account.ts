import { CONTRACT_VERSION, CREDITS_DISCLAIMER, Email } from '@pocket-qa/contracts';
import { userAccount } from '@pocket-qa/domain';
import { me, type Ctx, type Handler } from '../context';
import { RECOVERABLE_PROVIDERS } from '../identity/types';
import { deleteOrQueue } from '../storage/sweep';
import { fail, hashPassword, iso, newId, newToken, sha256, verifyPassword } from '../util';
import { disputeView, findingView, participationViewOf, studyViewOf, userViewOf, type UserRow } from '../views';

export const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;

// Simple in-memory brute-force brake for the local MVP: 10 failures per email per 15 min.
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const failures = new Map<string, { count: number; first: number }>();

let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hashPassword(newToken()));

export async function issueSession(ctx: Ctx, user: UserRow) {
  const token = newToken();
  const now = ctx.deps.now();
  await ctx.deps.repo.core.createSession(sha256(token), user.id, iso(now), now + SESSION_TTL_MS);
  return { token, user: await userViewOf(ctx.deps.repo, user) };
}

/** One account system per deployment: managed identity replaces local passwords (ADR 0005). */
function assertLocalAuth(ctx: Ctx) {
  if (ctx.deps.config.authMode !== 'local') {
    throw fail('CONFLICT_STATE', 'This deployment uses managed sign-in (email, Google or wallet).');
  }
}

async function creditsView(ctx: Ctx, userId: string) {
  const account = userAccount(userId);
  const [balance, entries] = await Promise.all([ctx.deps.repo.studies.accountBalance(account), ctx.deps.repo.studies.ledgerEntries(account)]);
  return {
    balance,
    entries: entries.map((r) => ({ id: r.id, kind: r.kind, amount: r.amount, studyId: r.study_id, participationId: r.participation_id, createdAt: r.created_at })),
    disclaimer: CREDITS_DISCLAIMER,
  };
}

export const accountHandlers = {
  // Readiness, not just liveness: a database that can't answer fails the check (ledger O1).
  health: async (ctx) => {
    await ctx.deps.repo.core.ping();
    return { ok: true as const, contractVersion: CONTRACT_VERSION };
  },

  clientConfig: (ctx) => {
    const { authMode, firebase } = ctx.deps.config;
    return {
      authMode,
      storage: ctx.deps.config.storage,
      walletLogin: ctx.deps.config.walletLogin,
      features: ctx.deps.config.features,
      firebase: firebase
        ? {
            apiKey: firebase.webApiKey,
            authDomain: firebase.authDomain,
            projectId: firebase.projectId,
            authEmulatorUrl: firebase.authEmulatorHost ? `http://${firebase.authEmulatorHost}` : null,
          }
        : null,
    };
  },

  /**
   * First sign-in with a managed identity. Returns the mapped account, claims a migrated account
   * by its verified email (plan §7a), or creates one only when asked with a self-serve role. Never
   * merges with any other existing account by email.
   */
  identitySession: async (ctx) => {
    const id = ctx.identity!;
    const core = ctx.deps.repo.core;
    if (ctx.user) return { user: await userViewOf(ctx.deps.repo, ctx.user) };
    if (await core.identityMapped(id.uid)) throw fail('CONFLICT_STATE', 'This sign-in belongs to a deleted account.');
    // Check the identity itself first, so an unverified sign-in hears "verify your email"
    // instead of being offered an account it can't create yet.
    // Custom-token identities come only from wallet login, which creates its own accounts.
    if (id.signInProvider === 'custom') throw fail('CONFLICT_STATE', 'Use wallet sign-in to create a wallet account.');
    // Every provider must prove the email, so nobody can claim someone else's address.
    if (!id.emailVerified) throw fail('EMAIL_UNVERIFIED', 'Verify your email address, then sign in again.');
    if (!RECOVERABLE_PROVIDERS.has(id.signInProvider)) throw fail('PROVIDER_UNSUPPORTED', 'This sign-in method is not supported. Use email or Google.');
    const email = Email.safeParse(id.email ?? '');
    // Plan §7(a): an account migrated from the local build is claimed once by its own verified
    // email. Every other existing account is still never merged by email (below).
    if (email.success) {
      const linked = await core.linkMigratedIdentity(email.data, id.uid, { id: newId(), createdAt: iso(ctx.deps.now()) });
      if (linked) return { user: await userViewOf(ctx.deps.repo, linked) };
    }
    if (!ctx.body.newAccount) throw fail('NOT_FOUND', 'No Pocket QA account uses this sign-in yet.');
    if (!email.success) throw fail('VALIDATION', 'This sign-in has no usable email address.');
    const existsMsg = 'An account with this email already exists. Accounts are never merged automatically.';
    if (await core.emailTaken(email.data)) throw fail('CONFLICT_STATE', existsMsg);
    const now = iso(ctx.deps.now());
    const row: UserRow = {
      id: newId(),
      email: email.data,
      password_hash: null,
      display_name: ctx.body.newAccount.displayName,
      role: ctx.body.newAccount.role,
      status: 'active',
      device_json: null,
      created_at: now,
    };
    // Atomic and race-safe: the email and the identity are claimed together.
    const created = await core.createUserWithIdentity(row, id.uid, now);
    if (created === 'email_taken') throw fail('CONFLICT_STATE', existsMsg);
    if (created === 'identity_taken') throw fail('CONFLICT_STATE', 'This sign-in belongs to a deleted account.');
    return { user: await userViewOf(ctx.deps.repo, row) };
  },

  register: async (ctx) => {
    assertLocalAuth(ctx);
    const { email, password, displayName, role } = ctx.body;
    const taken = () => fail('CONFLICT_STATE', 'An account with this email already exists.');
    if (await ctx.deps.repo.core.emailTaken(email)) throw taken();
    const row: UserRow = {
      id: newId(),
      email,
      password_hash: await hashPassword(password),
      display_name: displayName,
      role,
      status: 'active',
      device_json: null,
      created_at: iso(ctx.deps.now()),
    };
    if ((await ctx.deps.repo.core.createUser(row)) === 'email_taken') throw taken();
    return issueSession(ctx, row);
  },

  login: async (ctx) => {
    assertLocalAuth(ctx);
    const { email, password } = ctx.body;
    const now = ctx.deps.now();
    const f = failures.get(email);
    if (f && now - f.first < LOGIN_WINDOW_MS && f.count >= LOGIN_MAX_FAILURES) {
      throw fail('RATE_LIMITED', 'Too many failed sign-in attempts. Try again later.');
    }
    const row = (await ctx.deps.repo.core.activeUserByEmail(email)) ?? undefined;
    // Unknown emails still pay for one argon2 verify, so timing doesn't reveal which accounts exist.
    const ok = await verifyPassword(row?.password_hash ?? (await dummyHash()), password);
    if (!row || !ok) {
      if (failures.size > 10_000) {
        for (const [k, v] of failures) if (now - v.first >= LOGIN_WINDOW_MS) failures.delete(k);
      }
      const cur = f && now - f.first < LOGIN_WINDOW_MS ? f : { count: 0, first: now };
      failures.set(email, { count: cur.count + 1, first: cur.first });
      throw fail('UNAUTHENTICATED', 'Email or password is incorrect.');
    }
    failures.delete(email);
    return issueSession(ctx, row);
  },

  logout: async (ctx) => {
    const header = ctx.req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    const core = ctx.deps.repo.core;
    await core.deleteSession(sha256(token));
    // Playback URLs handed out during this session stop working too.
    await ctx.deps.repo.evidence.revokePlaybackTokens(me(ctx).id);
    // Managed identity: logout is global (every device). Refuse this and older ID tokens
    // server-side at once, then revoke the provider's refresh tokens. A provider failure is
    // logged, not surfaced: the server-side revocation is already in force.
    if (ctx.deps.identity) {
      await core.revokeIdentities(me(ctx).id, ctx.deps.now());
      for (const uid of await core.identitySubjects(me(ctx).id)) {
        await ctx.deps.identity.revokeSessions(uid).catch(() => ctx.req.log.warn('identity provider revocation failed; server-side revocation applied'));
      }
    }
    return { ok: true as const };
  },

  me: (ctx) => userViewOf(ctx.deps.repo, me(ctx)),

  putDevice: async (ctx) => {
    const user = me(ctx);
    const device = JSON.stringify(ctx.body);
    await ctx.deps.repo.core.setDevice(user.id, device);
    return userViewOf(ctx.deps.repo, { ...user, device_json: device });
  },

  credits: (ctx) => creditsView(ctx, me(ctx).id),

  topUp: async (ctx) => {
    if (!ctx.deps.config.features.testCredits) {
      throw fail('FEATURE_UNAVAILABLE', 'Test credits aren’t available on this deployment. Funding with real money isn’t enabled yet.');
    }
    const user = me(ctx);
    await ctx.deps.repo.studies.topUp(user.id, ctx.body.amount, ctx.deps.now(), ctx.idemId('ledger')); // rule D (plan R12)
    return creditsView(ctx, user.id);
  },

  exportMe: async (ctx) => {
    const user = me(ctx);
    const { repo } = ctx.deps;
    const now = ctx.deps.now();
    const [mine, ev, pay] = await Promise.all([repo.studies.exportUser(user.id), repo.evidence.exportUser(user.id), repo.escrow.exportUser(user.id, now)]);
    return {
      exportedAt: iso(now),
      user: await userViewOf(repo, user),
      studies: await Promise.all(mine.studies.map((s) => studyViewOf(repo, s, now))),
      // The reward record lives once, in `payments.received` (exact string units, no retry
      // internals); the participation copy drops it (pqa-qa export r3 P3-1).
      participations: await Promise.all(mine.participations.map(async (p) => ({ ...(await participationViewOf(repo, p, { withTesterName: false })), payout: null }))),
      evidence: ev.evidence,
      // Findings the user authored (builder) or that concern their own participations (tester).
      findings: mine.findings.map(findingView),
      ledger: (await creditsView(ctx, user.id)).entries,
      disputes: mine.disputes.map(disputeView),
      payments: pay.payments,
      reputation: pay.reputation,
    };
  },

  /**
   * Deletion removes personal data and media. Retention exception (documented in
   * docs/decisions/0002-retention.md): ledger postings stay, keyed by the now-anonymous
   * user id, because deleting them would break other parties' budgets and balances.
   */
  deleteMe: async (ctx) => {
    const user = me(ctx);
    const { repo } = ctx.deps;
    const now = ctx.deps.now();
    const subjects = await repo.core.identitySubjects(user.id);
    if ((await repo.studies.liveStudiesOf(user.id)) > 0) throw fail('CONFLICT_STATE', 'Close your published or paused studies before deleting your account.');
    if ((await repo.studies.openParticipationsOf(user.id)) > 0) throw fail('CONFLICT_STATE', 'Wait until your submitted work is reviewed and disputes are resolved.');
    // Fail closed: never report a deletion that leaves the user's recordings in storage.
    if (!ctx.deps.store.canDelete) {
      throw fail('CONFLICT_STATE', 'Account deletion is unavailable on this deployment: stored recordings can’t be erased yet. Nothing was deleted.');
    }
    // Audit reasons about the user, or about their work (admin decisions on their participations,
    // resolutions of their disputes), are redacted; action, actor and timestamp stay (ADR 0002).
    const mine = await repo.studies.exportUser(user.id);
    const redact = [
      { type: 'user' as const, id: user.id },
      ...mine.participations.map((p) => ({ type: 'participation' as const, id: p.id })),
      ...mine.disputes.map((d) => ({ type: 'dispute' as const, id: d.id })),
    ];
    const deletedAudit = { id: newId(), actor_id: user.id, action: 'user.deleted', target_type: 'user' as const, target_id: user.id, reason: '[account deleted by its owner]', created_at: iso(now) };

    // Order matters (each domain's purge applies today's deleteMe effects for its tables):
    // escrow first (a builder's unpaid wallet-funded drafts expire and close, refunds authorised),
    // then studies (it nulls findings.evidence_id while the evidence rows still exist), then
    // evidence (rows deleted, media keys returned for the outbox), then core (redaction, sessions,
    // identities, the user anonymised) and the fixed-text deletion audit row.
    let mediaKeys: string[] = [];
    if (repo.kind === 'sqlite') {
      const db = ctx.deps.db;
      if (!db) throw new Error('SQLite repositories without their database');
      // One transaction, as before: the sqlite purges run and throw synchronously inside it.
      const pending: Promise<{ mediaKeys: string[] }>[] = [];
      db.transaction(() => {
        pending.push(repo.escrow.purgeUser(user.id, now));
        pending.push(repo.studies.purgeUser(user.id, now));
        pending.push(repo.evidence.purgeUser(user.id, now));
        void repo.core.redactAudit(redact);
        void repo.core.purgeUserCore(user.id);
        void repo.core.appendAudit(deletedAudit);
      })();
      mediaKeys = (await Promise.all(pending)).flatMap((r) => r.mediaKeys);
    } else {
      // Firestore: bounded, idempotent steps. The user is marked deleted LAST, so a crash midway
      // leaves an account that can still sign in and simply retry the deletion.
      for (const step of [() => repo.escrow.purgeUser(user.id, now), () => repo.studies.purgeUser(user.id, now), () => repo.evidence.purgeUser(user.id, now)]) {
        mediaKeys.push(...(await step()).mediaKeys);
      }
      await repo.core.redactAudit(redact);
      await repo.core.purgeUserCore(user.id);
      await repo.core.appendAudit(deletedAudit);
    }
    // Stored objects: deleted now, or retried through the outbox if the provider fails.
    for (const key of mediaKeys) await deleteOrQueue(ctx.deps, key, 'account_deletion', user.id);
    // After commit: the local account is gone either way. A provider failure leaves an
    // orphan provider user with no mapping (it can't reach this account); it is logged.
    if (ctx.deps.identity) {
      for (const uid of subjects) {
        await ctx.deps.identity.revokeSessions(uid).catch(() => {});
        await ctx.deps.identity.deleteUser(uid).catch(() => ctx.req.log.warn('identity provider user deletion failed; orphaned provider user'));
      }
    }
    return { ok: true as const };
  },

  aiStatus: () => ({ available: false, provider: null }),
} satisfies Record<string, Handler>;
