import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Send } from 'lucide-react-native';
import { Linking, View } from 'react-native';
import type { DevnetTransfer } from '@pocket-qa/contracts';
import { api } from '../api/client';
import { walletCapability } from '../lib/capability';
import { when } from '../lib/format';
import { useParticipationTransfers } from '../lib/queries';
import { space } from '../theme/tokens';
import { Button, Card, Notice, Row, StatusPill, Text } from '../ui';
import { walletErrorText } from './errors';
import { SentNotRecordedError } from './reportSignature';
import { signAndSendDevnetTransfer } from './sendTransfer';

const SOL = (lamports: number) => `${(lamports / 1e9).toLocaleString('en-US', { maximumFractionDigits: 9 })} devnet SOL`;

/** Labels never claim payment: only `confirmed` means the chain shows the transfer. */
const STATE: Record<DevnetTransfer['status'], { label: string; builder: string; tester: string }> = {
  awaiting_signature: {
    label: 'Awaiting signature',
    builder: 'Sign it in your devnet wallet. Nothing has been sent yet.',
    tester: 'The builder has not signed it yet. Nothing has been sent.',
  },
  pending: {
    label: 'Pending',
    builder: 'Submitted. Waiting for devnet to finalize it; this is not confirmed yet.',
    tester: 'Submitted by the builder. Not confirmed on devnet yet.',
  },
  confirmed: {
    label: 'Confirmed on devnet',
    builder: 'Devnet shows this exact transfer, finalized.',
    tester: 'Devnet shows this exact transfer to your linked wallet, finalized.',
  },
  failed: { label: 'Failed', builder: 'Devnet did not show a matching transfer.', tester: 'Devnet did not show a matching transfer.' },
  // Expiry means no signature was *reported*; the wallet may still have sent one.
  expired: {
    label: 'Expired',
    builder: 'No signature was reported in time. If your wallet did send it, check the devnet explorer before starting another.',
    tester: 'No signature was reported in time.',
  },
};

function TransferRow({ t, role }: { t: DevnetTransfer; role: 'builder' | 'tester' }) {
  const qc = useQueryClient();
  const cap = walletCapability();
  const sign = useMutation({
    mutationFn: () => signAndSendDevnetTransfer(t),
    onSettled: () => qc.invalidateQueries({ queryKey: ['transfers', t.participationId] }),
  });
  const s = STATE[t.status];
  return (
    <View style={{ gap: space.xs }} testID={`transfer-${t.status}`}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="heading">{SOL(t.lamports)}</Text>
        <StatusPill status={t.status} label={s.label} testID="transfer-status" />
      </Row>
      <Text variant="small">{role === 'builder' ? s.builder : s.tester}</Text>
      {t.failureReason ? <Text variant="small" tone="danger" testID="transfer-reason">{t.failureReason}</Text> : null}
      <Text variant="small" tone="muted">
        To {t.recipient.slice(0, 6)}…{t.recipient.slice(-4)} · created {when(t.createdAt)}
        {t.verifiedAt ? ` · verified ${when(t.verifiedAt)}` : ''}
      </Text>
      {t.status === 'awaiting_signature' && role === 'builder' ? (
        cap.available ? (
          <Button label="Sign with devnet wallet" icon={Send} onPress={() => sign.mutate()} loading={sign.isPending} testID="transfer-sign" />
        ) : (
          <Notice tone="info" title="Sign on Android" testID="transfer-sign-unavailable">
            Signing needs the Android app with your linked devnet wallet.
          </Notice>
        )
      ) : null}
      {sign.error ? (
        <Notice tone="danger" title={sign.error instanceof SentNotRecordedError ? 'Sent, not recorded' : 'Not sent'} testID="transfer-sign-error">
          {walletErrorText(sign.error)}
        </Notice>
      ) : null}
      {t.status === 'confirmed' && t.explorerUrl ? (
        <Button label="View on devnet explorer" icon={ExternalLink} variant="ghost" onPress={() => void Linking.openURL(t.explorerUrl!)} testID="transfer-explorer" />
      ) : null}
    </View>
  );
}

/**
 * Devnet demo transfer for an approved participation. It is a demonstration of a
 * verified on-chain transfer, never a reward: rewards are test credits.
 */
export function TransferCard({ participationId, role, canStart }: { participationId: string; role: 'builder' | 'tester'; canStart: boolean }) {
  const qc = useQueryClient();
  const q = useParticipationTransfers(participationId);
  const items = q.data?.items ?? [];
  const open = items.some((t) => t.status === 'awaiting_signature' || t.status === 'pending' || t.status === 'confirmed');
  const create = useMutation({
    mutationFn: () => api('createTransfer', { body: { participationId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['transfers', participationId] }),
  });
  if (role === 'tester' && items.length === 0) return null;
  return (
    <Card testID="transfer-card">
      <Text variant="heading">Devnet demo transfer</Text>
      <Text variant="small" tone="muted">Devnet only · no real value · not a reward (rewards are test credits).</Text>
      {items.map((t) => (
        <TransferRow key={t.id} t={t} role={role} />
      ))}
      {role === 'builder' && canStart && !open ? (
        <Button label="Start devnet demo transfer" variant="secondary" onPress={() => create.mutate()} loading={create.isPending} testID="transfer-create" />
      ) : null}
      {create.error ? <Notice tone="danger" title="Couldn’t start" testID="transfer-create-error">{walletErrorText(create.error)}</Notice> : null}
      {q.error ? <Notice tone="danger" title="Couldn’t load transfers">{walletErrorText(q.error)}</Notice> : null}
    </Card>
  );
}
