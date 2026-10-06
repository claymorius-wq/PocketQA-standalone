import { beforeEach, describe, expect, it } from 'vitest';
import { claimGuard, runTx } from '../../src/firestore/tx';
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
