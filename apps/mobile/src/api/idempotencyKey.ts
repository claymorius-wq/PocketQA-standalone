import { randomUUID } from 'expo-crypto';

/** A fresh Idempotency-Key (plan R10/R12): 32 hex characters, within the API's 8–128 [A-Za-z0-9_-]. */
export function newIdempotencyKey(): string {
  return randomUUID().replace(/-/g, '');
}
