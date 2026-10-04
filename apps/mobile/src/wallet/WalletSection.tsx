import { useMutation } from '@tanstack/react-query';
import { api } from '../api/client';
import { useSession } from '../auth/SessionProvider';
import { walletCapability } from '../lib/capability';
import { GlassTile, glyphIcon } from '../icons';
import { Button, Card, Notice, Row, StatusPill, Text } from '../ui';
import { walletErrorText } from './errors';
import { linkWalletWithMwa } from './link';
import type { StandardWallet } from './standard';
import { useWallets } from './useWallets';

// Linking is "not a payment" (§14): secondary glass only, no Uplight and no caustic sweep.
const LINK = glyphIcon('link');
const UNLINK = glyphIcon('unlink');

export function WalletSection() {
  const { user, refreshUser } = useSession();
  const cap = walletCapability();
  const unlink = useMutation({ mutationFn: () => api('walletUnlink'), onSuccess: () => refreshUser() });
  // Web: one button per installed Wallet Standard wallet (ledger W1); Android: MWA.
  const wallets = useWallets();
  const link = useMutation({ mutationFn: (wallet?: StandardWallet) => linkWalletWithMwa(wallet ? { wallet } : {}), onSuccess: () => refreshUser() });
  const wallet = user?.wallet;
  return (
    <Card testID="wallet-section">
      <Row style={{ justifyContent: 'space-between' }}>
        <Row>
          <GlassTile name="wallet" size="list" />
          <Text variant="heading">Devnet wallet</Text>
        </Row>
        <StatusPill status={wallet ? 'confirmed' : 'expired'} label={wallet ? 'Linked' : 'Not linked'} />
      </Row>
      <Text variant="small" tone="muted">Optional. Solana devnet only. Linking proves you control an address; it is not a payment, and Pocket QA never holds your keys.</Text>
      {wallet ? (
        <>
          <Text variant="small" testID="wallet-address">{wallet.address}</Text>
          <Button label="Unlink wallet" icon={UNLINK} variant="secondary" onPress={() => unlink.mutate()} loading={unlink.isPending} testID="wallet-unlink" />
        </>
      ) : cap.available ? (
        (wallets.length > 1 ? wallets : [undefined]).map((w, i) => (
          <Button
            key={w?.name ?? 'default'}
            label={w ? `Link ${w.name}` : 'Link devnet wallet'}
            icon={LINK}
            variant="secondary"
            onPress={() => link.mutate(w)}
            loading={link.isPending && link.variables === w}
            disabled={link.isPending}
            testID={i === 0 ? 'wallet-link' : `wallet-link-${i}`}
          />
        ))
      ) : (
        <Notice tone="info" title="Unavailable on this device" testID="wallet-unavailable">{cap.reason}</Notice>
      )}
      {link.error || unlink.error ? (
        <Notice tone="danger" title="Wallet action failed" testID="wallet-error">{walletErrorText(link.error || unlink.error)}</Notice>
      ) : null}
    </Card>
  );
}
