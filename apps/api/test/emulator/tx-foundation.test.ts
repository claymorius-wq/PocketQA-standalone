import { beforeEach, describe, expect, it } from 'vitest';
import { claimGuard, runTx, runTxCtx } from '../../src/firestore/tx';
import { clearEmulator, emulatorFirestore } from './fs';

// The pattern every SQLite UNIQUE becomes (plan r2 §R2), and the rerun rule (§3).
const db = emulatorFirestore();
beforeEach(clearEmulator);

describe('uniqueness guards', () => {
  it('20 concurrent transactions claiming one guard: exactly one creates it, the rest see it', async () => {
    const ref = db.collection('ledgerRewards').doc('p1:reward');
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        runTx(db, async (tx) => {
          const g = await claimGuard(tx, ref, { by: `writer-${i}` });
          if (g.created) tx.set(db.collection('ledger').doc(`entry-${i}`), { participationId: 'p1', amount: 50 });
          return g.created;
        }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await db.collection('ledger').get()).size).toBe(1);
  });
});

describe('transaction callbacks can rerun', () => {
  it('a contended transaction reruns its callback, so side effects must happen after runTx returns', async () => {
    const ref = db.collection('studies').doc('s1');
    await ref.set({ slotsUsed: 0 });
    const attempts: number[] = [];
    let sideEffects = 0;
    await Promise.all(
      Array.from({ length: 10 }, () =>
        runTx(
          db,
          async (tx) => {
            const snap = await tx.get(ref);
            tx.update(ref, { slotsUsed: (snap.data()!.slotsUsed as number) + 1 });
          },
          { onAttempt: (n) => attempts.push(n) },
        ).then(() => {
          sideEffects += 1; // after commit: exactly once per logical operation
        }),
      ),
    );
    expect((await ref.get()).data()!.slotsUsed).toBe(10);
    expect(sideEffects).toBe(10);
    expect(Math.max(...attempts)).toBeGreaterThan(1); // reruns really happened under contention
  });
});

describe('TxCtx: composable transactions (reads pass through, writes buffered, no read-after-write)', () => {
  it('two domains compose in one transaction: both read first or interleaved, writes land together', async () => {
    await db.collection('accounts').doc('builder').set({ balance: 100 });
    await runTxCtx(db, async (t) => {
      // "domain A" reads and writes, then "domain B" reads a different doc and writes.
      const acc = await t.get(db.collection('accounts').doc('builder'));
      t.update(db.collection('accounts').doc('builder'), { balance: (acc.data()!.balance as number) - 50 });
      const g = await t.claimGuard(db.collection('ledgerRewards').doc('p1:reward'), { by: 'decide' });
      expect(g.created).toBe(true);
      t.set(db.collection('ledger').doc('e1'), { amount: -50 });
    });
    expect((await db.collection('accounts').doc('builder').get()).data()!.balance).toBe(50);
    expect((await db.collection('ledgerRewards').doc('p1:reward').get()).exists).toBe(true);
    expect((await db.collection('ledger').doc('e1').get()).exists).toBe(true);
  });

  it('reading a document after writing it in the same transaction throws (read-your-writes would be stale)', async () => {
    const ref = db.collection('accounts').doc('x');
    await expect(
      runTxCtx(db, async (t) => {
        t.set(ref, { balance: 1 });
        await t.get(ref);
      }),
    ).rejects.toThrow(/after writing/);
    expect((await ref.get()).exists).toBe(false);
  });

  it('20 concurrent composite transactions claiming one guard: one effect', async () => {
    await db.collection('accounts').doc('b').set({ balance: 1000 });
    const won = await Promise.all(
      Array.from({ length: 20 }, () =>
        runTxCtx(db, async (t) => {
          const acc = await t.get(db.collection('accounts').doc('b'));
          const g = await t.claimGuard(db.collection('ledgerRewards').doc('p9:reward'), {});
          if (!g.created) return false;
          t.update(db.collection('accounts').doc('b'), { balance: (acc.data()!.balance as number) - 50 });
          return true;
        }),
      ),
    );
    expect(won.filter(Boolean)).toHaveLength(1);
    expect((await db.collection('accounts').doc('b').get()).data()!.balance).toBe(950);
  });
});

describe('contention past every attempt is a clean, retryable conflict (pqa-be1 finding)', () => {
  it('20 concurrent increments of one doc: each either commits or fails with CONFLICT_STATE, and the count matches the commits', async () => {
    const ref = db.collection('contention').doc('hot');
    await ref.set({ n: 0 });
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        runTx(db, async (tx) => {
          const n = ((await tx.get(ref)).data()!.n as number) + 1;
          tx.update(ref, { n });
          return n;
        }),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    for (const r of results) if (r.status === 'rejected') expect(r.reason).toMatchObject({ code: 'CONFLICT_STATE' });
    expect((await ref.get()).data()!.n).toBe(ok);
    expect(ok).toBeGreaterThan(0);
  });
});
