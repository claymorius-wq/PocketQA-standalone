import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RequireRole } from '../../../src/screens/RequireRole';
import { useLocalSearchParams } from 'expo-router';
import { Check, Eye, FileWarning, Plus, Sparkles, X } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import type { Evidence } from '@pocket-qa/contracts';
import { api, ApiError, mediaUrl } from '../../../src/api/client';
import { MediaPreview } from '../../../src/evidence/MediaPreview';
import { bytes, credits, statusLabel, when } from '../../../src/lib/format';
import { useAiStatus, useEvidence, useFindings, useParticipation, useStudy } from '../../../src/lib/queries';
import { space } from '../../../src/theme/tokens';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { Button, Card, ConfirmSheet, EmptyState, Field, Notice, QueryState, Row, Screen, Section, Segmented, StatusPill, Text } from '../../../src/ui';

function EvidenceItem({ e }: { e: Evidence }) {
  const [url, setUrl] = useState<string | null>(null);
  const open = useMutation({
    mutationFn: () => api('playbackToken', { params: { id: e.id } }),
    onSuccess: (t) => setUrl(mediaUrl(t.token)),
  });
  return (
    <Card testID="evidence-item">
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="heading">{e.kind === 'screen_recording' ? 'Screen recording' : 'Screenshot'}</Text>
        <Text variant="small" tone="muted">{e.capturedOn} · {bytes(e.sizeBytes)}</Text>
      </Row>
      {url ? (
        <MediaPreview uri={url} mimeType={e.mimeType} testID="evidence-media" />
      ) : (
        <Button label="View" icon={Eye} variant="secondary" onPress={() => open.mutate()} loading={open.isPending} testID="evidence-view" />
      )}
      {open.error ? <Notice tone="danger" title="Can’t open evidence">{(open.error as ApiError).message}</Notice> : null}
      <Text variant="small" tone="muted">Playback links expire after 5 minutes.</Text>
    </Card>
  );
}

function FindingForm({ participationId, evidence }: { participationId: string; evidence: Evidence[] }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState<'blocker' | 'major' | 'minor' | 'info'>('major');
  const [description, setDescription] = useState('');
  const [evidenceId, setEvidenceId] = useState<string>('none');
  const create = useMutation({
    mutationFn: () => api('createFinding', { params: { id: participationId }, body: { title, severity, description, ...(evidenceId !== 'none' ? { evidenceId } : {}) } }),
    onSuccess: () => {
      setTitle('');
      setDescription('');
      qc.invalidateQueries({ queryKey: ['findings', participationId] });
    },
  });
  return (
    <Card testID="finding-form">
      <Text variant="heading">Add a finding</Text>
      <Field label="Title" value={title} onChangeText={setTitle} testID="finding-title" />
      <Segmented
        testID="finding-severity"
        value={severity}
        onChange={setSeverity}
        options={[
          { value: 'blocker', label: 'Blocker' },
          { value: 'major', label: 'Major' },
          { value: 'minor', label: 'Minor' },
          { value: 'info', label: 'Info' },
        ]}
      />
      <Field label="What happened" value={description} onChangeText={setDescription} multiline testID="finding-description" />
      {evidence.length ? (
        <>
          <Text variant="label" tone="muted">LINKED EVIDENCE</Text>
          <Segmented
            testID="finding-evidence"
            value={evidenceId}
            onChange={setEvidenceId}
            options={[{ value: 'none', label: 'None' }, ...evidence.map((e, i) => ({ value: e.id, label: `#${i + 1}` }))]}
          />
        </>
      ) : null}
      {create.error ? <Notice tone="danger" title="Finding not saved" testID="finding-error">{(create.error as ApiError).message}</Notice> : null}
      <Button label="Add finding" icon={Plus} onPress={() => create.mutate()} disabled={title.trim().length < 3 || description.trim().length < 5} loading={create.isPending} testID="finding-submit" />
    </Card>
  );
}

