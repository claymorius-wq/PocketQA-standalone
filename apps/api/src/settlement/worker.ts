import { transitionPayout } from '@pocket-qa/domain';
import type { Deps } from '../context';
import { settlementLabel, verifyFunding } from '../escrow';
import type { EscrowRepo } from '../repo/escrow/types';
import { SettlementFailure, type SettlementProvider } from './types';

const RETRY_MS = 5 * 60_000;
const MAX_RETRY_MS = 3600_000;
/** After this many failed attempts a payment is escalated to the operator (it keeps retrying). */
export const ESCALATE_AFTER = 5;
const backoff = (attempt: number) => Math.min(MAX_RETRY_MS, RETRY_MS * 2 ** Math.max(0, attempt - 1));

/**
 * The durable settlement worker (run at startup and periodically, like the storage sweep):
 * 1. pending fundings are re-verified; unpaid requests past their expiry expire;
 * 2. pending payouts and refunds, and failed ones whose retry time came, are submitted. The
 *    attempt key is persisted BEFORE the provider call, so a crash re-sends the same key and the
 *    provider returns the same transfer (never a second one);
 * 3. submitted transfers are polled; only `finalized` settles them (once: unique postings), a
 *    network failure marks them failed for a later attempt, and `processing` waits;
 * 4. every touched study's books are reconciled; an imbalance is returned as an alert, as is a
 *    payment that has failed ESCALATE_AFTER times or more (it keeps retrying, with backoff);
 * 5. with a network provider (the Squads devnet pilot), every study vault's on-chain balance is
 *    compared with the books: unmatched deposits and shortfalls are alerts (`reconcileVaultOnChain`).
 * Data access goes through the escrow repository (sqlite or firestore). The server runs one pass at
 * a time (a guard in server.ts); overlapping runs from other callers
 * would still be safe, because every send is idempotent per persisted attempt key.
 * Unknown errors propagate: they leave the outcome unknown, and the next run resolves it.
 */
export async function runSettlement(deps: Pick<Deps, 'now' | 'settlement'> & { repo: Pick<Deps['repo'], 'escrow'> }): Promise<{ alerts: string[] }> {
  const { settlement: provider } = deps;
  if (!provider) return { alerts: [] };
  const repo = deps.repo.escrow;
  const now = deps.now();
  const touched = new Set<string>();
  const label = settlementLabel(provider);

  await repo.expireUnpaidFundings(now);
  for (const f of await repo.pendingFundings()) {
    await verifyFunding(repo, provider, f, f.signature!, now, 'system');
    touched.add(f.study_id);
  }

  for (const s of await repo.dueSettlements(now)) {
    touched.add(s.study_id);
    let key = s.attempt_key;
    if (s.status !== 'submitted') {
      // A new attempt: persist its key and the submitted state before sending anything.
      key = `${s.id}:${s.attempt + 1}`;
      transitionPayout(s.status, 'submit');
      await repo.beginAttempt(s.id, key);
    }
    try {
      const { signature } = await provider.submit({
        key: key!,
        settlementId: s.id,
        kind: s.kind,
        studyId: s.study_id,
        vault: provider.vaultFor(s.study_id),
        destination: s.destination,
        amountUnits: s.amount_units,
        cosigner: s.cosigner,
      });
      await repo.recordSubmitSignature(s.id, signature);
    } catch (e) {
      if (!(e instanceof SettlementFailure)) throw e;
      // The simulation can prove nothing was sent; a network provider reports the chain state it read.
      const reason = e.chainState ? `${e.message} ${e.chainState}` : e.message;
      const after = provider.mode === 'simulated' ? 'Nothing was sent; it will be retried.' : 'It will be retried.';
      await repo.recordAttemptFailure(s, reason, `${reason} ${after}`, now + backoff(s.attempt + (s.status === 'submitted' ? 0 : 1)), now);
    }
  }

  for (const s of await repo.submittedSettlements()) {
    touched.add(s.study_id);
    const st = await provider.status(s.signature!);
    if (st === 'finalized') {
      await repo.confirmSettlement(s, now, label);
    } else if (st === 'failed') {
      await repo.markSettlementFailed(s.id, 'The transfer failed on the settlement network; it will be retried.', now + backoff(s.attempt));
    }
    // 'processing' and 'not_found' wait: a transfer is never assumed lost or settled early.
  }

  const alerts: string[] = [];
  for (const f of await repo.escalations(ESCALATE_AFTER)) {
    alerts.push(`${f.kind} ${f.id}: ${ESCALATE_AFTER}+ failed attempts (${f.attempt} so far): ${f.failure_reason ?? 'unknown'}`);
  }
  for (const studyId of touched) {
    const books = await repo.studyBooks(studyId, now);
    if (!books.ok) alerts.push(`escrow books out of balance for study ${studyId}: ${JSON.stringify(books)}`);
  }
  if (provider.vaultBalance) {
    for (const studyId of await repo.escrowStudiesWithMultisig(provider.mode)) {
      const alert = await reconcileVaultOnChain(repo, provider, studyId, now);
      if (alert) alerts.push(alert);
    }
  }
  return { alerts };
}

/**
 * R7: a study vault's balance on the network against the books. On chain the vault holds what was
 * funded minus what was paid out and refunded; the platform fee stays in the vault (the pilot has
 * no fee sweep). More than that is an UNMATCHED deposit: alerted only, never credited to the study
 * or spendable by it (an operator returns it by hand). Less than that, beyond transfers that may
 * have landed but aren't confirmed in the books yet, is a shortfall.
 */
export async function reconcileVaultOnChain(repo: EscrowRepo, provider: SettlementProvider, studyId: string, now: number): Promise<string | null> {
  const onChain = await provider.vaultBalance!(studyId);
  if (onChain === null) return null;
  const books = await repo.studyBooks(studyId, now);
  const expected = books.fundedUnits - books.settledUnits - books.refundedUnits;
  const inFlight = await repo.inFlightUnits(studyId);
  // A funding still being verified explains extra units until it resolves.
  const openFunding = await repo.hasOpenFunding(studyId);
  if (onChain > expected && !openFunding) {
    return `unmatched deposit in the vault of study ${studyId}: ${onChain - expected} units on chain that no confirmed funding credited (not credited, not spendable; return it by hand)`;
  }
  if (onChain < expected - inFlight) return `vault shortfall for study ${studyId}: ${expected - inFlight - onChain} units fewer on chain than the books hold`;
  return null;
}
