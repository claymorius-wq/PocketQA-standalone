import { router } from 'expo-router';
import { Award } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../auth/SessionProvider';
import { useMyPayouts } from '../lib/queries';
import { Button, Text } from '../ui';
import { SectionHeader } from '../ui/patterns';
import { PaymentStateCard } from './PaymentState';

/**
 * Under the tester's Credits: the link to reputation, and (where settlement runs) the rewards of
 * wallet-funded studies with their payment state. Money and points are shown apart, and the
 * rewards are labelled by their settlement (a simulation, or the devnet pilot: no value).
 */
export function TesterRewards() {
  const { features } = useSession();
  const payouts = useMyPayouts();
  return (
    <View style={styles.wrap}>
      <Button label="Reputation and badges" icon={Award} variant="secondary" onPress={() => router.push('/reputation')} testID="open-reputation" />
      {features.settlement !== 'off' && payouts.data?.items.length ? (
        <View testID="tester-wallet-rewards">
          <SectionHeader title={features.settlement === 'squads_devnet' ? 'Wallet rewards · devnet pilot, no value' : 'Wallet rewards · simulation'} />
          <View style={styles.list}>
            {payouts.data.items.map((p) => (
              <View key={p.id} style={styles.item}>
                <Text variant="heading">{p.studyTitle}</Text>
                <PaymentStateCard payout={p} testID={`tester-payment-${p.id}`} />
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16, marginTop: 24 },
  list: { gap: 14 },
  item: { gap: 6 },
});
