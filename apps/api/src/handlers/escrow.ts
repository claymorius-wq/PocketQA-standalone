import { ownStudyOf } from '../access';
import { me, type Ctx, type Handler } from '../context';
import { FUNDING_TTL_MS, verifyFunding, type FundingRow } from '../escrow';
import type { SimulatedSettlement } from '../settlement/simulated';
import { SettlementFailure } from '../settlement/types';
import { fail, notFound } from '../util';
import { fundingViewOf, payoutViewOf } from '../views';

/** The provider, or the honest refusal when settlement is off on this deployment. */
function provider(ctx: Ctx) {
  if (!ctx.deps.settlement) throw fail('FEATURE_UNAVAILABLE', 'Wallet-funded studies aren’t available on this deployment.');
  return ctx.deps.settlement;
}

/** A funding request of the caller's own study, else 404. */
async function ownFunding(ctx: Ctx): Promise<FundingRow> {
  const f = await ctx.deps.repo.escrow.fundingById(ctx.params.id!);
  if (!f) throw notFound('Funding');
  await ownStudyOf(ctx.deps.repo, f.study_id, me(ctx)); // 404 for anyone but the study's builder
  return f;
}

const linkedWallet = async (ctx: Ctx) => (await ctx.deps.repo.escrow.walletLinkOf(me(ctx).id))?.address ?? null;

export const escrowHandlers = {
  /**
   * The server fixes everything: the amount is the study's quote (reward pool plus disclosed
   * fee), the vault is the study's, the mint and network are the provider's. Nothing comes from
   * the client. An open request is reused rather than duplicated.
   */
  createEscrowFunding: async (ctx) => {
    const p = provider(ctx);
    const repo = ctx.deps.repo.escrow;
    // The escrow must exist on the network before anyone can fund it (Squads pilot: the study's
    // multisig and vault; idempotent). Members are fixed here: the builder's linked wallet.
    if (p.prepareVault) {
      const s = await ownStudyOf(ctx.deps.repo, ctx.params.id!, me(ctx));
      const wallet = await linkedWallet(ctx);
      if (s.payment_mode === 'escrow' && s.status === 'draft' && wallet) {
        try {
          const acc = await p.prepareVault({ studyId: s.id, builderWallet: wallet });
          await repo.setEscrowAccounts(s.id, acc.multisig, acc.vaultAuthority);
        } catch (e) {
          if (e instanceof SettlementFailure) throw fail('FEATURE_UNAVAILABLE', e.message);
          throw e;
        }
      }
    }
    // The reference is drawn before the transaction (no side effects or randomness inside it); it
    // is used only when a new request is created.
    const f = await repo.openFunding({ studyId: ctx.params.id!, user: me(ctx), nowMs: ctx.deps.now(), reference: p.newReference(), ttlMs: FUNDING_TTL_MS });
    return fundingViewOf(ctx.deps.repo, f);
  },

  getEscrowFunding: async (ctx) => {
    provider(ctx);
    return fundingViewOf(ctx.deps.repo, await ownFunding(ctx));
  },

  /**
   * SIMULATION ONLY: stands in for the builder's wallet app sending the exact requested amount
   * from their linked wallet. One simulated payment per request (a second press never pays
   * twice). A real provider has no such route: the wallet signs and sends on its own.
   */
  simulatedWalletPayment: async (ctx) => {
    const sim = provider(ctx) as SimulatedSettlement;
    if (sim.mode !== 'simulated') throw fail('FEATURE_UNAVAILABLE', 'Only the simulator can stand in for a wallet.');
    const f = await ownFunding(ctx);
    if (f.status !== 'awaiting_payment' || f.expires_at <= ctx.deps.now()) throw fail('CONFLICT_STATE', `This funding request is ${f.status === 'awaiting_payment' ? 'expired' : f.status.replace('_', ' ')}.`);
    const from = await linkedWallet(ctx);
    if (!from) throw fail('CONFLICT_STATE', 'Link the wallet you’ll fund this study from first.');
    const done = await sim.fundingSignatureFor(f.reference);
    const signature = done ?? (await sim.sendTransfer({ source: from, destination: (await ctx.deps.repo.escrow.escrowOf(f.study_id))!.vault, amountUnits: f.amount_units, reference: f.reference }, 'funding'));
    return { signature, settlement: 'simulated' as const };
  },

  submitFundingSignature: async (ctx) => {
    const p = provider(ctx);
    const f = await ownFunding(ctx);
    if (f.status === 'confirmed') throw fail('CONFLICT_STATE', 'This study is already funded.');
    if (f.status !== 'awaiting_payment' && f.status !== 'pending') throw fail('CONFLICT_STATE', `This funding request is ${f.status}. Start a new one.`);
    if (await ctx.deps.repo.escrow.fundingSignatureUsedElsewhere(ctx.body.signature, f.id)) {
      throw fail('CONFLICT_STATE', 'This transfer already funded another request.');
    }
    return fundingViewOf(ctx.deps.repo, await verifyFunding(ctx.deps.repo.escrow, p, f, ctx.body.signature, ctx.deps.now(), me(ctx).id));
  },

  myPayouts: async (ctx) => {
    const rows = await ctx.deps.repo.escrow.payoutsOfTester(me(ctx).id);
    return { items: await Promise.all(rows.map((r) => payoutViewOf(ctx.deps.repo, r))) };
  },

  /** Operations view: every payout with its state and last failure. Read-only. */
  adminPayouts: async (ctx) => {
    const rows = await ctx.deps.repo.escrow.allPayouts();
    return { items: await Promise.all(rows.map((r) => payoutViewOf(ctx.deps.repo, r))) };
  },
} satisfies Record<string, Handler>;
