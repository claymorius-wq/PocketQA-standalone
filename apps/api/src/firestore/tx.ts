import { FieldValue, type DocumentReference, type Firestore, type Query, type Transaction } from 'firebase-admin/firestore';

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

/**
 * A composable transaction context (the cross-domain convention, plan §3): reads go straight to
 * the Firestore transaction; writes are BUFFERED and applied in order when the callback returns.
 * So domains can each read and write in their own helpers (`...InTx(t, ...)`) and be composed into
 * one transaction without violating Firestore's reads-before-writes rule.
 *
 * Reading a document this transaction has already written THROWS: Firestore would return the
 * pre-transaction value, and code that expects to see its own write would be silently wrong.
 * Keep the value in a variable instead.
 */
export class TxCtx {
  private readonly writes: ((tx: Transaction) => void)[] = [];
  private readonly written = new Set<string>();
  constructor(readonly tx: Transaction) {}

  private assertNotWritten(path: string) {
    if (this.written.has(path)) throw new Error(`TxCtx: read of ${path} after writing it in the same transaction`);
  }
  async get(ref: DocumentReference) {
    this.assertNotWritten(ref.path);
    return this.tx.get(ref);
  }
  async getAll(...refs: DocumentReference[]) {
    for (const r of refs) this.assertNotWritten(r.path);
    return refs.length ? this.tx.getAll(...refs) : [];
  }
  /** A query read (results are checked against buffered writes too). */
  async query(q: Query) {
    const snap = await this.tx.get(q);
    for (const d of snap.docs) this.assertNotWritten(d.ref.path);
    return snap;
  }
  private buffer(ref: DocumentReference, w: (tx: Transaction) => void) {
    this.written.add(ref.path);
    this.writes.push(w);
  }
  create(ref: DocumentReference, data: Record<string, unknown>) {
    this.buffer(ref, (tx) => tx.create(ref, data));
  }
  set(ref: DocumentReference, data: Record<string, unknown>, opts?: { merge: boolean }) {
    this.buffer(ref, (tx) => (opts ? tx.set(ref, data, opts) : tx.set(ref, data)));
  }
  update(ref: DocumentReference, data: Record<string, unknown>) {
    this.buffer(ref, (tx) => tx.update(ref, data));
  }
  delete(ref: DocumentReference) {
    this.buffer(ref, (tx) => tx.delete(ref));
  }
  /** `claimGuard` (above) in this context: read the guard, buffer its creation if absent. */
  async claimGuard<T extends Record<string, unknown>>(ref: DocumentReference, data: T): Promise<Guard<T>> {
    const snap = await this.get(ref);
    if (snap.exists) return { created: false, existing: snap.data() as T };
    this.create(ref, { ...data, createdAt: FieldValue.serverTimestamp() });
    return { created: true };
  }
  /** Applies the buffered writes (called by runTxCtx). */
  flush() {
    for (const w of this.writes) w(this.tx);
  }
}

/** `runTx` with a TxCtx: a fresh context per attempt, buffered writes flushed at the end. */
export async function runTxCtx<T>(db: Firestore, fn: (t: TxCtx) => Promise<T>, hooks: TxHooks = {}): Promise<T> {
  return runTx(
    db,
    async (tx) => {
      const t = new TxCtx(tx);
      const out = await fn(t);
      t.flush();
      return out;
    },
    hooks,
  );
}
