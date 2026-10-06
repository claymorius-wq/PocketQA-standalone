import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../auth/SessionProvider';
import { Button, Card, Notice, Text } from '../ui';
import { KeyValue, KeyValueList } from '../ui/patterns';
import { checkServerTxPlan, type CheckedPlan, type ServerTxPlan } from './serverTx';
import { signServerTransaction } from './signServerTransaction';

const KIND: Record<CheckedPlan['kind'], string> = {
  payout: 'Reward to the tester',
  refund: 'Refund to the funding wallet',
  fee: 'Platform fee',
  funding: 'Escrow funding',
};

/**
 * Devnet pilot: a server-built transaction for the builder's wallet, in two steps. "Review" loads
 * it and shows the decoded plan (what, how much, to whom, the operation id or funding reference,
 * the signing wallet and the pilot copy); only then does "Sign" ask the wallet, which sends it,
 * and the signature is submitted. Every check and refusal is in serverTx.ts; a refusal shows its
 * reason and nothing is signed.
 */
export function ServerTxSign<P extends ServerTxPlan>(props: {
  testID: string;
  settlement: string;
  /** Funding: the vault token account from the funding request; the transfer must go there. */
  expectedDestination?: string;
  reviewLabel: string;
  signLabel: string;
  load: () => Promise<P>;
  submit: (signature: string, plan: P) => Promise<unknown>;
  onDone?: () => void;
}) {
  const { user } = useSession();
  const ctx = { settlement: props.settlement, linkedWallet: user?.wallet?.address ?? null, ...(props.expectedDestination ? { expectedDestination: props.expectedDestination } : {}) };
  const [loaded, setLoaded] = useState<{ plan: P; checked: CheckedPlan } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'review' | 'sign' | null>(null);
  const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Nothing was signed.');

  async function review() {
    setBusy('review');
    setError(null);
    setLoaded(null);
    try {
      const plan = await props.load();
      setLoaded({ plan, checked: checkServerTxPlan(plan, ctx) });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }
  async function sign() {
    if (!loaded) return;
    setBusy('sign');
    setError(null);
    try {
      await signServerTransaction(loaded.plan, ctx, (signature) => props.submit(signature, loaded.plan));
      setLoaded(null);
      props.onDone?.();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  const c = loaded?.checked;
  return (
    <View style={styles.wrap} testID={props.testID}>
      {error ? (
        <Notice tone="danger" title="Not signed" testID={`${props.testID}-error`}>
          {error}
        </Notice>
      ) : null}
      {c ? (
        <Card k={0.64} style={styles.card}>
          <Text variant="label">{`${KIND[c.kind]} · checked in this transaction`}</Text>
          <KeyValueList testID={`${props.testID}-plan`}>
            {c.checked.map((r) => (
              <KeyValue key={r.label} label={r.label} value={r.value} />
            ))}
            <KeyValue label="Signed by your wallet" value={c.signer} />
          </KeyValueList>
          {c.described.length ? (
            <>
              <Text variant="label">As described by Pocket QA (not in this transaction; checked on chain before it executes)</Text>
              <KeyValueList testID={`${props.testID}-described`}>
                {c.described.map((r) => (
                  <KeyValue key={r.label} label={r.label} value={r.value} />
                ))}
              </KeyValueList>
            </>
          ) : null}
          <Text variant="small" tone="muted" testID={`${props.testID}-copy`}>
            {c.copy}
          </Text>
          <Button label={props.signLabel} onPress={() => void sign()} loading={busy === 'sign'} disabled={busy !== null} testID={`${props.testID}-sign`} />
        </Card>
      ) : (
        <Button label={props.reviewLabel} variant="secondary" onPress={() => void review()} loading={busy === 'review'} disabled={busy !== null} testID={`${props.testID}-review`} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  card: { padding: 16, gap: 10 },
});
