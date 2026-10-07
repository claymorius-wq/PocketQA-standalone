import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../app';
import { ConfigError, loadConfig, type Config } from '../config';
import type { Deps } from '../context';
import { openFirestore } from '../firestore/admin';
import { firebaseIdentity } from '../identity/firebase';
import { makeRepos, type Repos } from '../repo';
import { httpDevnetRpc } from '../rpc';
import { SimulatedSettlement } from '../settlement/simulated';
import { runSettlement } from '../settlement/worker';
import { r2Store } from '../storage/r2';
import type { EvidenceStore } from '../storage/types';
import type { Firestore } from 'firebase-admin/firestore';
import type { IdentityProvider } from '../identity/types';
import { devnetSettlement, DevnetSquadsSettlement } from '../settlement/squads/devnet';
import { assertPlatformSigner, loadPlatformSigner } from '../settlement/squads/devnetSigner';
import type { DevnetChain } from '../settlement/squads/devnetTypes';
import { RpcDevnetChain } from '../settlement/squads/rpcDevnetChain';
import { sweepStorage } from '../storage/sweep';

/**
 * The hosted API (docs/plans/firebase-vercel-refactor.md §1, R5, R11): the same Fastify app and
 * handlers as the local server, over Firestore, Firebase sign-in and private R2. There is no SQLite,
 * no local media and no background timers: work that the local server does on intervals runs from
 * Vercel Cron (`/jobs/:job`) or, for settlement, as a small bounded slice after a relevant mutation.
 */

/** The function's maxDuration (scripts/build-vercel.mjs writes it; test/hosted.test.ts checks the lease against it). */
export const MAX_DURATION_S = 60;
/** A cron run stops starting items well before maxDuration; its lease outlives the function. */
const JOB_BUDGET_MS = 45_000;
const JOB_LEASE_MS = (MAX_DURATION_S + 30) * 1000;
/** R5 inline slice: at most this many items or this long, before the response is sent. */
const LAZY_ITEMS = 10;
const LAZY_BUDGET_MS = 300;
const LAZY_LEASE_MS = 10_000;
/**
 * A cron run that finds the lease held (usually by an inline slice, which holds it for well under a
 * second) retries for this long before giving up, so a slice running at cron time doesn't make the
 * day's only run skip (pqa-qa r4 P3). Well inside the job budget.
 */
const CRON_LEASE_WAIT_MS = 12_000;
const CRON_LEASE_RETRY_MS = 500;

/** Mutations after which settlement has work (a payout, a refund, a funding to verify). */
const SETTLE_AFTER = new Set(['approve', 'reject', 'adminDecide', 'resolveDispute', 'adminFraud', 'closeStudy', 'simulatedWalletPayment', 'submitFundingSignature', 'submitSettlementApproval']);
/** Mutations after which storage has work (a quarantine copy to clear, deletions queued). */
const SWEEP_AFTER = new Set(['completeUploadIntent', 'deleteMe']);
/** Devnet: inline settle slices per minute across all users (a global bucket, CH-D1). */
const DEVNET_SLICE_LIMIT = 60;

export type HostedDeps = Deps & { repo: Repos; cronSecret: string };

export function hostedConfig(env: NodeJS.ProcessEnv): { config: Config; cronSecret: string } {
  const config = loadConfig(env);
  if (config.dataBackend !== 'firestore' || !config.firebase || !config.r2) {
    throw new ConfigError('The hosted API runs only on Firestore, Firebase sign-in and private R2 (POCKETQA_DATA_BACKEND=firestore, POCKETQA_AUTH_MODE=firebase, POCKETQA_STORAGE=r2).');
  }
  // The pilot (server-held keys for every role) never runs hosted; POCKETQA_ENV=devnet is a different
  // provider (platform signer only, cosigned by the builder's own wallet) with its own guards.
  if (config.features.settlement === 'squads_devnet' && !config.devnet) throw new ConfigError('The hosted API never runs the devnet pilot.');
  const cronSecret = env.CRON_SECRET ?? '';
  if (cronSecret.length < 32) throw new ConfigError('CRON_SECRET (server-only, at least 32 characters) is required for the hosted jobs.');
  return { config, cronSecret };
}

/**
 * Where the hosted API's connections go. Production (vercel.ts) always uses `productionConnectors`.
 * TESTS may pass their own (the Firestore and Auth emulators, a fake S3, a fake devnet chain, a
 * clock): the env is still loaded and validated by loadConfig exactly as in production, so no runtime
 * refusal is weakened (POCKETQA_ENV=devnet still refuses demo- projects and emulator variables in the
 * env); only the connections are redirected. A static test checks that src never passes connectors.
 */
