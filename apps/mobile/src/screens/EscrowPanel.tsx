import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { EscrowFunding, Study } from '@pocket-qa/contracts';
import { Wallet } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api, ApiError } from '../api/client';
import { formatUnits, tokenAmount } from '../lib/money';
import { Button, Card, Notice, Text } from '../ui';
import { KeyValue, KeyValueList, SectionHeader } from '../ui/patterns';

type EscrowPayment = Extract<Study['payment'], { mode: 'escrow' }>;

/**
 * A wallet-funded study's escrow (ADR 0007), on the builder's study screen, in place of the
 * test-credit budget: the quote, who can move the funds (the trust model in plain words), funding,
 * the books and the refund. Settlement is SIMULATED in this build, and every line says so.
 */
export function EscrowPanel({ study }: { study: Study & { payment: EscrowPayment } }) {
  const p = study.payment;
  const qc = useQueryClient();
  const [funding, setFunding] = useState<EscrowFunding | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['study', study.id] });
  // One press stands in for the wallet: request → simulated wallet transfer → verification.
  const fund = useMutation({
    mutationFn: async () => {
      const f = await api('createEscrowFunding', { params: { id: study.id } });
      const paid = await api('simulatedWalletPayment', { params: { id: f.id } });
      return api('submitFundingSignature', { params: { id: f.id }, body: { signature: paid.signature } });
    },
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
      <SectionHeader title="Wallet escrow · simulation" />
      <Notice tone="info" title="How the funds move" testID="escrow-trust">
        Funds are held in this study’s escrow. Pocket QA can release a reward only to the tester’s saved wallet, for exactly this reward, after you approve the work or a dispute is decided. Unused rewards and their fees return to the wallet you funded from when the study closes. In this build the escrow, wallet and transfers are simulated: no funds move.
      </Notice>
      <Card k={0.8} style={styles.card}>
        <KeyValueList testID="escrow-quote">
          <KeyValue label="Reward per approved test" value={tokenAmount(p.quote.rewardUnits)} valueTestID="escrow-reward" />
          <KeyValue label={`Platform fee per approved test (${fee})`} value={tokenAmount(p.quote.perTestFeeUnits)} valueTestID="escrow-fee" />
          <KeyValue label={`Reward pool (${p.quote.slots} slots)`} value={tokenAmount(p.quote.rewardPoolUnits)} />
          <KeyValue label="Total to fund" value={tokenAmount(p.quote.totalUnits)} valueTestID="escrow-total" />
        </KeyValueList>
        <Text variant="small" tone="muted">Network fees: none in this simulation. On a real network they are charged separately in SOL.</Text>
      </Card>
      {!p.funded ? (
        <View style={styles.fund}>
          {funding && funding.status !== 'confirmed' ? (
            <Notice tone={funding.status === 'failed' || funding.status === 'expired' ? 'danger' : 'info'} title={`Funding ${funding.status.replace('_', ' ')} · simulation`} testID="escrow-funding-status">
              {funding.failureReason ?? (funding.status === 'pending' ? 'Waiting for the simulated transfer to finalize.' : 'Send the exact amount from your wallet.')}
            </Notice>
          ) : null}
          {fund.error ? (
            <Notice tone="danger" title="Couldn’t fund" testID="escrow-fund-error">
              {(fund.error as ApiError).message}
            </Notice>
          ) : null}
          {funding?.status === 'pending' ? (
            <Button label="Check again" variant="secondary" onPress={() => check.mutate()} loading={check.isPending} testID="escrow-check" />
          ) : (
            <Button label={`Fund ${formatUnits(p.quote.totalUnits)} from wallet (simulated)`} icon={Wallet} onPress={() => fund.mutate()} loading={fund.isPending} testID="escrow-fund" />
          )}
          <Text variant="small" tone="muted">Publishing needs a confirmed funding of the full total.</Text>
        </View>
      ) : (
        <Card k={0.64} style={styles.card}>
          <Text variant="bodySm" testID="escrow-funded">
            Funded (simulated){p.fundingWallet ? ` from ${short(p.fundingWallet)}` : ''}.
          </Text>
          {b ? (
            <KeyValueList testID="escrow-books">
              <KeyValue label="Available for new testers" value={tokenAmount(b.availableUnits)} valueTestID="escrow-available" />
              <KeyValue label="Held for testers in progress" value={tokenAmount(b.heldUnits)} valueTestID="escrow-held" />
              <KeyValue label="Approved, payment pending" value={tokenAmount(b.payableUnits)} valueTestID="escrow-payable" />
              <KeyValue label="Settled to testers (simulated)" value={tokenAmount(b.settledUnits)} valueTestID="escrow-settled" />
              <KeyValue label="Platform fees" value={tokenAmount(b.feesUnits)} />
              <KeyValue label="Refund pending" value={tokenAmount(b.pendingRefundUnits)} />
              <KeyValue label="Refunded (simulated)" value={tokenAmount(b.refundedUnits)} valueTestID="escrow-refunded" />
            </KeyValueList>
          ) : null}
          {p.refund ? (
            <Text variant="small" tone="muted" testID="escrow-refund">
              {p.refund.status === 'confirmed'
                ? `Refunded ${tokenAmount(p.refund.amountUnits)} to the funding wallet · simulation, no funds moved.`
                : `Refund of ${tokenAmount(p.refund.amountUnits)} to the funding wallet: ${p.refund.status} · simulation.`}
            </Text>
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
