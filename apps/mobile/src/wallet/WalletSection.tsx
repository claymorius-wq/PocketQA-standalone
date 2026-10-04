import { useMutation } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';
import { api } from '../api/client';
import { useSession } from '../auth/SessionProvider';
import { walletCapability } from '../lib/capability';
import { CardHead, LateEnter } from '../settings/cardParts';
import { Button, Card, Notice, StatusPill, Text } from '../ui';
import { walletErrorText } from './errors';
import { linkWalletWithMwa } from './link';
import type { StandardWallet } from './standard';
import { useWallets } from './useWallets';

// The Settings wallet card (A-Settings board, k = 0.8): the 40dp wallet tile, "Devnet wallet" and
// the link status, the devnet note, then one of: the platform's reason (web, iOS), "Link devnet
// wallet" (Android), or the address with "Unlink wallet". Linking is "not a payment" (§14):
// secondary glass only, no Uplight and no caustic sweep. The pill swaps in its slot (120ms) and
// controls that replace each other after a link or unlink enter by themselves.

export function WalletSection() {
  const { user, refreshUser } = useSession();
  const cap = walletCapability();
  const unlink = useMutation({ mutationFn: () => api('walletUnlink'), onSuccess: () => refreshUser() });
  // Web: one button per installed Wallet Standard wallet (ledger W1); Android: MWA.
  const wallets = useWallets();
  const link = useMutation({ mutationFn: (wallet?: StandardWallet) => linkWalletWithMwa(wallet ? { wallet } : {}), onSuccess: () => refreshUser() });
  const wallet = user?.wallet;
  return (
    <Card testID="wallet-section" k={0.8} style={styles.card}>
      <CardHead glyph="wallet" title="Devnet wallet" right={<StatusPill status={wallet ? 'confirmed' : 'expired'} label={wallet ? 'Linked' : 'Not linked'} />} />
      <Text variant="small" tone="muted" style={styles.lead}>Optional. Solana devnet only. Linking proves you control an address; it is not a payment, and Pocket QA never holds your keys.</Text>
      {wallet ? (
        <LateEnter key="linked" style={[styles.block, styles.linked]}>
          <Text variant="meta" testID="wallet-address" style={styles.address}>{wallet.address}</Text>
          <Button label="Unlink wallet" icon="unlink" variant="secondary" onPress={() => unlink.mutate()} loading={unlink.isPending} testID="wallet-unlink" />
        </LateEnter>
      ) : cap.available ? (
        <LateEnter key="link" style={[styles.block, styles.linked]}>
          {(wallets.length > 1 ? wallets : [undefined]).map((w, i) => (
            <Button
              key={w?.name ?? 'default'}
              label={w ? `Link ${w.name}` : 'Link devnet wallet'}
              icon="link"
              variant="secondary"
              onPress={() => link.mutate(w)}
              loading={link.isPending && link.variables === w}
              disabled={link.isPending}
              testID={i === 0 ? 'wallet-link' : `wallet-link-${i}`}
            />
          ))}
        </LateEnter>
      ) : (
        <View style={styles.block}>
          <Notice tone="info" title="Unavailable on this device" testID="wallet-unavailable">{cap.reason}</Notice>
        </View>
      )}
      {link.error || unlink.error ? (
        <View style={styles.block}>
          <Notice tone="danger" title="Wallet action failed" testID="wallet-error">{walletErrorText(link.error || unlink.error)}</Notice>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  // Board card: 18 all round; children carry the board's own spacing instead of the kit's 8dp gap.
  card: { gap: 0, paddingBottom: 18, paddingLeft: 18 },
  lead: { marginTop: 12 },
  block: { marginTop: 14 },
  linked: { gap: 12 },
  // The full base58 address in DM Mono 12/18, never truncated.
  address: { lineHeight: 18 },
});