export type HostedConnectors = {
  firestore(config: Config, env: NodeJS.ProcessEnv): Firestore;
  identity(config: Config): IdentityProvider;
  r2(config: Config): NonNullable<Config['r2']>;
  /** POCKETQA_ENV=devnet only: the chain behind the platform signer. */
  devnetChain(config: Config, env: NodeJS.ProcessEnv): DevnetChain;
  now: () => number;
};

export const productionConnectors: HostedConnectors = {
  firestore: (config, env) => openFirestore(env, config.firebase!.projectId),
  identity: (config) => firebaseIdentity(config.firebase!),
  r2: (config) => config.r2!,
  devnetChain: (config, env) => {
    // The ONE server key: loaded, then checked against its pin and every other role (P2-DA1); the
    // chain signs with exactly this key (its roles.platform is this key's public key).
    const signer = loadPlatformSigner(env);
    assertPlatformSigner(signer, config.devnet!);
    return RpcDevnetChain.connect(config.rpcUrl, signer, config.devnet!.arbiter);
  },
  now: Date.now,
};

/**
 * The data and evidence backends of the hosted API. POCKETQA_ENV=devnet (CH-D2) keeps its data in the
 * Firestore devnet namespace and its R2 objects under devnet/, never in production's collections or
 * keys; the deployment refuses to start unless both are in place (pqa-qa P1-NS1).
 */
export function hostedBackends(config: Config, env: NodeJS.ProcessEnv, connect: HostedConnectors = productionConnectors): { repo: Repos; store: EvidenceStore } {
  const devnet = !!config.devnet;
  const repo = makeRepos({ kind: 'firestore', fs: connect.firestore(config, env), ...(devnet ? { namespace: 'devnet' as const } : {}) });
  const store = r2Store(connect.r2(config), devnet ? { keyPrefix: 'devnet/' } : {});
  if (devnet && (repo.namespace !== 'devnet' || store.keyPrefix !== 'devnet/')) {
    throw new ConfigError('POCKETQA_ENV=devnet must run on the Firestore devnet namespace and the devnet/ R2 prefix; refusing to start.');
  }
  return { repo, store };
}

export function hostedDeps(env: NodeJS.ProcessEnv, connect: HostedConnectors = productionConnectors): HostedDeps {
  const { config, cronSecret } = hostedConfig(env);
  const { repo, store } = hostedBackends(config, env, connect);
  const settlement = config.devnet
    ? devnetSettlement({ repo, chain: connect.devnetChain(config, env), now: connect.now, limits: config.devnet.limits, roles: config.devnet, allowedEmails: config.devnet.allowedEmails })
    : config.features.settlement === 'simulated'
      ? new SimulatedSettlement(repo, connect.now)
      : null;
  return {
    db: null,
    repo,
    config,
    now: connect.now,
    rpc: httpDevnetRpc(config.rpcUrl),
    mediaDir: null,
    identity: connect.identity(config),
    store,
    // Staging (R11): SIMULATED settlement over Firestore, labelled, never real money. Devnet: the
    // Squads devnet adapter (platform signer only, cosigned by the builder's wallet).
    settlement,
    cronSecret,
  };
}

function secretMatches(header: string | undefined, secret: string): boolean {
  const given = Buffer.from(header ?? '');
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
}

type JobResult = { job: string; ran: boolean; complete: boolean; alerts: number };

/**
 * One job run under its lease: a second concurrent run finds the lease held and does nothing, and
 * both jobs check the fence and the budget before every item, so a holder whose lease was taken
 * over stops. Every item is idempotent, so a slice cut short resumes on the next run.
 */
export async function runJob(deps: HostedDeps, job: 'settle' | 'sweep', budget: { maxItems?: number; budgetMs: number; leaseMs: number }, log: (alert: string) => void): Promise<JobResult> {
  const start = deps.now();
  const fence = await deps.repo.core.acquireLease(job, randomUUID(), budget.leaseMs, start);
  if (fence === null) return { job, ran: false, complete: false, alerts: 0 };
  try {
    const slice = { lease: { job, fence }, deadlineMs: start + budget.budgetMs, ...(budget.maxItems !== undefined ? { maxItems: budget.maxItems } : {}) };
    if (job === 'sweep') {
      const { complete } = await sweepStorage({ repo: deps.repo, store: deps.store, now: deps.now }, slice);
      return { job, ran: true, complete, alerts: 0 };
    }
    const { alerts, complete } = await runSettlement({ repo: deps.repo, now: deps.now, settlement: deps.settlement }, slice);
    for (const a of alerts) log(a);
    return { job, ran: true, complete, alerts: alerts.length };
  } finally {
    await deps.repo.core.releaseLease(job, fence).catch(() => undefined);
  }
}

