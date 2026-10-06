import type { DocumentReference, Firestore } from 'firebase-admin/firestore';
import { runTxCtx, type TxCtx, type TxHooks } from '../../firestore/tx';
import type { DevnetLimits, DevnetReceipt, DevnetStore, ReceiptKind, VaultReceipt } from '../../settlement/squads/devnetTypes';
import { DEVNET_OP_LEASE_MS } from '../../settlement/squads/devnetTypes';

/**
 * The devnet adapter's durable state on Firestore (pqa-be3-interfaces.md §3). Always built over the
 * devnet namespace (makeRepos namespace 'devnet'), so every path below lives under
 * pocketqaNamespaces/devnet. Each method is one transaction; leases fence every write and broadcast.
 *  squadsAttempts/{settlementId}        DevnetReceipt (a payment's receipt)
 *  devnetVaults/{studyId}               VaultReceipt (multisig + vault token account)
 *  squadsTx/{multisig}:{index}          guard: one payment per Squads index (R2 row 33)
 *  squadsIndex/{multisig}               { claimed }: the highest index claimed here
 *  devnetSpend/{global | user:uid}      { lamports, usdcUnits } running totals (CH-D1)
 *  devnetSpendReservations/{opKey}      { uid, lamports, usdcUnits, released } (once per operation)
 */
type Spend = { lamports: number; usdcUnits: number };
type Reservation = { uid: string; lamports: number; usdcUnits: number; released: boolean };
type Lease = { holder: string; fence: number; until: number } | null;

