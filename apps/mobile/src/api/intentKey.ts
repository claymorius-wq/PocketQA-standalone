import { useRef } from 'react';
import { newIdempotencyKey } from './idempotencyKey';

/**
 * One Idempotency-Key per user intent (pqa-qa early r1 P2-H, plan R12). `keyFor(request)` returns
 * the same key while the request is unchanged, so a retry tap after a lost response replays the
 * first result instead of creating a second study, finding, top-up or funding. A changed request,
 * or `done()` after success, starts a new intent, so a deliberate second top-up still runs.
 */
export function useIntentKey() {
  const ref = useRef<{ sig: string; key: string } | null>(null);
  return {
    keyFor(request: unknown): string {
      const sig = JSON.stringify(request ?? null);
      if (!ref.current || ref.current.sig !== sig) ref.current = { sig, key: newIdempotencyKey() };
      return ref.current.key;
    },
    done() {
      ref.current = null;
    },
  };
}
