import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ParsedTx } from '@pocket-qa/domain';
import type { Config } from './config';
import type { DB } from './db';
import type { Repos } from './repo';
import type { IdentityProvider, VerifiedIdentity } from './identity/types';
import type { SettlementProvider } from './settlement/types';
import type { EvidenceStore } from './storage/types';
import type { Clock } from './util';
import type { UserRow } from './views';

/** Devnet JSON-RPC surface the API needs; injected so tests never touch the network. */
export type DevnetRpc = {
  getGenesisHash(): Promise<string>;
  getTransaction(signature: string): Promise<ParsedTx | null>;
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
};

export type Deps = {
  /** SQLite (local server and tests); null on the hosted Firestore deployment. */
  db: DB | null;
  /** Intent-level data access (docs/plans/firebase-vercel-refactor.md §2); sqlite or firestore. */
  repo: Repos;
  config: Config;
  now: Clock;
  rpc: DevnetRpc;
  /** Local evidence directory; null when evidence lives in R2. */
  mediaDir: string | null;
  /** Managed identity provider; null in local auth mode. */
  identity: IdentityProvider | null;
  /** Evidence object store (local media directory or R2). */
  store: EvidenceStore;
  /** Escrow settlement (ADR 0007): the SIMULATED provider, or null when settlement is off. */
  settlement: SettlementProvider | null;
};

export type Ctx = {
  deps: Deps;
  user: UserRow | null;
  /** Verified managed identity for `identity` routes (and firebase-mode requests). */
  identity: VerifiedIdentity | null;
  params: Record<string, string>;
  // Already validated against the route's contract schema by the dispatcher.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  req: FastifyRequest;
  reply: FastifyReply;
  /**
   * An id for something this request creates (pqa-qa early r1 P2-F). Without an Idempotency-Key
   * it is fresh; with one it is derived from the key's scope (user, route, key) and `purpose`, so a
   * retry after a crash between commit and completion re-creates the SAME document, which the
   * repository then returns instead of a duplicate (study, finding, top-up, funding, audit row).
   */
  idemId: (purpose: string) => string;
};
export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

/** Narrowing helper for handlers on authenticated routes. */
export function me(ctx: Ctx): UserRow {
  if (!ctx.user) throw new Error('handler reached without a session');
  return ctx.user;
}
