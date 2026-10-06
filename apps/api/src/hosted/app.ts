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

/** Mutations after which settlement has work (a payout, a refund, a funding to verify). */
const SETTLE_AFTER = new Set(['approve', 'reject', 'adminDecide', 'resolveDispute', 'adminFraud', 'closeStudy', 'simulatedWalletPayment', 'submitFundingSignature']);
/** Mutations after which storage has work (a quarantine copy to clear, deletions queued). */
const SWEEP_AFTER = new Set(['completeUploadIntent', 'deleteMe']);

export type HostedDeps = Deps & { repo: Repos; cronSecret: string };

export function hostedConfig(env: NodeJS.ProcessEnv): { config: Config; cronSecret: string } {
  const config = loadConfig(env);
  if (config.dataBackend !== 'firestore' || !config.firebase || !config.r2) {
    throw new ConfigError('The hosted API runs only on Firestore, Firebase sign-in and private R2 (POCKETQA_DATA_BACKEND=firestore, POCKETQA_AUTH_MODE=firebase, POCKETQA_STORAGE=r2).');
  }
  if (config.features.settlement === 'squads_devnet') throw new ConfigError('The hosted API never runs the devnet pilot.');
  const cronSecret = env.CRON_SECRET ?? '';
  if (cronSecret.length < 32) throw new ConfigError('CRON_SECRET (server-only, at least 32 characters) is required for the hosted jobs.');
  return { config, cronSecret };
}

export function hostedDeps(env: NodeJS.ProcessEnv): HostedDeps {
  const { config, cronSecret } = hostedConfig(env);
  const repo = makeRepos({ kind: 'firestore', fs: openFirestore(env, config.firebase!.projectId) });
  return {
    db: null,
    repo,
    config,
    now: Date.now,
    rpc: httpDevnetRpc(config.rpcUrl),
    mediaDir: null,
    identity: firebaseIdentity(config.firebase!),
    store: r2Store(config.r2!),
    // Staging (R11): SIMULATED settlement over Firestore, labelled, never real money.
    settlement: config.features.settlement === 'simulated' ? new SimulatedSettlement(repo, Date.now) : null,
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

export async function buildHostedApp(deps: HostedDeps): Promise<FastifyInstance> {
  const app = await buildApp(deps, { logger: { level: 'info' }, setup: (a) => hostedSetup(a, deps) });
  return app;
}

function hostedSetup(app: FastifyInstance, deps: HostedDeps) {

  // Vercel Cron: GET with `Authorization: Bearer $CRON_SECRET`. Not in the public contract, so
  // the client route table never sees it. Anything else gets 404, so the route isn't advertised.
  app.get<{ Params: { job: string } }>('/jobs/:job', async (req, reply) => {
    const job = req.params.job;
    if ((job !== 'settle' && job !== 'sweep') || !secretMatches(req.headers.authorization, deps.cronSecret)) {
      return reply.code(404).send({ code: 'NOT_FOUND', message: 'Route not found.' });
    }
    return runJob(deps, job, { budgetMs: JOB_BUDGET_MS, leaseMs: JOB_LEASE_MS }, (a) => req.log.error({ alert: 'escrow' }, a));
  });

  // R5 (Hobby has a daily cron): a bounded slice runs BEFORE the response is sent, as Vercel may
  // freeze the function after it. A failure only logs: the mutation already committed, and the
  // next slice or the cron run picks the work up.
  app.addHook('onSend', async (req, reply, payload) => {
    const route = (req.routeOptions.config as { pqaRoute?: string } | undefined)?.pqaRoute;
    if (reply.statusCode >= 400 || !route) return payload;
    const job = deps.settlement && SETTLE_AFTER.has(route) ? 'settle' : SWEEP_AFTER.has(route) ? 'sweep' : null;
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