/** `logStream`: where the app logs (tests capture the startup lines); default stdout. */
export type HostedOptions = { cronLeaseWaitMs?: number; logStream?: NodeJS.WritableStream };

export async function buildHostedApp(deps: HostedDeps, opts: HostedOptions = {}): Promise<FastifyInstance> {
  // Devnet: the pins (genesis, mint, programs) and the platform key are proven on chain before serving.
  if (deps.settlement instanceof DevnetSquadsSettlement) await deps.settlement.startupCheck();
  const app = await buildApp(deps, { logger: { level: 'info', ...(opts.logStream ? { stream: opts.logStream } : {}) }, setup: (a) => hostedSetup(a, deps, opts.cronLeaseWaitMs ?? CRON_LEASE_WAIT_MS) });
  // The effective devnet spend caps, as numbers (not secrets): cumulative over the namespace's lifetime.
  // QA P3-CAP1: with the current cumulative spend (the namespace's global totals), so headroom is visible.
  if (deps.config.devnet) {
    const devnetSpent = await deps.repo.escrow.devnet!.spendOf('global');
    app.log.info({ devnetSpendCaps: deps.config.devnet.limits, devnetSpent }, 'devnet spend caps and current spend (cumulative; lamports = fees + rent, test-USDC base units)');
  }
  return app;
}

function hostedSetup(app: FastifyInstance, deps: HostedDeps, cronLeaseWaitMs: number) {

  // Vercel Cron: GET with `Authorization: Bearer $CRON_SECRET`. Not in the public contract, so
  // the client route table never sees it. Anything else gets 404, so the route isn't advertised.
  app.get<{ Params: { job: string } }>('/jobs/:job', async (req, reply) => {
    const job = req.params.job;
    if ((job !== 'settle' && job !== 'sweep') || !secretMatches(req.headers.authorization, deps.cronSecret)) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Route not found.' });
    }
    const giveUpAt = Date.now() + cronLeaseWaitMs;
    for (;;) {
      const result = await runJob(deps, job, { budgetMs: JOB_BUDGET_MS, leaseMs: JOB_LEASE_MS }, (a) => req.log.error({ alert: 'escrow' }, a));
      if (result.ran || Date.now() >= giveUpAt) return result;
      await new Promise((r) => setTimeout(r, CRON_LEASE_RETRY_MS));
    }
  });

  // R5 (Hobby has a daily cron): a bounded slice runs BEFORE the response is sent, as Vercel may
  // freeze the function after it. A failure only logs: the mutation already committed, and the
  // next slice or the cron run picks the work up.
  app.addHook('onSend', async (req, reply, payload) => {
    const route = (req.routeOptions.config as { pqaRoute?: string } | undefined)?.pqaRoute;
    if (reply.statusCode >= 400 || !route) return payload;
    let job: 'settle' | 'sweep' | null = deps.settlement && SETTLE_AFTER.has(route) ? 'settle' : SWEEP_AFTER.has(route) ? 'sweep' : null;
    // Devnet (CH-D1): the inline settle slices that can sign share one global bucket; when it is
    // full the slice is skipped (the next one or the cron run continues the work).
    if (job === 'settle' && deps.settlement instanceof DevnetSquadsSettlement && !(await deps.repo.core.rateLimitHit('devnet:settle-slice', 60_000, DEVNET_SLICE_LIMIT, deps.now()))) job = null;
    if (job) {
      await runJob(deps, job, { maxItems: LAZY_ITEMS, budgetMs: LAZY_BUDGET_MS, leaseMs: LAZY_LEASE_MS }, (a) => req.log.error({ alert: 'escrow' }, a)).catch(() =>
        req.log.warn({ job }, 'inline slice failed; the next run resumes it'),
      );
    }
    return payload;
  });
}

let cached: Promise<FastifyInstance> | null = null;
/** One app per function instance, built on first request; a failed build is retried next time. */
export function hostedApp(env: NodeJS.ProcessEnv = process.env): Promise<FastifyInstance> {
  cached ??= (async () => {
    const app = await buildHostedApp(hostedDeps(env));
    await app.ready();
    return app;
  })().catch((e: unknown) => {
    cached = null;
    throw e;
  });
  return cached;
}
