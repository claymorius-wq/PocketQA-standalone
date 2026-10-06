import { FieldValue, type DocumentReference, type Firestore, type Transaction } from 'firebase-admin/firestore';

/**
 * Transaction helpers (docs/plans/firebase-vercel-refactor.md §2.2, §3).
 *
 * Firestore transactions are optimistic: the callback can run more than once. So a callback must
 * be PURE apart from its tx reads/writes: no R2, chain, network, clock-dependent ids or logging of
 * effects. Side effects run after `runTx` returns. `onAttempt` lets tests count reruns (and the
 * forced-retry test proves no side effect is duplicated).
 */
export type TxHooks = { onAttempt?: (attempt: number) => void };

export async function runTx<T>(db: Firestore, fn: (tx: Transaction) => Promise<T>, hooks: TxHooks = {}): Promise<T> {
  let attempt = 0;
  return db.runTransaction(async (tx) => {
    attempt += 1;
    hooks.onAttempt?.(attempt);
    return fn(tx);
  });
}

/** Result of claiming a uniqueness guard inside a transaction. */
export type Guard<T> = { created: true } | { created: false; existing: T };

/**
 * The single pattern replacing every SQLite UNIQUE (plan r2 §R2): read the guard document in the
 * transaction; if it exists, report it (callers return the existing result or a CONFLICT); if not,
 * `tx.create` it, which fails the whole commit if another transaction created it first, so the
 * loser retries and then sees `created: false`. Must be called before any write in the tx
 * (Firestore requires all reads before writes).
 */
export async function claimGuard<T extends Record<string, unknown>>(tx: Transaction, ref: DocumentReference, data: T): Promise<Guard<T>> {
  const snap = await tx.get(ref);
  if (snap.exists) return { created: false, existing: snap.data() as T };
  tx.create(ref, { ...data, createdAt: FieldValue.serverTimestamp() });
  return { created: true };
}
