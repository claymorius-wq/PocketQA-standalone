import { useMutation } from '@tanstack/react-query';
import { Link2, Unlink, Wallet } from 'lucide-react-native';
import { api, ApiError } from '../api/client';
import { useSession } from '../auth/SessionProvider';
import { walletCapability } from '../lib/capability';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Card, Notice, Row, StatusPill, Text } from '../ui';
import { linkWalletWithMwa } from './link';

export function WalletSection() {
  const { user, refreshUser } = useSession();
  const { colors } = useTheme();
  const cap = walletCapability();
  const unlink = useMutation({ mutationFn: () => api('walletUnlink'), onSuccess: () => refreshUser() });
  const link = useMutation({ mutationFn: () => linkWalletWithMwa(), onSuccess: () => refreshUser() });
  const wallet = user?.wallet;
  return (
    <Card testID="wallet-section">
      <Row style={{ justifyContent: 'space-between' }}>
        <Row>
          <Wallet size={20} color={colors.text} />
          <Text variant="heading">Devnet wallet</Text>
        </Row>
        <StatusPill status={wallet ? 'confirmed' : 'expired'} label={wallet ? 'Linked' : 'Not linked'} />
      </Row>
      <Text variant="small" tone="muted">Optional. Solana devnet only. Linking proves you control an address; it is not a payment, and Pocket QA never holds your keys.</Text>
      {wallet ? (
        <>
          <Text variant="small" testID="wallet-address">{wallet.address}</Text>
          <Button label="Unlink wallet" icon={Unlink} variant="secondary" onPress={() => unlink.mutate()} loading={unlink.isPending} testID="wallet-unlink" />
        </>
      ) : cap.available ? (
        <Button label="Link devnet wallet" icon={Link2} variant="secondary" onPress={() => link.mutate()} loading={link.isPending} testID="wallet-link" />
      ) : (
        <Notice tone="info" title="Unavailable on this device" testID="wallet-unavailable">{cap.reason}</Notice>
      )}
      {link.error || unlink.error ? (
        <Notice tone="danger" title="Wallet action failed">{((link.error || unlink.error) as ApiError | Error).message}</Notice>
      ) : null}
    </Card>
  );
}
