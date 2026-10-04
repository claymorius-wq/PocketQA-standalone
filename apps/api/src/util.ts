import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { ErrorCode } from '@pocket-qa/contracts';
import { DomainError } from '@pocket-qa/domain';

export const HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN_ROLE: 403,
  NOT_FOUND: 404,
  CONFLICT_STATE: 409,
  NONCE_INVALID: 400,
  BUDGET_INSUFFICIENT: 409,
  CHAIN_UNAVAILABLE: 503,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  EMAIL_UNVERIFIED: 403,
  PROVIDER_UNSUPPORTED: 403,
  FEATURE_UNAVAILABLE: 403,
  INTERNAL: 500,
};

export const fail = (code: ErrorCode, message: string) => new DomainError(code, message);
/** Used for every "not yours" case as well as "doesn't exist", so existence never leaks. */
export const notFound = (what = 'Resource') => fail('NOT_FOUND', `${what} not found.`);

export const newId = () => randomUUID();
export const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** 256-bit opaque token for sessions and playback; only its SHA-256 is stored. */
export const newToken = () => randomBytes(32).toString('base64url');

const NONCE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
export function newNonce(length = 24): string {
  const bytes = randomBytes(length);
  let out = '';
  for (const b of bytes) out += NONCE_ALPHABET[b % NONCE_ALPHABET.length];
  return out;
}

export const hashPassword = (password: string) => hash(password);
export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  if (!stored) return false;
  try {
    return await verify(stored, password);
  } catch {
    return false;
  }
}

export type Clock = () => number;
export const iso = (ms: number) => new Date(ms).toISOString();
