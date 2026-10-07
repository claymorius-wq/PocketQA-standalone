import type { Firestore } from 'firebase-admin/firestore';
import type { DevnetChain, DevnetReceipt, VaultReceipt } from '../settlement/squads/devnetTypes';

/**
 * A READ-ONLY report of the devnet spend books against the chain (lead request after E-28: the
 * historical over-count from estimate-based true-ups). For every operation (each study vault, each
 * payment) it compares the lamports the books reserved with what the chain says the platform paid
 * for that operation's recorded transactions (by signature: fee + rent). It reads, never writes.
 * `fs` must be the devnet namespace (devnetFirestore).
 */
export type SpendLine = { opKey: string; reservedLamports: number; observedLamports: number; unreadable: number; released: boolean };
export type SpendReport = { lines: SpendLine[]; reservedTotal: number; observedTotal: number; gap: number; globalBooks: number; unreadableSignatures: number };

export async function spendReport(fs: Firestore, chain: Pick<DevnetChain, 'costOf'>): Promise<SpendReport> {
  const ops: { opKey: string; steps: Record<string, { signature: string; status: string } | undefined> }[] = [
    ...(await fs.collection('devnetVaults').get()).docs.map((d) => ({ opKey: `vault:${d.id}`, steps: (d.data() as VaultReceipt).steps })),
    ...(await fs.collection('squadsAttempts').get()).docs.map((d) => ({ opKey: `payment:${d.id}`, steps: (d.data() as DevnetReceipt).steps })),
  ];
  const lines: SpendLine[] = [];
  for (const op of ops) {
    const r = (await fs.collection('devnetSpendReservations').doc(op.opKey).get()).data() as { lamports: number; released: boolean } | undefined;
    let observed = 0;
    let unreadable = 0;
    for (const st of Object.values(op.steps)) {
      if (!st || (st.status !== 'finalized' && st.status !== 'failed' && st.status !== 'sent')) continue;
      const c = await chain.costOf(st.signature).catch(() => null);
      if (c) observed += c.lamports;
      else if (st.status !== 'sent') unreadable += 1; // a 'sent' step that never landed cost nothing
    }
    lines.push({ opKey: op.opKey, reservedLamports: r?.lamports ?? 0, observedLamports: observed, unreadable, released: r?.released ?? false });
  }
  const reservedTotal = lines.reduce((s, l) => s + l.reservedLamports, 0);
  const observedTotal = lines.reduce((s, l) => s + l.observedLamports, 0);
  const globalBooks = ((await fs.collection('devnetSpend').doc('global').get()).data()?.lamports as number | undefined) ?? 0;
  return { lines, reservedTotal, observedTotal, gap: reservedTotal - observedTotal, globalBooks, unreadableSignatures: lines.reduce((s, l) => s + l.unreadable, 0) };
}
