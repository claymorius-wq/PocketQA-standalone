import { ownStudyOf } from '../access';
import { me, type Ctx, type Handler } from '../context';
import { FUNDING_TTL_MS, verifyFunding, type FundingRow } from '../escrow';
import type { SimulatedSettlement } from '../settlement/simulated';
import { isDevnetSettlement } from '../settlement/squads/devnetTypes';
import { escrowQuoteOf } from '../escrow';
import { SettlementFailure, SettlementPending } from '../settlement/types';
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

/**
 * CH-D1 (pqa-be2 E-25): the shared (Firestore) rate limiter on every devnet send route, per user and
 * route, checked FIRST: before any chain read or signature. Devnet only: other deployments keep
 * their behaviour.
 */
export const DEVNET_ROUTE_LIMIT = { windowMs: 60_000, max: 20 };
async function devnetLimit(ctx: Ctx, route: string) {
  if (!isDevnetSettlement(ctx.deps.settlement)) return;
  if (!(await ctx.deps.repo.core.rateLimitHit(`devnet:${route}:${me(ctx).id}`, DEVNET_ROUTE_LIMIT.windowMs, DEVNET_ROUTE_LIMIT.max, ctx.deps.now()))) {
    throw fail('RATE_LIMITED', 'Too many devnet requests. Try again in a minute.');
  }
}

/** The devnet provider (POCKETQA_ENV=devnet), else the honest refusal. Checked after ownership. */
function devnet(ctx: Ctx) {
  const p = ctx.deps.settlement;
  if (!isDevnetSettlement(p)) throw fail('FEATURE_UNAVAILABLE', 'Wallet-signed devnet transactions exist only on the devnet deployment.');
  return p;
}

/** A settlement of the caller's own study, else 404 (never 403: no existence leak). */
async function ownSettlement(ctx: Ctx) {
  const s = await ctx.deps.repo.escrow.settlementById(ctx.params.id!);
  if (!s) throw notFound('Settlement');
  try {
    await ownStudyOf(ctx.deps.repo, s.study_id, me(ctx));
  } catch {
    throw notFound('Settlement');
  }
  return s;
}

/** The builder's linked wallet: the multisig's builder member and the funding source. */
async function builderWallet(ctx: Ctx) {
  const w = await linkedWallet(ctx);
  if (!w) throw fail('CONFLICT_STATE', 'Link the wallet you fund and approve with first.');
  return w;
}

const linkedWallet = async (ctx: Ctx) => (await ctx.deps.repo.escrow.walletLinkOf(me(ctx).id))?.address ?? null;

export const escrowHandlers = {
  /**
   * The server fixes everything: the amount is the study's quote (reward pool plus disclosed
   * fee), the vault is the study's, the mint and network are the provider's. Nothing comes from
   * the client. An open request is reused rather than duplicated.
   */
  createEscrowFunding: async (ctx) => {
    await devnetLimit(ctx, 'createEscrowFunding');
    const p = provider(ctx);
    const repo = ctx.deps.repo.escrow;
    // The escrow must exist on the network before anyone can fund it (Squads pilot: the study's
    // multisig and vault; idempotent). Members are fixed here: the builder's linked wallet.
    if (p.prepareVault) {
      const s = await ownStudyOf(ctx.deps.repo, ctx.params.id!, me(ctx));
      const wallet = await linkedWallet(ctx);
      if (s.payment_mode === 'escrow' && s.status === 'draft' && wallet) {
        // Devnet (CH-D1): the test USDC this request brings in is reserved against the caps first.
        if (isDevnetSettlement(p)) await p.reserveFunding({ studyId: s.id, userId: me(ctx).id, amountUnits: await escrowQuoteOf(ctx.deps.repo, s) });
        try {
          const acc = await p.prepareVault({ studyId: s.id, builderWallet: wallet, userId: me(ctx).id });
          await repo.setEscrowAccounts(s.id, acc.multisig, acc.vaultAuthority);
        } catch (e) {
          // Devnet: the vault is created over several requests (one transaction each); the funding
          // transaction route continues it and answers VAULT_NOT_READY until it is ready.
          if (!(e instanceof SettlementPending)) {
            if (e instanceof SettlementFailure) throw fail('FEATURE_UNAVAILABLE', e.message);
            throw e;
          }
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
    await devnetLimit(ctx, 'submitFundingSignature');
    const p = provider(ctx);
    const f = await ownFunding(ctx);
    if (f.status === 'confirmed') throw fail('CONFLICT_STATE', 'This study is already funded.');
    if (f.status !== 'awaiting_payment' && f.status !== 'pending') throw fail('CONFLICT_STATE', `This funding request is ${f.status}. Start a new one.`);
    if (await ctx.deps.repo.escrow.fundingSignatureUsedElsewhere(ctx.body.signature, f.id)) {
      throw fail('CONFLICT_STATE', 'This transfer already funded another request.');
    }
    return fundingViewOf(ctx.deps.repo, await verifyFunding(ctx.deps.repo.escrow, p, f, ctx.body.signature, ctx.deps.now(), me(ctx).id));
  },

  /** CH-D3: the server builds the builder-signed funding transfer from its own state. */
  escrowFundingTransaction: async (ctx) => {
    await devnetLimit(ctx, 'escrowFundingTransaction');
    const f = await ownFunding(ctx);
    return devnet(ctx).fundingTransaction(f, await builderWallet(ctx));
  },

  /** The cosigner vote for one payment, bound to its Squads index and op id (CH-D3). */
  settlementApproval: async (ctx) => {
    await devnetLimit(ctx, 'settlementApproval');
    const s = await ownSettlement(ctx);
    return devnet(ctx).approval(s, await builderWallet(ctx));
  },

  /** The wallet broadcast the vote: the server checks it ON CHAIN before the platform signer completes the 2-of-3. */
  submitSettlementApproval: async (ctx) => {
    await devnetLimit(ctx, 'submitSettlementApproval');
    const s = await ownSettlement(ctx);
    return devnet(ctx).submitApproval(s, ctx.body, await builderWallet(ctx));
  },

  /** Admin, read-only: the devnet payment's plan, i.e. the arbiter CLI's inputs (dispute overturn). */
  adminDevnetSettlement: async (ctx) => {
    const p = devnet(ctx);
    const s = await ctx.deps.repo.escrow.settlementById(ctx.params.id!);
    if (!s) throw notFound('Settlement');
    return p.operatorPlan(s);
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
