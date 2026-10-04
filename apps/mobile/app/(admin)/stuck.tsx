import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Hourglass } from 'lucide-react-native';
import { useState } from 'react';
import { STUCK_AFTER_DAYS } from '@pocket-qa/contracts';
import { api, ApiError } from '../../src/api/client';
import { useAdminStuck, useFocusRefetch } from '../../src/lib/queries';
import { StuckQueue, type StuckDecision } from '../../src/screens/StuckQueue';
import { ConfirmSheet, EmptyState, Field, QueryState, Screen } from '../../src/ui';
import { SheetFailure } from '../../src/ui/patterns';

// A-Stuck: a triage queue (one focus card, then "Next in queue"; src/screens/StuckQueue), every
// item decidable in place. The sheets ask for the audited reason; admin decisions are never lit
// (CONSISTENCY C4: the Approve sheet's tile is the hourglass on a success rim, Reject the rose
// reject tile). Each sheet starts clean (no earlier reason, no stale failure), and it keeps naming
// the decision it was opened for while it plays its exit.
export default function Stuck() {
  const q = useAdminStuck();
  useFocusRefetch(q);
  const qc = useQueryClient();
  const [target, setTarget] = useState<{ id: string; decision: StuckDecision } | null>(null);
  const [reason, setReason] = useState('');
  // The participation just decided, so the queue can file its card away (S8). UI state only.
  const [decided, setDecided] = useState<{ id: string; n: number } | null>(null);
  // The sheet keeps the last decision's title, confirm and tile while it animates out (target is
  // already null then), so an Approve sheet never flips to Reject as it leaves.
  const [shown, setShown] = useState(target);
  if (target && target !== shown) setShown(target);
  const decision = (target ?? shown)?.decision;
  const decide = useMutation({
    mutationFn: () => api('adminDecide', { params: { id: target!.id }, body: { decision: target!.decision, reason } }),
    onSuccess: (p) => {
      // The reason stays while the sheet animates out; the next open() clears it.
      setTarget(null);
      setDecided((prev) => ({ id: p.id, n: (prev?.n ?? 0) + 1 }));
      qc.invalidateQueries({ queryKey: ['adminStuck'] });
      qc.invalidateQueries({ queryKey: ['audit'] });
    },
  });
  // A sheet opened for a new item starts clean: a reason typed in a cancelled sheet never pre-fills
  // the next one (it would pass the 10-character gate), and a stale failure never shows. Reset on
  // open only, so the sheet body does not change while it animates out after Cancel.
  const open = (id: string, d: StuckDecision) => {
    setReason('');
    decide.reset();
    setTarget({ id, decision: d });
  };
  const cancel = () => setTarget(null);
  return (
    <Screen title="Stuck work" subtitle={`Submitted work no builder can review: builder suspended or deleted, or waiting ${STUCK_AFTER_DAYS}+ days`} testID="stuck-screen">
      <QueryState query={q} empty={(d) => (d.items.length === 0 ? <EmptyState icon={Hourglass} title="Nothing stuck" body="Submissions appear here only when their builder can't review them." /> : null)}>
        {(d) => <StuckQueue items={d.items} decided={decided} onDecide={open} />}
      </QueryState>
      <ConfirmSheet
        visible={!!target}
        title={decision === 'approve' ? 'Approve stuck submission?' : 'Reject stuck submission?'}
        body="You are deciding instead of the study owner. Your reason is recorded in the audit log and shown to the tester."
        confirmLabel={decision === 'approve' ? 'Approve' : 'Reject'}
        destructive={decision === 'reject'}
        confirmDisabled={reason.trim().length < 10}
        loading={decide.isPending}
        onCancel={cancel}
        onConfirm={() => decide.mutate()}
      >
        <Field label="Reason (audited)" value={reason} onChangeText={setReason} multiline hint="At least 10 characters." testID="stuck-reason" />
        {/* C4's failure branch, with this sheet's own title and testID (the sheet stays open; the confirm retries). */}
        {decide.error ? <SheetFailure title="Not decided" message={(decide.error as ApiError).message} testID="stuck-error" /> : null}
      </ConfirmSheet>
    </Screen>
  );
}
