import { isPublicHost } from '@pocket-qa/contracts';

/**
 * Exact-origin CORS for the evidence bucket (ledger S3). Browsers upload with a presigned PUT
 * that sends only `content-type` (content-length is set by the browser) and read no response
 * header, so that is all the rule allows: one https origin, PUT, `content-type`. Playback goes
 * through the API, so no GET rule. No wildcards.
 */
export type CorsRule = { AllowedOrigins: string[]; AllowedMethods: string[]; AllowedHeaders: string[]; MaxAgeSeconds: number };

export class CorsError extends Error {}

export function corsRules(origin: string): CorsRule[] {
  let u: URL;
  try {
    u = new URL(origin);
  } catch {
    throw new CorsError('The origin must be an exact https origin, e.g. https://pocketqa.optijara.ai.');
  }
  if (u.protocol !== 'https:' || u.origin !== origin || !isPublicHost(u.hostname) || origin.includes('*')) {
    throw new CorsError('The origin must be an exact https origin on a public host, with no path, port wildcard or trailing slash.');
  }
  return [{ AllowedOrigins: [origin], AllowedMethods: ['PUT'], AllowedHeaders: ['content-type'], MaxAgeSeconds: 3600 }];
}

const norm = (rules: readonly Partial<CorsRule>[]) =>
  JSON.stringify(
    rules.map((r) => ({
      o: [...(r.AllowedOrigins ?? [])].sort(),
      m: [...(r.AllowedMethods ?? [])].map((x) => x.toUpperCase()).sort(),
      h: [...(r.AllowedHeaders ?? [])].map((x) => x.toLowerCase()).sort(),
      a: r.MaxAgeSeconds ?? null,
    })),
  );

/**
 * `create` when the bucket has no CORS yet, `same` when it already has exactly these rules, and
 * `conflict` otherwise. A conflict is never overwritten by the tool: PutBucketCors replaces the
 * whole configuration, so someone else's rules would be lost.
 */
export function planCors(current: readonly Partial<CorsRule>[] | null, desired: readonly CorsRule[]): 'create' | 'same' | 'conflict' {
  if (!current || current.length === 0) return 'create';
  return norm(current) === norm(desired) ? 'same' : 'conflict';
}

/**
 * Add-only merge (parent authorization 2026-10-06: a second exact origin, keeping every existing
 * entry). The result is the current rules, unchanged and in order, followed by any desired rule
 * that isn't already there. Nothing is removed or edited, so it is safe for a whole-configuration
 * PutBucketCors. 'present' means nothing needs writing.
 */
export function mergeCors(current: readonly CorsRule[] | null, desired: readonly CorsRule[]): { plan: 'add' | 'present'; rules: CorsRule[] } {
  const existing = [...(current ?? [])];
  const have = new Set(existing.map((r) => norm([r])));
  const missing = desired.filter((r) => !have.has(norm([r])));
  return { plan: missing.length ? 'add' : 'present', rules: [...existing, ...missing] };
}

/** Readback check for an add: every previous rule is still there verbatim, and every desired rule is present. */
export function mergedHolds(before: readonly CorsRule[] | null, after: readonly CorsRule[] | null, desired: readonly CorsRule[]): boolean {
  const have = new Set((after ?? []).map((r) => norm([r])));
  return [...(before ?? []), ...desired].every((r) => have.has(norm([r])));
}