function ReviewInner() {
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pq = useParticipation(id);
  const study = useStudy(pq.data?.studyId ?? '');
  const ev = useEvidence(id);
  const findings = useFindings(id);
  const ai = useAiStatus();
  const qc = useQueryClient();
  const [sheet, setSheet] = useState<null | 'approve' | 'reject'>(null);
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const decide = useMutation({
    mutationFn: (d: 'approve' | 'reject') =>
      d === 'approve' ? api('approve', { params: { id }, body: note.trim() ? { note } : {} }) : api('reject', { params: { id }, body: { reason } }),
    onSuccess: (p) => {
      setSheet(null);
      qc.setQueryData(['participation', id], p);
      qc.invalidateQueries({ queryKey: ['studyParticipations', p.studyId] });
      qc.invalidateQueries({ queryKey: ['study', p.studyId] });
    },
  });
  return (
    <Screen testID="review-screen">
      <QueryState query={pq}>
        {(p) => (
          <>
            <Row style={{ justifyContent: 'space-between' }}>
              <StatusPill status={p.status} label={statusLabel[p.status]} testID="review-status" />
              <Text variant="small" tone="muted">{credits(p.rewardCredits)} on approval</Text>
            </Row>
            <Text variant="display">{p.testerDisplayName ?? 'Tester'}</Text>
            <Text tone="muted">Consented to v{p.consentVersion} on {when(p.consentedAt)}{p.submittedAt ? ` · submitted ${when(p.submittedAt)}` : ''}</Text>
            <Card testID="ai-unavailable">
              <Row>
                <Sparkles size={18} color={colors.textMuted} />
                <Text variant="heading">{ai.data?.available ? 'AI analysis' : 'Analysis unavailable'}</Text>
              </Row>
              <Text variant="small" tone="muted">No AI provider is configured. Review the evidence and write findings yourself.</Text>
            </Card>
            <Section title="Task notes">
              {study.data?.tasks.map((t, i) => (
                <Card key={t.id}>
                  <Text variant="label" tone="muted">TASK {i + 1}</Text>
                  <Text>{t.instruction}</Text>
                  <Text variant="small" testID={`review-note-${i}`}>{p.taskNotes.find((n) => n.taskId === t.id)?.note || 'No notes.'}</Text>
                </Card>
              ))}
            </Section>
            <Section title="Evidence">
              <QueryState query={ev} empty={(d) => (d.items.length === 0 ? <EmptyState icon={FileWarning} title="No evidence uploaded" body="The tester submitted without recordings or screenshots." /> : null)}>
                {(d) => <View style={{ gap: space.sm }}>{d.items.map((e) => <EvidenceItem key={e.id} e={e} />)}</View>}
              </QueryState>
            </Section>
            <Section title="Findings">
              {findings.data?.items.map((f) => (
                <Card key={f.id} testID="finding-item">
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Text variant="heading">{f.title}</Text>
                    <StatusPill status={f.severity === 'blocker' ? 'failed' : f.severity === 'major' ? 'pending' : 'resolved'} label={f.severity} />
                  </Row>
                  <Text variant="small">{f.description}</Text>
                  <Text variant="small" tone="muted">Written by a person · {when(f.createdAt)}</Text>
                </Card>
              ))}
              {p.status !== 'consented' && p.status !== 'in_progress' && p.status !== 'withdrawn' ? <FindingForm participationId={p.id} evidence={ev.data?.items ?? []} /> : <Text tone="muted">Findings can be added after the tester submits.</Text>}
            </Section>
            {p.status === 'submitted' ? (
              <Section title="Decision">
                <Row>
                  <Button label="Approve" icon={Check} onPress={() => setSheet('approve')} testID="review-approve" />
                  <Button label="Reject" icon={X} variant="danger" onPress={() => setSheet('reject')} testID="review-reject" />
                </Row>
              </Section>
            ) : p.decidedAt ? (
              <Notice tone={p.status === 'approved' ? 'success' : 'info'} title={`Decision: ${statusLabel[p.status]}`} testID="review-decided">{p.decisionReason ?? `Decided ${when(p.decidedAt)}`}</Notice>
            ) : null}
            <ConfirmSheet
              visible={sheet !== null}
              title={sheet === 'approve' ? `Approve and credit ${credits(p.rewardCredits)}?` : 'Reject this submission?'}
              body={sheet === 'approve' ? 'The tester is credited once. This can’t be undone.' : 'Give a clear reason. The tester can dispute within 7 days.'}
              confirmLabel={sheet === 'approve' ? 'Approve' : 'Reject'}
              destructive={sheet === 'reject'}
              confirmDisabled={sheet === 'reject' && reason.trim().length < 10}
              loading={decide.isPending}
              onCancel={() => setSheet(null)}
              onConfirm={() => sheet && decide.mutate(sheet)}
            >
              {sheet === 'reject' ? <Field label="Reason" value={reason} onChangeText={setReason} multiline hint="At least 10 characters." testID="reject-reason" /> : <Field label="Note to tester (optional)" value={note} onChangeText={setNote} testID="approve-note" />}
              {decide.error ? <Notice tone="danger" title="Decision not saved" testID="decision-error">{(decide.error as ApiError).message}</Notice> : null}
            </ConfirmSheet>
          </>
        )}
      </QueryState>
    </Screen>
  );
}

export default function Review() {
  return (
    <RequireRole role="builder">
      <ReviewInner />
    </RequireRole>
  );
}
