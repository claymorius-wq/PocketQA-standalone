import type { Payout } from '@pocket-qa/contracts';
import { Linking, StyleSheet, View } from 'react-native';
import { glyphIcon } from '../icons';
import { devnetExplorerTx, paymentState, tokenAmount } from '../lib/money';
import { Button, Notice, Text } from '../ui';

const EXTERNAL = glyphIcon('external');

/**
 * The state of an approved test's reward on a wallet-funded study (ADR 0007), for the builder's
 * review and the tester's participation. Always qualified by its settlement: a simulation (no
 * network, no explorer link) or the devnet pilot (a devnet explorer link, test USDC with no
 * value). The destination is the wallet frozen at consent, shortened.
 */
export function PaymentStateCard({ payout, testID = 'payment-state' }: { payout: Payout; testID?: string }) {
  const s = paymentState(payout);
  const { amountUnits, destination, signature, settlement } = payout;
  const settled = signature && s.tone === 'success';
  return (
    <View style={styles.wrap}>
      <Notice tone={s.tone} title={s.label} testID={testID}>
        {`${tokenAmount(amountUnits, settlement)} to ${short(destination)}. ${s.detail}`}
      </Notice>
      {settled && settlement === 'simulated' ? (
        <Text variant="small" tone="muted" testID={`${testID}-ref`}>{`Simulated transfer reference ${short(signature)} (no network explorer link: nothing was sent on a real network).`}</Text>
      ) : null}
      {settled && settlement === 'squads_devnet' ? (
        <>
          <Text variant="small" tone="muted" testID={`${testID}-ref`}>{`Devnet transaction ${short(signature)}.`}</Text>
          <Button label="View on devnet explorer" icon={EXTERNAL} variant="ghost" onPress={() => void Linking.openURL(devnetExplorerTx(signature))} testID={`${testID}-explorer`} />
        </>
      ) : null}
    </View>
  );
}

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a);
const styles = StyleSheet.create({ wrap: { gap: 6 } });
