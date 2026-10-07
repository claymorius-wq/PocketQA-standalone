import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { EscrowFunding, Study } from '@pocket-qa/contracts';
import { Wallet } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api, ApiError } from '../api/client';
import { useIntentKey } from '../api/intentKey';
import { formatUnits, PILOT_DISCLOSURE, settlementTag, tokenAmount } from '../lib/money';
import { Button, Card, Field, Notice, Text } from '../ui';
import { KeyValue, KeyValueList, SectionHeader } from '../ui/patterns';
import { ServerTxSign, VERIFY_VALUE } from '../wallet/ServerTxSign';

type EscrowPayment = Extract<Study['payment'], { mode: 'escrow' }>;

/**
 * A wallet-funded study's escrow (ADR 0007), on the builder's study screen, in place of the
 * test-credit budget: the quote, who can move the funds (the trust model in plain words), funding,
 * the books and the refund. Every line names the settlement: the SIMULATION (one press stands in
 * for the wallet; no funds move), or the Squads DEVNET PILOT (ADR 0007 §10), where the builder's
 * wallet sends devnet test USDC (no value) to the study vault itself and reports the signature.
 */
export function EscrowPanel({ study }: { study: Study & { payment: EscrowPayment } }) {
  const p = study.payment;
  const pilot = p.settlement === 'squads_devnet';
  const tag = settlementTag(p.settlement);
  const amount = (units: number) => tokenAmount(units, p.settlement);
  const qc = useQueryClient();
  const [funding, setFunding] = useState<EscrowFunding | null>(null);
  const [signature, setSignature] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['study', study.id] });
  // One press stands in for the wallet: request → simulated wallet transfer → verification.
  const intent = useIntentKey();
  const fund = useMutation({
    mutationFn: async () => {
      const f = await api('createEscrowFunding', { params: { id: study.id }, idempotencyKey: intent.keyFor(['fund', study.id]) });
      const paid = await api('simulatedWalletPayment', { params: { id: f.id } });
      return api('submitFundingSignature', { params: { id: f.id }, body: { signature: paid.signature } });
    },
    onSuccess: (f) => {
      intent.done();
      setFunding(f);
      void refresh();
    },
  });
  // Devnet pilot: the request fixes the amount, vault and reference; the wallet sends on its own.
  const request = useMutation({
    mutationFn: () => api('createEscrowFunding', { params: { id: study.id }, idempotencyKey: intent.keyFor(['request', study.id]) }),
    onSuccess: (f) => {
      intent.done();
      setFunding(f);
    },
  });
  const verify = useMutation({
    mutationFn: () => api('submitFundingSignature', { params: { id: funding!.id }, body: { signature: signature.trim() } }),
    onSuccess: (f) => {
      setFunding(f);
      void refresh();
    },
  });
  const check = useMutation({
    mutationFn: () => api('getEscrowFunding', { params: { id: funding!.id } }),
    onSuccess: (f) => {
      setFunding(f);
      void refresh();
    },
  });
  const b = p.balances;
  const fee = `${(p.quote.feeBps / 100).toLocaleString('en-US')}%`;
  return (
    <View testID="escrow-panel" style={styles.panel}>
      <SectionHeader title={`Wallet escrow · ${tag}`} />
      {pilot ? (
        <Notice tone="info" title="How the funds move" testID="escrow-trust">
          {`Funds are held in this study’s Squads vault on Solana devnet. A release needs two of three signers (you, Pocket QA and an arbiter): Pocket QA proposes exactly this reward to the tester’s saved wallet after you approve the work, and you co-sign; the arbiter co-signs only dispute decisions or when you can’t. Unused rewards and their fees return to the wallet you funded from when the study closes. ${PILOT_DISCLOSURE}`}
        </Notice>
      ) : (
        <Notice tone="info" title="How the funds move" testID="escrow-trust">
          Funds are held in this study’s escrow. Pocket QA can release a reward only to the tester’s saved wallet, for exactly this reward, after you approve the work or a dispute is decided. Unused rewards and their fees return to the wallet you funded from when the study closes. In this build the escrow, wallet and transfers are simulated: no funds move.
        </Notice>
      )}
      <Card k={0.8} style={styles.card}>
        <KeyValueList testID="escrow-quote">
          <KeyValue label="Reward per approved test" value={amount(p.quote.rewardUnits)} valueTestID="escrow-reward" />
          <KeyValue label={`Platform fee per approved test (${fee})`} value={amount(p.quote.perTestFeeUnits)} valueTestID="escrow-fee" />
          <KeyValue label={`Reward pool (${p.quote.slots} slots)`} value={amount(p.quote.rewardPoolUnits)} />
          <KeyValue label="Total to fund" value={amount(p.quote.totalUnits)} valueTestID="escrow-total" />
        </KeyValueList>
        <Text variant="small" tone="muted">
          {pilot ? 'Network fees: devnet SOL (no value), covered by the Pocket QA test key.' : 'Network fees: none in this simulation. On a real network they are charged separately in SOL.'}
        </Text>
      </Card>
      {!p.funded ? (
        <View style={styles.fund}>
          {funding && funding.status !== 'confirmed' ? (
            <Notice tone={funding.status === 'failed' || funding.status === 'expired' ? 'danger' : 'info'} title={`Funding ${funding.status.replace('_', ' ')} · ${tag}`} testID="escrow-funding-status">
              {funding.failureReason ?? (funding.status === 'pending' ? `Waiting for the ${pilot ? 'devnet' : 'simulated'} transfer to finalize.` : 'Send the exact amount from your wallet.')}
            </Notice>
          ) : null}
          {(fund.error ?? request.error ?? verify.error) ? (
            <Notice tone="danger" title="Couldn’t fund" testID="escrow-fund-error">
              {((fund.error ?? request.error ?? verify.error) as ApiError).message}
            </Notice>
          ) : null}
          {pilot && funding?.status === 'awaiting_payment' ? (
            <Card k={0.64} style={styles.card} testID="escrow-pilot-request">
              <KeyValueList>
                <KeyValue label="Send exactly" value={amount(funding.amountUnits)} valueTestID="escrow-pilot-amount" />
                <KeyValue label="To the study vault (token account)" value={funding.vault} valueTestID="escrow-pilot-vault" valueStyle={VERIFY_VALUE} />
                <KeyValue label="Reference (include it in the transfer)" value={funding.reference} valueTestID="escrow-pilot-reference" valueStyle={VERIFY_VALUE} />
              </KeyValueList>
              {/* The server builds this exact transfer; the wallet signs and sends it after the plan is shown. */}
              <ServerTxSign
                testID="escrow-wallet"
                settlement={p.settlement}
                expectedDestination={funding.vault}
                reviewLabel="Review the transfer to sign in your wallet"
                signLabel="Sign and send in your wallet"
                load={() => api('escrowFundingTransaction', { params: { id: funding.id } })}
                submit={(sig) => api('submitFundingSignature', { params: { id: funding.id }, body: { signature: sig } }).then((f) => setFunding(f))}
                onDone={() => void refresh()}
              />
              <Text variant="small" tone="muted">Or send it yourself from your linked wallet, on Solana devnet, as a TransferChecked of devnet test USDC, then paste the transaction signature.</Text>
              <Field label="Transaction signature" value={signature} onChangeText={setSignature} autoCapitalize="none" testID="escrow-pilot-signature" />
              <Button label="Verify transfer" icon={Wallet} onPress={() => verify.mutate()} loading={verify.isPending} testID="escrow-pilot-verify" />
            </Card>
          ) : null}
          {funding?.status === 'pending' ? (
            <Button label="Check again" variant="secondary" onPress={() => check.mutate()} loading={check.isPending} testID="escrow-check" />
          ) : pilot ? (
            funding?.status === 'awaiting_payment' ? null : (
              <Button label={`Fund ${formatUnits(p.quote.totalUnits)} devnet test USDC from wallet`} icon={Wallet} onPress={() => request.mutate()} loading={request.isPending} testID="escrow-fund" />
            )
          ) : (
            <Button label={`Fund ${formatUnits(p.quote.totalUnits)} from wallet (simulated)`} icon={Wallet} onPress={() => fund.mutate()} loading={fund.isPending} testID="escrow-fund" />
          )}
          <Text variant="small" tone="muted">Publishing needs a confirmed funding of the full total.</Text>
        </View>
      ) : (
        <Card k={0.64} style={styles.card}>
          <Text variant="bodySm" testID="escrow-funded">
            {pilot ? 'Funded on devnet' : 'Funded (simulated)'}
            {p.fundingWallet ? ` from ${short(p.fundingWallet)}` : ''}.
          </Text>
          {b ? (
            <KeyValueList testID="escrow-books">
              <KeyValue label="Available for new testers" value={amount(b.availableUnits)} valueTestID="escrow-available" />
              <KeyValue label="Held for testers in progress" value={amount(b.heldUnits)} valueTestID="escrow-held" />
              <KeyValue label="Approved, payment pending" value={amount(b.payableUnits)} valueTestID="escrow-payable" />
              <KeyValue label={`Settled to testers (${tag})`} value={amount(b.settledUnits)} valueTestID="escrow-settled" />
              <KeyValue label="Platform fees" value={amount(b.feesUnits)} />
              {b.sweptFeesUnits !== undefined ? <KeyValue label={`Fees sent to the platform (${tag})`} value={amount(b.sweptFeesUnits)} valueTestID="escrow-swept-fees" /> : null}
              <KeyValue label="Refund pending" value={amount(b.pendingRefundUnits)} />
              <KeyValue label={`Refunded (${tag})`} value={amount(b.refundedUnits)} valueTestID="escrow-refunded" />
            </KeyValueList>
          ) : null}
          {p.refund ? (
            <Text variant="small" tone="muted" testID="escrow-refund">
              {p.refund.status === 'confirmed'
                ? `Refunded ${amount(p.refund.amountUnits)} to the funding wallet · ${pilot ? 'finalized on devnet, no value' : 'simulation, no funds moved'}.`
                : `Refund of ${amount(p.refund.amountUnits)} to the funding wallet: ${p.refund.status} · ${tag}.`}
            </Text>
          ) : null}
          {pilot && p.refund?.status === 'awaiting_approval' ? (
            // Devnet pilot: the refund waits for the builder's vote (2 of 3) in their wallet.
            <ServerTxSign
              testID="escrow-refund-approval"
              settlement={p.settlement}
              expectedApproval={{ settlementId: p.refund.settlementId, kind: 'refund', amountUnits: p.refund.amountUnits, destination: p.fundingWallet }}
              reviewLabel="Review the refund vote to sign in your wallet"
              signLabel="Approve in your wallet"
              load={() => api('settlementApproval', { params: { id: p.refund!.settlementId } })}
              submit={(signature, plan) => api('submitSettlementApproval', { params: { id: plan.settlementId }, body: { signature, txIndex: plan.txIndex, opId: plan.opId } })}
              onDone={() => void refresh()}
            />
          ) : null}
          {p.feeSweep ? (
            <Text variant="small" tone="muted" testID="escrow-fee-sweep">
              {p.feeSweep.status === 'confirmed'
                ? `Platform fees of ${amount(p.feeSweep.amountUnits)} sent to the platform fee wallet · ${pilot ? 'finalized on devnet, no value' : 'simulation, no funds moved'}.`
                : `Platform fees of ${amount(p.feeSweep.amountUnits)} to the platform fee wallet: ${p.feeSweep.status.replace('_', ' ')} · ${tag}.`}
            </Text>
          ) : null}
          {pilot && p.feeSweep?.status === 'awaiting_approval' ? (
            // Devnet pilot: at close the earned fees leave the vault to the platform fee wallet, also
            // co-signed by the builder (be3 E-24). The app doesn't know the fee wallet: the recipient
            // is the plan's, checked against the vault transaction on devnet when it can be read.
            <ServerTxSign
              testID="escrow-fee-approval"
              settlement={p.settlement}
              expectedApproval={{ settlementId: p.feeSweep.settlementId, kind: 'fee', amountUnits: p.feeSweep.amountUnits, destination: null }}
              reviewLabel="Review the platform fee vote to sign in your wallet"
              signLabel="Approve in your wallet"
              load={() => api('settlementApproval', { params: { id: p.feeSweep!.settlementId } })}
              submit={(signature, plan) => api('submitSettlementApproval', { params: { id: plan.settlementId }, body: { signature, txIndex: plan.txIndex, opId: plan.opId } })}
              onDone={() => void refresh()}
            />
          ) : null}
        </Card>
      )}
    </View>
  );
}

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);

const styles = StyleSheet.create({
  panel: { gap: 12 },
  card: { padding: 16, gap: 10 },
  fund: { gap: 10 },
});
