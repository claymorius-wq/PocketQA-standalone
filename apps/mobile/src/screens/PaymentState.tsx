import type { Payout } from '@pocket-qa/contracts';
import { StyleSheet, View } from 'react-native';
import { paymentState, tokenAmount } from '../lib/money';
import { Notice, Text } from '../ui';

/**
 * The state of an approved test's reward on a wallet-funded study (ADR 0007), for the builder's
 * review and the tester's participation. Always qualified as a simulation; the destination is the
 * wallet frozen at consent, shortened.
 */
export function PaymentStateCard({ payout, testID = 'payment-state' }: { payout: Payout; testID?: string }) {
  const s = paymentState(payout);
  const { amountUnits, destination, signature } = payout;
  return (
    <View style={styles.wrap}>
      <Notice tone={s.tone} title={s.label} testID={testID}>
        {`${tokenAmount(amountUnits)} to ${short(destination)}. ${s.detail}`}
      </Notice>
      {signature && s.tone === 'success' ? (
        <Text variant="small" tone="muted" testID={`${testID}-ref`}>{`Simulated transfer reference ${short(signature)} (no network explorer link: nothing was sent on a real network).`}</Text>
      ) : null}
    </View>
  );
}

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
const styles = StyleSheet.create({ wrap: { gap: 6 } });
