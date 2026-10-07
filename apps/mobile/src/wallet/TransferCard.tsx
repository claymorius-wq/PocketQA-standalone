import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Linking, StyleSheet } from 'react-native';
import type { DevnetTransfer } from '@pocket-qa/contracts';
import { api } from '../api/client';
import { useIntentKey } from '../api/intentKey';
import { GlassSurface, useUplight } from '../glass';
import { glyphIcon } from '../icons';
import { transferSignCapability } from '../lib/capability';
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

const SEND = glyphIcon('send');
const EXTERNAL = glyphIcon('external');

function TransferRow({ t, role, lit }: { t: DevnetTransfer; role: 'builder' | 'tester'; lit: boolean }) {
  const qc = useQueryClient();
  const cap = transferSignCapability();
  const sign = useMutation({
    mutationFn: () => signAndSendDevnetTransfer(t),
    onSettled: () => qc.invalidateQueries({ queryKey: ['transfers', t.participationId] }),
  });
  const s = STATE[t.status];
  // U8 (§10.2): only a confirmed transfer may look verified. The newest confirmed row (`lit`, one
  // Uplight per screen) takes the uplit card recipe (Earned: rise, then rest at 0.45) and no floor
  // of its own; a row that opens already confirmed starts at rest. Pending, awaiting signature,
  // failed and expired are never lit.
  const confirmed = t.status === 'confirmed';
  const light = useUplight('earned', lit, { startAtRest: true });
  const content = (
    <>
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
          <Button label="Sign with devnet wallet" icon={SEND} onPress={() => sign.mutate()} loading={sign.isPending} testID="transfer-sign" />
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
        <Button label="View on devnet explorer" icon={EXTERNAL} variant="ghost" onPress={() => void Linking.openURL(t.explorerUrl!)} testID="transfer-explorer" />
      ) : null}
    </>
  );
  // Every row is the board's mini card (radius 18, padding 14/16 less the 1dp rim; pending rows at
  // k 0.8). Confirming changes no layout: the pill swaps in 120ms, then the uplit layer fades in.
  return (
    <GlassSurface level="card" k={confirmed ? 1 : 0.8} radius={ROW_RADIUS} uplight={lit ? light.u : undefined} style={styles.row} testID={`transfer-${t.status}`}>
      {content}
    </GlassSurface>
  );
}

const ROW_RADIUS = 18;

/** The transfer that may carry the Uplight: the most recently verified confirmed one. */
function newestConfirmed(items: readonly DevnetTransfer[]): string | null {
  let best: DevnetTransfer | null = null;
  for (const t of items) {
    if (t.status !== 'confirmed') continue;
    if (!best || Date.parse(t.verifiedAt ?? t.createdAt) > Date.parse(best.verifiedAt ?? best.createdAt)) best = t;
  }
  return best?.id ?? null;
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
  const litId = newestConfirmed(items);
  const intent = useIntentKey();
  const create = useMutation({
    mutationFn: () => api('createTransfer', { body: { participationId }, idempotencyKey: intent.keyFor(participationId) }),
    onSuccess: () => {
      intent.done();
      return qc.invalidateQueries({ queryKey: ['transfers', participationId] });
    },
  });
  if (role === 'tester' && items.length === 0) return null;
  return (
    <Card testID="transfer-card">
      <Text variant="heading">Devnet demo transfer</Text>
      <Text variant="small" tone="muted">Devnet only · no real value · not a reward (rewards are test credits).</Text>
      {items.map((t) => (
        <TransferRow key={t.id} t={t} role={role} lit={t.id === litId} />
      ))}
      {role === 'builder' && canStart && !open ? (
        <Button label="Start devnet demo transfer" variant="secondary" onPress={() => create.mutate()} loading={create.isPending} testID="transfer-create" />
      ) : null}
      {create.error ? <Notice tone="danger" title="Couldn’t start" testID="transfer-create-error">{walletErrorText(create.error)}</Notice> : null}
      {q.error ? <Notice tone="danger" title="Couldn’t load transfers">{walletErrorText(q.error)}</Notice> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.xs, borderRadius: ROW_RADIUS, paddingVertical: 13, paddingHorizontal: 15 },
});
