import type { IncomingMessage, ServerResponse } from 'node:http';
import { hostedApp } from './app';

/**
 * Vercel Function entry (Build Output API, scripts/build-vercel.mjs). Every `/api/*` request is
 * routed here with its original path; the contract's paths have no `/api` prefix, so it is removed.
 */
export function stripApiPrefix(url: string): string {
  const out = url.replace(/^\/api(?=\/|\?|$)/, '');
  return out === '' || out.startsWith('?') ? `/${out}` : out;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await hostedApp();
  req.url = stripApiPrefix(req.url ?? '/');
  app.routing(req, res);
}
