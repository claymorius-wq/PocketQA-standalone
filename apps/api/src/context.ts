import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ParsedTx } from '@pocket-qa/domain';
import type { Config } from './config';
import type { DB } from './db';
import type { Clock } from './util';
import type { UserRow } from './views';

/** Devnet JSON-RPC surface the API needs; injected so tests never touch the network. */
export type DevnetRpc = {
  getGenesisHash(): Promise<string>;
  getTransaction(signature: string): Promise<ParsedTx | null>;
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
};

export type Deps = { db: DB; config: Config; now: Clock; rpc: DevnetRpc; mediaDir: string };

export type Ctx = {
  deps: Deps;
  user: UserRow | null;
  params: Record<string, string>;
  // Already validated against the route's contract schema by the dispatcher.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  req: FastifyRequest;
  reply: FastifyReply;
};
export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

/** Narrowing helper for handlers on authenticated routes. */
export function me(ctx: Ctx): UserRow {
  if (!ctx.user) throw new Error('handler reached without a session');
  return ctx.user;
}