export function firestoreDevnetStore(fs: Firestore, hooks: TxHooks = {}): DevnetStore {
  const tx = <T>(fn: (t: TxCtx) => Promise<T>) => runTxCtx(fs, fn, hooks);
  const doc = (kind: ReceiptKind, id: string) => fs.collection(kind === 'payment' ? 'squadsAttempts' : 'devnetVaults').doc(id);
  const spendRef = (id: string) => fs.collection('devnetSpend').doc(id);
  const resvRef = (opKey: string) => fs.collection('devnetSpendReservations').doc(opKey);
  const zero: Spend = { lamports: 0, usdcUnits: 0 };

  /**
   * Reserves `add` for `uid` under `opKey` once, all or nothing: a cap reason (nothing written), or
   * null (reserved, or already reserved). Reads both totals in the caller's transaction, so N
   * concurrent reservations at the last unit of headroom serialise: exactly one fits.
   */
  async function reserveInTx(t: TxCtx, opKey: string, uid: string, add: Spend, limits: DevnetLimits): Promise<string | null> {
    if ((await t.get(resvRef(opKey))).exists) return null;
    const [g, u] = await t.getAll(spendRef('global'), spendRef(`user:${uid}`));
    const gs = (g!.data() as Spend | undefined) ?? zero;
    const us = (u!.data() as Spend | undefined) ?? zero;
    if (gs.lamports + add.lamports > limits.global.lamports || gs.usdcUnits + add.usdcUnits > limits.global.usdcUnits) return 'the global devnet spend cap';
    if (us.lamports + add.lamports > limits.perUser.lamports || us.usdcUnits + add.usdcUnits > limits.perUser.usdcUnits) return 'your devnet spend cap';
    t.create(resvRef(opKey), { uid, lamports: add.lamports, usdcUnits: add.usdcUnits, released: false } satisfies Reservation);
    t.set(spendRef('global'), { lamports: gs.lamports + add.lamports, usdcUnits: gs.usdcUnits + add.usdcUnits });
    t.set(spendRef(`user:${uid}`), { lamports: us.lamports + add.lamports, usdcUnits: us.usdcUnits + add.usdcUnits });
    return null;
  }

  /** A fenced read: the document if `fence` still holds its lease, else null. */
  async function fenced<T extends { lease: Lease }>(t: TxCtx, ref: DocumentReference, fence: number, nowMs: number): Promise<T | null> {
    const d = (await t.get(ref)).data() as T | undefined;
    return d && d.lease && d.lease.fence === fence && d.lease.until > nowMs ? d : null;
  }

  return {
    async receipt(id) {
      return ((await doc('payment', id).get()).data() as DevnetReceipt | undefined) ?? null;
    },
    async vault(studyId) {
      return ((await doc('vault', studyId).get()).data() as VaultReceipt | undefined) ?? null;
    },

    async claimPayment(draft, chainIndex, adoptIndex, limits, nowMs) {
      return tx(async (t) => {
        const existing = (await t.get(doc('payment', draft.settlement_id))).data() as DevnetReceipt | undefined;
        if (existing) return { receipt: existing };
        const counterRef = fs.collection('squadsIndex').doc(draft.multisig);
        const claimed = ((await t.get(counterRef)).data() as { claimed: number } | undefined)?.claimed ?? 0;
        const index = adoptIndex ?? Math.max(chainIndex, claimed) + 1;
        const guardRef = fs.collection('squadsTx').doc(`${draft.multisig}:${index}`);
        const guard = (await t.get(guardRef)).data() as { settlement_id: string } | undefined;
        if (guard && guard.settlement_id !== draft.settlement_id) throw new Error(`Squads index ${index} of this study already belongs to another payment.`);
        const cap = await reserveInTx(t, `payment:${draft.settlement_id}`, draft.uid, { lamports: draft.reserved_lamports, usdcUnits: 0 }, limits);
        if (cap) return { cap };
        const receipt: DevnetReceipt = { ...draft, tx_index: index, steps: {}, state: 'claimed', refusal: null, lease: null, created_at: nowMs, updated_at: nowMs };
        if (!guard) t.create(guardRef, { settlement_id: draft.settlement_id });
        t.set(counterRef, { claimed: Math.max(claimed, index) });
        t.create(doc('payment', draft.settlement_id), receipt);
        return { receipt };
      });
    },

    async claimVault(draft, limits, nowMs) {
      return tx(async (t) => {
        const existing = (await t.get(doc('vault', draft.study_id))).data() as VaultReceipt | undefined;
        if (existing) return { vault: existing };
        const cap = await reserveInTx(t, `vault:${draft.study_id}`, draft.uid, { lamports: draft.reserved_lamports, usdcUnits: 0 }, limits);
        if (cap) return { cap };
        const vault: VaultReceipt = { ...draft, steps: {}, state: 'claimed', refusal: null, lease: null, created_at: nowMs, updated_at: nowMs };
        t.create(doc('vault', draft.study_id), vault);
        return { vault };
      });
    },

    async acquire(kind, id, holder, nowMs) {
      return tx(async (t) => {
        const d = (await t.get(doc(kind, id))).data() as { lease: Lease } | undefined;
        if (!d || (d.lease && d.lease.until > nowMs)) return null;
        const fence = (d.lease?.fence ?? 0) + 1;
        t.update(doc(kind, id), { lease: { holder, fence, until: nowMs + DEVNET_OP_LEASE_MS }, updated_at: nowMs });
        return fence;
      });
    },

    async beforeBroadcast(kind, id, fence, step, rec, nowMs) {
      return tx(async (t) => {
        const d = await fenced<{ lease: Lease; steps: Record<string, unknown> }>(t, doc(kind, id), fence, nowMs);
        if (!d) return false;
        t.update(doc(kind, id), { steps: { ...d.steps, [step]: rec }, updated_at: nowMs });
        return true;
      });
    },

    async patch(kind, id, fence, p, nowMs) {
      return tx(async (t) => {
        const d = await fenced<{ lease: Lease; steps: Record<string, unknown> }>(t, doc(kind, id), fence, nowMs);
        if (!d) return false;
        t.update(doc(kind, id), {
          ...(p.steps ? { steps: { ...d.steps, ...p.steps } } : {}),
          ...(p.state ? { state: p.state } : {}),
          ...(p.refusal !== undefined ? { refusal: p.refusal } : {}),
          updated_at: nowMs,
        });
        return true;
      });
    },

    async release(kind, id, fence) {
      await tx(async (t) => {
        const d = (await t.get(doc(kind, id))).data() as { lease: Lease } | undefined;
        if (d?.lease?.fence === fence) t.update(doc(kind, id), { lease: null });
      });
    },

    async indexOwner(multisig, index) {
      return ((await fs.collection('squadsTx').doc(`${multisig}:${index}`).get()).data() as { settlement_id: string } | undefined)?.settlement_id ?? null;
    },

    async releaseIndex(id, fence, nowMs) {
      return tx(async (t) => {
        const r = await fenced<DevnetReceipt>(t, doc('payment', id), fence, nowMs);
        if (!r || r.tx_index === 0 || r.steps.vault_tx_create) return false;
        const guardRef = fs.collection('squadsTx').doc(`${r.multisig}:${r.tx_index}`);
        const guard = (await t.get(guardRef)).data() as { settlement_id: string } | undefined;
        if (guard?.settlement_id === id) t.delete(guardRef);
        t.update(doc('payment', id), { tx_index: 0, updated_at: nowMs });
        return true;
      });
    },

    async reclaimIndex(id, fence, index, nowMs) {
      return tx(async (t) => {
        const r = await fenced<DevnetReceipt>(t, doc('payment', id), fence, nowMs);
        if (!r || r.steps.vault_tx_create) return null;
        if (r.tx_index === index) return index;
        const newRef = fs.collection('squadsTx').doc(`${r.multisig}:${index}`);
        const oldRef = fs.collection('squadsTx').doc(`${r.multisig}:${r.tx_index}`);
        const counterRef = fs.collection('squadsIndex').doc(r.multisig);
        const [taken, old, counter] = await t.getAll(newRef, oldRef, counterRef);
        if (taken!.exists && (taken!.data() as { settlement_id: string }).settlement_id !== id) return null;
        if (!taken!.exists) t.create(newRef, { settlement_id: id });
        if (r.tx_index !== 0 && old!.exists && (old!.data() as { settlement_id: string }).settlement_id === id) t.delete(oldRef);
        t.set(counterRef, { claimed: Math.max(((counter!.data() as { claimed: number } | undefined)?.claimed ?? 0), index) });
        t.update(doc('payment', id), { tx_index: index, updated_at: nowMs });
        return index;
      });
    },

    async trueUp(opKey, actualLamports) {
      await tx(async (t) => {
        const r = (await t.get(resvRef(opKey))).data() as Reservation | undefined;
        if (!r || r.released) return;
        const [g, u] = await t.getAll(spendRef('global'), spendRef(`user:${r.uid}`));
        const delta = actualLamports - r.lamports;
        const gs = (g!.data() as Spend | undefined) ?? zero;
        const us = (u!.data() as Spend | undefined) ?? zero;
        t.set(spendRef('global'), { ...gs, lamports: gs.lamports + delta });
        t.set(spendRef(`user:${r.uid}`), { ...us, lamports: us.lamports + delta });
        t.update(resvRef(opKey), { lamports: actualLamports, released: true });
      });
    },

    async reserveUsdc(opKey, uid, units, limits) {
      return tx(async (t) => (await reserveInTx(t, opKey, uid, { lamports: 0, usdcUnits: units }, limits)) === null);
    },
  };
}
