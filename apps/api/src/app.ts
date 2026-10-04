import Fastify, { type FastifyRequest, type FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { MAX_EVIDENCE_BYTES, redactPath, routes, type RouteName } from '@pocket-qa/contracts';
import { DomainError } from '@pocket-qa/domain';
import type { Ctx, Deps, Handler } from './context';
import { accountHandlers } from './handlers/account';
import { adminHandlers } from './handlers/admin';
import { escrowHandlers } from './handlers/escrow';
import { evidenceHandlers } from './handlers/evidence';
import { participationHandlers } from './handlers/participations';
import { studyHandlers } from './handlers/studies';
import { walletHandlers } from './handlers/wallet';
import { walletLoginHandlers } from './handlers/walletLogin';
import { HTTP_STATUS, fail, sha256 } from './util';
import { IdentityError, isRecoverableSignIn, type VerifiedIdentity } from './identity/types';
import type { UserRow } from './views';

// Exhaustive: adding a route to the contract without a handler is a type error.
const handlers: Record<RouteName, Handler> = {
  ...accountHandlers,
  ...studyHandlers,
  ...participationHandlers,
  ...evidenceHandlers,
  ...adminHandlers,
  ...walletHandlers,
  ...walletLoginHandlers,
  ...escrowHandlers,
};

/** Routes a suspended account may still use: see itself, leave, export or delete its data. */
const SUSPENDED_ALLOWED = new Set<RouteName>(['me', 'logout', 'exportMe', 'deleteMe']);

function safeDecode(url: string): string {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

/**
 * Log line URL with credentials removed. Redacts by matched route first, then by the
 * decoded path, so encoded variants such as `/%6Dedia/<token>` are redacted too.
 */
export function logUrl(request: Pick<FastifyRequest, 'url'> & { routeOptions?: { url?: string } }): string {
  if (request.routeOptions?.url === routes.media.path) return '/media/[redacted]';
  const decoded = safeDecode(request.url);
  const redacted = redactPath(decoded);
  return redacted !== decoded ? redacted : request.url.split('?')[0]!;
}

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export async function buildApp(deps: Deps, opts: { logger?: FastifyServerOptions['logger'] } = {}) {
  const app = Fastify({
    logger: opts.logger ?? false,
    // Only a local reverse proxy (tunnel or gate) can sit in front of a loopback-bound API.
    trustProxy: deps.config.trustProxy,
  });
  await app.register(cors, {
    origin: (origin, cb) => cb(null, !origin || LOCAL_ORIGIN.test(origin)),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type', 'range'],
  });
  await app.register(multipart, { limits: { fileSize: MAX_EVIDENCE_BYTES, files: 1, fields: 4, fieldSize: 4096 } });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof DomainError) {
      return reply.code(HTTP_STATUS[err.code]).send({ code: err.code, message: err.message });
    }
    const e = err as { code?: string; statusCode?: number; message: string };
    // A raced unique constraint (e.g. duplicate segment) is a state conflict. Other constraint
    // failures (append-only ledger trigger, foreign keys) are invariant breaches: 500 + log.
    if (e.code === 'SQLITE_CONSTRAINT_UNIQUE' || e.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
      return reply.code(409).send({ code: 'CONFLICT_STATE', message: 'This conflicts with existing data.' });
    }
    if (e.code === 'FST_REQ_FILE_TOO_LARGE' || e.code === 'FST_ERR_CTP_BODY_TOO_LARGE' || e.statusCode === 413) {
      return reply.code(413).send({ code: 'PAYLOAD_TOO_LARGE', message: 'Request is too large.' });
    }
    if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
      return reply.code(400).send({ code: 'VALIDATION', message: 'The request could not be parsed.' });
    }
    req.log.error({ err: { message: e.message, code: e.code } }, 'unhandled error');
    return reply.code(500).send({ code: 'INTERNAL', message: 'Something went wrong.' });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ code: 'NOT_FOUND', message: 'Route not found.' }));

  /**
   * Resolves the caller. Firebase mode: a verified Firebase ID token (revocation checked)
   * whose UID maps to a non-deleted user; local password sessions are not accepted there.
   * Local mode: an opaque API session. Never both on one deployment (ADR 0005).
   */
  async function authenticate(req: FastifyRequest): Promise<{ user: UserRow | null; identity: VerifiedIdentity | null }> {
    const none = { user: null, identity: null };
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) return none;
    const token = header.slice(7).trim();
    if (!token) return none;
    if (deps.config.authMode === 'firebase') {
      if (!deps.identity) return none;
      let identity: VerifiedIdentity;
      try {
        identity = await deps.identity.verifyIdToken(token);
      } catch (e) {
        if (e instanceof IdentityError) return none;
        throw e; // provider outage etc.: a server error, not a silent sign-out
      }
      const found = deps.db
        .prepare(
          `SELECT u.*, i.valid_after_ms AS identity_valid_after_ms FROM identities i JOIN users u ON u.id = i.user_id
           WHERE i.provider = 'firebase' AND i.subject = ? AND u.status != 'deleted'`,
        )
        .get(identity.uid) as (UserRow & { identity_valid_after_ms: number }) | undefined;
      // Server-side revocation (logout): tokens from sign-ins at or before it are dead.
      if (found && identity.authTimeMs <= found.identity_valid_after_ms) return none;
      const user: UserRow | undefined = found ? (({ identity_valid_after_ms: _v, ...u }) => u)(found) : undefined;
      if (user && isRecoverableSignIn(identity)) {
        // Signed in with a verified email/Google identity: the wallet is no longer the only way in.
        deps.db.prepare(`UPDATE identities SET has_recovery = 1 WHERE provider = 'firebase' AND subject = ? AND has_recovery = 0`).run(identity.uid);
      }
      return { user: user ?? null, identity };
    }
    const row = deps.db
      .prepare(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ? AND u.status != 'deleted'`,
      )
      .get(sha256(token), deps.now()) as UserRow | undefined;
    return { user: row ?? null, identity: null };
  }

  for (const [name, def] of Object.entries(routes) as [RouteName, (typeof routes)[RouteName]][]) {
    const handler = handlers[name];
    app.route({
      method: def.method,
      url: def.path,
      handler: async (req, reply) => {
        let user: UserRow | null = null;
        let identity: VerifiedIdentity | null = null;
        if (def.auth === 'identity') {
          // In local mode no provider token can ever authenticate: 401, like any bad credential.
          if (deps.config.authMode !== 'firebase') throw fail('UNAUTHENTICATED', 'Managed sign-in is not enabled on this deployment.');
          ({ user, identity } = await authenticate(req));
          if (!identity) throw fail('UNAUTHENTICATED', 'Sign in to continue.');
        } else if (def.auth !== 'public') {
          ({ user, identity } = await authenticate(req));
          if (!user) throw fail('UNAUTHENTICATED', identity ? 'Finish creating your Pocket QA account first.' : 'Sign in to continue.');
          if (user.status === 'suspended' && !SUSPENDED_ALLOWED.has(name)) throw fail('FORBIDDEN_ROLE', 'This account is suspended.');
          if (def.auth !== 'user' && user.role !== def.auth) throw fail('FORBIDDEN_ROLE', `This action is for ${def.auth}s.`);
        }
        let body: unknown = undefined;
        if (def.body && def.body !== 'multipart') {
          const parsed = def.body.safeParse(req.body ?? {});
          if (!parsed.success) {
            const first = parsed.error.issues[0];
            throw fail('VALIDATION', first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'Invalid request body.');
          }
          body = parsed.data;
        }
        const ctx: Ctx = { deps, user, identity, params: req.params as Record<string, string>, body, req, reply };
        const result = await handler(ctx);
        if (def.response === 'binary') return reply;
        // Responses are parsed through the contract schema: unknown fields are stripped,
        // so internal columns can never leak, and drift fails loudly in tests.
        const out = def.response.safeParse(result);
        if (!out.success) {
          req.log.error({ route: name, issues: out.error.issues.slice(0, 3) }, 'response violated contract');
          throw fail('INTERNAL', 'Response did not match the API contract.');
        }
        return out.data;
      },
    });
  }

  return app;
}

/** Logger options for the real server; tests pass their own stream with these serializers. */
export function loggerOptions(stream?: NodeJS.WritableStream) {
  return {
    level: 'info',
    ...(stream ? { stream } : {}),
    serializers: {
      req: (req: FastifyRequest) => ({ method: req.method, url: logUrl(req) }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  };
}
