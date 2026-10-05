import { ownStudy } from '../access';
import { me, type Ctx, type Handler } from '../context';
import { escrowOf, FUNDING_TTL_MS, studyQuote, verifyFunding, type FundingRow, type SettlementRow } from '../escrow';
import type { SimulatedSettlement } from '../settlement/simulated';
import { SettlementFailure } from '../settlement/types';
import { fail, newId, notFound } from '../util';
import { fundingView, payoutView } from '../views';

/** The provider, or the honest refusal when settlement is off on this deployment. */
function provider(ctx: Ctx) {
  if (!ctx.deps.settlement) throw fail('FEATURE_UNAVAILABLE', 'Wallet-funded studies aren’t available on this deployment.');
  return ctx.deps.settlement;
}

/** A funding request of the caller's own study, else 404. */
function ownFunding(ctx: Ctx): FundingRow {
  const f = ctx.deps.db.prepare('SELECT * FROM escrow_fundings WHERE id = ?').get(ctx.params.id!) as FundingRow | undefined;
  if (!f) throw notFound('Funding');
  ownStudy(ctx.deps.db, f.study_id, me(ctx)); // 404 for anyone but the study's builder
  return f;
}

const linkedWallet = (ctx: Ctx) =>
  (ctx.deps.db.prepare('SELECT address FROM wallet_links WHERE user_id = ?').get(me(ctx).id) as { address: string } | undefined)?.address ?? null;

export const escrowHandlers = {
  /**
   * The server fixes everything: the amount is the study's quote (reward pool plus disclosed
   * fee), the vault is the study's, the mint and network are the provider's. Nothing comes from
   * the client. An open request is reused rather than duplicated.
   */
  createEscrowFunding: async (ctx) => {
    const p = provider(ctx);
    const db = ctx.deps.db;
    const now = ctx.deps.now();
    let id = '';
    // The escrow must exist on the network before anyone can fund it (Squads pilot: the study's
    // multisig and vault; idempotent). Members are fixed here: the builder's linked wallet.
    if (p.prepareVault) {
      const s = ownStudy(db, ctx.params.id!, me(ctx));
      const wallet = linkedWallet(ctx);
      if (s.payment_mode === 'escrow' && s.status === 'draft' && wallet) {
        try {
          const acc = await p.prepareVault({ studyId: s.id, builderWallet: wallet });
          db.prepare('UPDATE study_escrows SET multisig = ?, vault_authority = ? WHERE study_id = ?').run(acc.multisig, acc.vaultAuthority, s.id);
        } catch (e) {
          if (e instanceof SettlementFailure) throw fail('FEATURE_UNAVAILABLE', e.message);
          throw e;
        }
      }
    }
    db.transaction(() => {
      const s = ownStudy(db, ctx.params.id!, me(ctx));
      const esc = escrowOf(db, s.id);
      if (s.payment_mode !== 'escrow' || !esc) throw fail('CONFLICT_STATE', 'This study is paid with test credits, not a wallet.');
      if (s.status !== 'draft') throw fail('CONFLICT_STATE', 'Fund a study before publishing it.');
      if (!linkedWallet(ctx)) throw fail('CONFLICT_STATE', 'Link the wallet you’ll fund this study from first.');
      if (db.prepare(`SELECT 1 FROM escrow_fundings WHERE study_id = ? AND status = 'confirmed'`).get(s.id)) throw fail('CONFLICT_STATE', 'This study is already funded.');
      const open = db.prepare(`SELECT id FROM escrow_fundings WHERE study_id = ? AND status IN ('awaiting_payment','pending') AND expires_at > ?`).get(s.id, now) as { id: string } | undefined;
      if (open) {
        id = open.id;
        return;
      }
      id = newId();
      db.prepare(`INSERT INTO escrow_fundings (id, study_id, amount_units, reference, status, created_at, expires_at) VALUES (?,?,?,?, 'awaiting_payment', ?, ?)`).run(
        id,
        s.id,
        studyQuote(s, esc).totalUnits,
        p.newReference(),
        now,
        now + FUNDING_TTL_MS,
      );
    })();
    return fundingView(db, db.prepare('SELECT * FROM escrow_fundings WHERE id = ?').get(id) as FundingRow);
  },

  getEscrowFunding: (ctx) => {
    provider(ctx);
    return fundingView(ctx.deps.db, ownFunding(ctx));
  },

  /**
   * SIMULATION ONLY: stands in for the builder's wallet app sending the exact requested amount
   * from their linked wallet. One simulated payment per request (a second press never pays
   * twice). A real provider has no such route: the wallet signs and sends on its own.
   */
  simulatedWalletPayment: (ctx) => {
    const sim = provider(ctx) as SimulatedSettlement;
    if (sim.mode !== 'simulated') throw fail('FEATURE_UNAVAILABLE', 'Only the simulator can stand in for a wallet.');
    const f = ownFunding(ctx);
    if (f.status !== 'awaiting_payment' || f.expires_at <= ctx.deps.now()) throw fail('CONFLICT_STATE', `This funding request is ${f.status === 'awaiting_payment' ? 'expired' : f.status.replace('_', ' ')}.`);
    const from = linkedWallet(ctx);
    if (!from) throw fail('CONFLICT_STATE', 'Link the wallet you’ll fund this study from first.');
    const done = ctx.deps.db.prepare(`SELECT signature FROM sim_chain_transfers WHERE reference = ? AND kind = 'funding'`).get(f.reference) as { signature: string } | undefined;
    const signature = done?.signature ?? sim.recordTransfer({ source: from, destination: escrowOf(ctx.deps.db, f.study_id)!.vault, amountUnits: f.amount_units, reference: f.reference }, 'funding');
    return { signature, settlement: 'simulated' as const };
  },

  submitFundingSignature: async (ctx) => {
    const p = provider(ctx);
    const f = ownFunding(ctx);
    if (f.status === 'confirmed') throw fail('CONFLICT_STATE', 'This study is already funded.');
    if (f.status !== 'awaiting_payment' && f.status !== 'pending') throw fail('CONFLICT_STATE', `This funding request is ${f.status}. Start a new one.`);
    if (ctx.deps.db.prepare('SELECT 1 FROM escrow_fundings WHERE signature = ? AND id != ?').get(ctx.body.signature, f.id)) {
      throw fail('CONFLICT_STATE', 'This transfer already funded another request.');
    }
    return fundingView(ctx.deps.db, await verifyFunding(ctx.deps.db, p, f, ctx.body.signature, ctx.deps.now(), me(ctx).id));
  },

  myPayouts: (ctx) => {
    const rows = ctx.deps.db.prepare(`SELECT * FROM settlements WHERE kind = 'payout' AND tester_id = ? ORDER BY created_at DESC`).all(me(ctx).id) as SettlementRow[];
    return { items: rows.map((r) => payoutView(ctx.deps.db, r)) };
  },

  /** Operations view: every payout with its state and last failure. Read-only. */
  adminPayouts: (ctx) => {
    const rows = ctx.deps.db.prepare(`SELECT * FROM settlements WHERE kind = 'payout' ORDER BY status = 'failed' DESC, created_at DESC`).all() as SettlementRow[];
    return { items: rows.map((r) => payoutView(ctx.deps.db, r)) };
  },
} satisfies Record<string, Handler>;
