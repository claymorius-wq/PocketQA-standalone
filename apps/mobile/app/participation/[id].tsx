import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RequireRole } from '../../src/screens/RequireRole';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import { Check, Circle, Flag, Paperclip, Play, Send, Square, Trash2, Upload, Video, X } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { PermissionsAndroid, Platform, View } from 'react-native';
import { REWARD_DISCLAIMER, type Participation, type TesterStudyView } from '@pocket-qa/contracts';
import { DISPUTE_WINDOW_MS, uploadQueue } from '@pocket-qa/domain';
import { api, ApiError, uploadEvidence } from '../../src/api/client';
import { MediaPreview } from '../../src/evidence/MediaPreview';
import { nativeRecorder } from '../../src/evidence/recorder';
import { applySegment, removeSegment, uploadKept, type LocalSegment } from '../../src/evidence/segments';
import { TransferCard } from '../../src/wallet/TransferCard';
import { recordingCapability } from '../../src/lib/capability';
import { bytes, credits, statusLabel, when } from '../../src/lib/format';
import { useEvidence, useFindings, useMyDisputes, useParticipation, useTesterStudy } from '../../src/lib/queries';
import { useTheme } from '../../src/theme/ThemeProvider';
import { space } from '../../src/theme/tokens';
import { Button, Card, ConfirmSheet, EmptyState, Field, Notice, QueryState, Row, Screen, Section, StatusPill, Text } from '../../src/ui';

const PICK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'];
const platform = (Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'web') as LocalSegment['capturedOn'];

function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function deleteLocal(seg: LocalSegment) {
  if (Platform.OS === 'web') {
    if (seg.uri.startsWith('blob:')) URL.revokeObjectURL(seg.uri);
    return;
  }
  try {
    new File(seg.uri).delete();
  } catch {
    // Already gone; nothing else to clean up.
  }
}

function TaskNotes({ p, study }: { p: Participation; study: TesterStudyView }) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(p.taskNotes.map((n) => [n.taskId, n.note])));
  const save = useMutation({
    mutationFn: (taskId: string) => api('putTaskNote', { params: { id: p.id, taskId }, body: { note: drafts[taskId] ?? '' } }),
    onSuccess: (np) => qc.setQueryData(['participation', p.id], np),
  });
  const editable = p.status === 'in_progress';
  return (
    <Section title="Tasks">
      {study.tasks.map((t, i) => {
        const saved = p.taskNotes.find((n) => n.taskId === t.id)?.note ?? '';
        const dirty = (drafts[t.id] ?? '') !== saved;
        return (
          <Card key={t.id} testID={`task-${i}`}>
            <Text variant="label" tone="muted">TASK {i + 1}</Text>
            <Text>{t.instruction}</Text>
            {t.successCriteria ? <Text variant="small" tone="muted">Done when: {t.successCriteria}</Text> : null}
            {editable ? (
              <>
                <Field
                  label="Your notes"
                  value={drafts[t.id] ?? ''}
                  onChangeText={(v) => setDrafts((d) => ({ ...d, [t.id]: v }))}
                  multiline
                  placeholder="What did you expect? Where did you hesitate?"
                  testID={`task-note-${i}`}
                />
                <Button label={dirty ? 'Save note' : 'Saved'} variant="secondary" disabled={!dirty} loading={save.isPending && save.variables === t.id} onPress={() => save.mutate(t.id)} testID={`task-note-save-${i}`} />
              </>
            ) : saved ? (
              <Text variant="small">Your notes: {saved}</Text>
            ) : null}
          </Card>
        );
      })}
      {save.error ? <Notice tone="danger" title="Note not saved">{(save.error as ApiError).message}</Notice> : null}
    </Section>
  );
}

function EvidenceCapture({ p, onPendingChange }: { p: Participation; onPendingChange: (n: number) => void }) {
  const qc = useQueryClient();
  const uploaded = useEvidence(p.id);
  const cap = recordingCapability();
  const recorder = nativeRecorder();
  const [segments, setSegments] = useState<LocalSegment[]>([]);
  // Read the real state: a session may still be running from before a remount.
  const [recording, setRecording] = useState(() => recorder?.isRecording() ?? false);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const [busy, setBusy] = useState(false);
  // The ref is the source of truth so the uploader always sees the latest list (a removal
  // during an upload must win); React state mirrors it for rendering.
  const live = useRef<LocalSegment[]>([]);
  const update = (fn: (l: LocalSegment[]) => LocalSegment[]) => {
    live.current = fn(live.current);
    setSegments(live.current);
  };
  const pending =
    segments.filter((s) => s.state === 'recorded' || s.state === 'kept' || s.state === 'failed' || s.state === 'uploading').length + (recording ? 1 : 0);
  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);
  // Leaving the screen discards anything not uploaded: stop the upload loop (it reads the
  // list through `get`, which returns nothing once cancelled) and delete the local copies.
  const cancelled = useRef(false);
  useEffect(
    () => () => {
      cancelled.current = true;
      // Capture never outlives the session screen: stop and delete an in-progress recording.
      if (recorder) {
        const discard = recorder.isRecording() ? recorder.discardAsync() : Promise.resolve();
        void discard.then(() => recorder.purgeAsync()).catch(() => {});
      }
      live.current.filter((s) => s.state !== 'uploaded' && s.state !== 'removed').forEach(deleteLocal);
    },
    [],
  );

  // The OS can stop a projection (status-bar chip, screen lock); keep whatever was captured.
  useEffect(() => {
    const sub = recorder?.addListener?.('onStopped', (e) => {
      setRecording(false);
      if (e.clip) addSegment({ kind: 'screen_recording', name: `recording-${new Date().toISOString()}.mp4`, mimeType: e.clip.mimeType, size: e.clip.sizeBytes, uri: e.clip.uri, durationMs: e.clip.durationMs });
      if (e.reason === 'system') setStopped(true);
      if (e.reason === 'error') setError('Recording failed. Nothing was recorded.');
    });
    return () => sub?.remove();
  }, [recorder]);

  function addSegment(s: Omit<LocalSegment, 'id' | 'state' | 'capturedOn'>) {
    update((list) => [...list, { ...s, id: newId(), state: 'recorded', capturedOn: platform }]);
  }

  async function startRecording() {
    setError(null);
    setStopped(false);
    // Android 13+: the recording notification (with its Stop action) is the visible
    // indicator on versions without a status-bar chip, so it must be allowed first.
    if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
      const res = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      if (res !== PermissionsAndroid.RESULTS.GRANTED) {
        setError('Allow notifications for Pocket QA so the recording indicator and its Stop button are visible. Nothing was recorded.');
        return;
      }
    }
    try {
      await recorder!.startAsync();
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error && /denied|cancel/i.test(e.message) ? 'Recording permission was declined. Nothing was recorded.' : 'Couldn’t start recording.');
    }
  }
  async function stopRecording() {
    try {
      const clip = await recorder!.stopAsync();
      addSegment({ kind: 'screen_recording', name: `recording-${new Date().toISOString()}.mp4`, mimeType: clip.mimeType, size: clip.sizeBytes, uri: clip.uri, durationMs: clip.durationMs });
    } catch {
      setError('Couldn’t finish the recording.');
    } finally {
      setRecording(false);
    }
  }

  async function attach() {
    setError(null);
    const res = await DocumentPicker.getDocumentAsync({ type: PICK_TYPES, copyToCacheDirectory: true, multiple: false });
    if (res.canceled || !res.assets[0]) return;
    const a = res.assets[0];
    const mime = a.mimeType ?? '';
    if (!PICK_TYPES.includes(mime)) {
      setError('Choose a PNG, JPEG, WebP, MP4 or WebM file.');
      return;
    }
    addSegment({ kind: mime.startsWith('video/') ? 'screen_recording' : 'screenshot', name: a.name, mimeType: mime, size: a.size ?? null, uri: a.uri, ...(a.file ? { file: a.file } : {}) });
  }

  function keep(id: string) {
    update((l) => applySegment(l, id, 'keep'));
  }
  function remove(id: string) {
    update((l) => removeSegment(l, id, deleteLocal));
  }

  async function uploadAll() {
    setBusy(true);
    setError(null);
    const out = await uploadKept(
      () => (cancelled.current ? [] : live.current),
      (s) =>
        uploadEvidence(
          p.id,
          { kind: s.kind, capturedOn: s.capturedOn, clientSegmentId: s.id, ...(s.durationMs ? { durationMs: s.durationMs } : {}) },
          s.file ?? (new File(s.uri) as unknown as Blob),
          s.name,
        ),
      update,
    );
    // Uploaded bytes now live on the server; drop the local copies.
    out.filter((s) => s.state === 'uploaded').forEach(deleteLocal);
    setBusy(false);
    qc.invalidateQueries({ queryKey: ['evidence', p.id] });
  }

  const queued = uploadQueue(segments).length;
  const visible = segments.filter((s) => s.state !== 'removed' && s.state !== 'uploaded');
  return (
    <Section title="Evidence">
      {cap.available ? (
        <Card testID="recorder-card">
          <Text variant="small" tone="muted">Android asks for screen-capture permission each time. A notification shows while recording, and you can stop from the status bar.</Text>
          {recording ? (
            <Button label="Stop recording" icon={Square} variant="danger" onPress={stopRecording} testID="record-stop" />
          ) : (
            <Button label="Start screen recording" icon={Video} onPress={startRecording} testID="record-start" />
          )}
        </Card>
      ) : (
        <Notice tone="warning" title="Recording unavailable" testID="recording-unavailable">{cap.reason}</Notice>
      )}
      <Button label="Attach screenshot or clip" icon={Paperclip} variant="secondary" onPress={attach} testID="attach-evidence" />
      {stopped ? (
        <Notice tone="warning" title="Recording stopped" testID="recording-stopped">
          Android stopped the recording (status-bar control or screen lock). Your clip so far is below for review.
        </Notice>
      ) : null}
      {error ? <Notice tone="danger" title="Evidence" testID="evidence-error">{error}</Notice> : null}
      {visible.length > 0 ? (
        <Notice tone="info" title="Review before upload">Nothing leaves this device until you keep it and tap Upload. Removed items are deleted here and never uploaded.</Notice>
      ) : null}
      {visible.map((s) => (
        <Card key={s.id} testID={`segment-${s.state}`}>
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="heading" numberOfLines={1} style={{ flex: 1 }}>{s.name}</Text>
            <StatusPill status={s.state === 'kept' ? 'confirmed' : s.state === 'failed' ? 'failed' : s.state === 'uploading' ? 'pending' : 'awaiting_signature'} label={s.state === 'recorded' ? 'Not reviewed' : s.state} />
          </Row>
          {s.uri ? <MediaPreview uri={s.uri} mimeType={s.mimeType} testID="segment-preview" /> : null}
          <Text variant="small" tone="muted">{s.mimeType}{s.size ? ` · ${bytes(s.size)}` : ''}</Text>
          {s.error ? <Text variant="small" tone="danger">{s.error}</Text> : null}
          <Row>
            {s.state === 'recorded' ? <Button label="Keep" icon={Check} onPress={() => keep(s.id)} testID="segment-keep" /> : null}
            {s.state !== 'uploading' ? <Button label="Remove" icon={Trash2} variant="danger" onPress={() => remove(s.id)} testID="segment-remove" /> : null}
          </Row>
        </Card>
      ))}
      {queued > 0 ? <Button label={`Upload ${queued} kept item${queued === 1 ? '' : 's'}`} icon={Upload} onPress={uploadAll} loading={busy} testID="upload-kept" /> : null}
      <QueryState query={uploaded}>
        {(d) =>
          d.items.length ? (
            <Card testID="uploaded-evidence">
              <Text variant="heading">Uploaded ({d.items.length})</Text>
              {d.items.map((e) => (
                <Text key={e.id} variant="small" tone="muted">{e.kind === 'screen_recording' ? 'Recording' : 'Screenshot'} · {e.mimeType} · {bytes(e.sizeBytes)} · {when(e.createdAt)}</Text>
              ))}
            </Card>
          ) : (
            <Text variant="small" tone="muted">No evidence uploaded yet.</Text>
          )
        }
      </QueryState>
    </Section>
  );
}

function Decision({ p }: { p: Participation }) {
  const findings = useFindings(p.id);
  const disputes = useMyDisputes();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const dispute = useMutation({
    mutationFn: () => api('openDispute', { body: { participationId: p.id, reason } }),
    onSuccess: () => {
      setOpen(false);
      qc.invalidateQueries({ queryKey: ['participation', p.id] });
      qc.invalidateQueries({ queryKey: ['myDisputes'] });
    },
  });
  const mine = disputes.data?.items.find((d) => d.participationId === p.id);
  const windowEnds = p.decidedAt ? Date.parse(p.decidedAt) + DISPUTE_WINDOW_MS : 0;
  const canDispute = p.status === 'rejected' && Date.now() < windowEnds;
  return (
    <>
      {p.status === 'submitted' ? <Notice tone="info" title="Awaiting review" testID="awaiting-review">The builder will approve or reject your work. You’ll see the decision here.</Notice> : null}
      {p.status === 'approved' ? (
        <Notice tone="success" title="Approved" testID="approved-notice">{`${credits(p.rewardCredits)} added to your balance. Test credits have no cash value.`}</Notice>
      ) : null}
      {p.status === 'rejected' ? (
        <Notice tone="danger" title="Rejected" testID="rejected-notice">{`Reason: ${p.decisionReason ?? '—'}`}</Notice>
      ) : null}
      {mine ? (
        <Card testID="dispute-card">
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="heading">Your dispute</Text>
            <StatusPill status={mine.status} />
          </Row>
          {mine.outcome ? <Text>{mine.outcome === 'overturned' ? 'Overturned: the reward was credited.' : 'Upheld: the rejection stands.'} {mine.resolutionNote}</Text> : <Text variant="small" tone="muted">An admin will review it.</Text>}
        </Card>
      ) : null}
      {canDispute ? (
        <>
          <Text variant="small" tone="muted">You can dispute until {when(new Date(windowEnds).toISOString())}.</Text>
          <Button label="Dispute this decision" icon={Flag} variant="secondary" onPress={() => setOpen(true)} testID="dispute-open" />
        </>
      ) : null}
      <ConfirmSheet visible={open} title="Dispute the rejection" body="Explain why the rejection is wrong. An admin reviews disputes." confirmLabel="Send dispute" onCancel={() => setOpen(false)} onConfirm={() => dispute.mutate()} confirmDisabled={reason.trim().length < 10} loading={dispute.isPending}>
        <Field label="Reason" value={reason} onChangeText={setReason} multiline testID="dispute-reason" hint="At least 10 characters." />
        {dispute.error ? <Notice tone="danger" title="Couldn’t send">{(dispute.error as ApiError).message}</Notice> : null}
      </ConfirmSheet>
      {p.status === 'approved' || p.status === 'resolved' ? <TransferCard participationId={p.id} role="tester" canStart={false} /> : null}
      {findings.data?.items.length ? (
        <Section title="Findings from the builder">
          {findings.data.items.map((f) => (
            <Card key={f.id}>
              <Row style={{ justifyContent: 'space-between' }}>
                <Text variant="heading">{f.title}</Text>
                <StatusPill status={f.severity === 'blocker' ? 'failed' : f.severity === 'major' ? 'pending' : 'resolved'} label={f.severity} />
              </Row>
              <Text variant="small">{f.description}</Text>
            </Card>
          ))}
        </Section>
      ) : null}
    </>
  );
}

function Session({ p, study }: { p: Participation; study: TesterStudyView }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<null | 'submit' | 'withdraw'>(null);
  const [pendingEvidence, setPendingEvidence] = useState(0);
  const act = useMutation({
    mutationFn: (a: 'start' | 'submit' | 'withdraw') =>
      a === 'start' ? api('startParticipation', { params: { id: p.id } }) : a === 'submit' ? api('submitParticipation', { params: { id: p.id } }) : api('withdrawParticipation', { params: { id: p.id }, body: {} }),
    onSuccess: (np) => {
      setConfirm(null);
      qc.setQueryData(['participation', p.id], np);
      qc.invalidateQueries({ queryKey: ['participations'] });
    },
  });
  return (
    <>
      <Row style={{ justifyContent: 'space-between' }}>
        <StatusPill status={p.status} label={statusLabel[p.status]} testID="session-status" />
        <Text variant="small" tone="muted">{credits(p.rewardCredits)} · {REWARD_DISCLAIMER}</Text>
      </Row>
      <Text variant="display">{study.title}</Text>
      {p.status === 'consented' ? (
        <Card>
          <Text>You consented on {when(p.consentedAt)}. Start when you’re ready to do the tasks.</Text>
          <Button label="Start session" icon={Play} onPress={() => act.mutate('start')} loading={act.isPending} testID="session-start" />
        </Card>
      ) : null}
      {act.error ? <Notice tone="danger" title="Action failed" testID="session-error">{(act.error as ApiError).message}</Notice> : null}
      <TaskNotes p={p} study={study} />
      {p.status === 'in_progress' ? <EvidenceCapture p={p} onPendingChange={setPendingEvidence} /> : null}
      {p.status === 'in_progress' ? (
        <Section title="Finish">
          {pendingEvidence > 0 ? (
            <Notice tone="warning" title="Evidence not uploaded yet" testID="pending-evidence">
              {`Stop any recording, then upload or remove ${pendingEvidence} item${pendingEvidence === 1 ? '' : 's'} before submitting. Submitting locks your evidence.`}
            </Notice>
          ) : null}
          <Button label="Submit for review" icon={Send} onPress={() => setConfirm('submit')} disabled={pendingEvidence > 0} testID="session-submit" />
        </Section>
      ) : null}
      {p.status === 'consented' || p.status === 'in_progress' ? (
        <Button label="Withdraw from study" icon={X} variant="ghost" onPress={() => setConfirm('withdraw')} testID="session-withdraw" />
      ) : null}
      {p.status === 'withdrawn' ? <EmptyState icon={Circle} title="You withdrew" body={p.decisionReason ?? 'This session is closed. Nothing more is needed from you.'} /> : null}
      <Decision p={p} />
      <ConfirmSheet
        visible={confirm !== null}
        title={confirm === 'submit' ? 'Submit for review?' : 'Withdraw from this study?'}
        body={confirm === 'submit' ? 'After you submit, your notes and evidence are locked. Upload any kept items first.' : 'Your slot is released. You can’t rejoin this study.'}
        confirmLabel={confirm === 'submit' ? 'Submit' : 'Withdraw'}
        destructive={confirm === 'withdraw'}
        loading={act.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && act.mutate(confirm)}
      />
    </>
  );
}

function ParticipationScreenInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pq = useParticipation(id);
  const studyId = pq.data?.studyId ?? '';
  const sq = useTesterStudy(studyId);
  const both = useMemo(
    () => ({
      isLoading: pq.isLoading || (!!studyId && sq.isLoading),
      error: pq.error ?? sq.error,
      data: pq.data && sq.data ? { p: pq.data, s: sq.data } : undefined,
      refetch: () => Promise.all([pq.refetch(), sq.refetch()]),
    }),
    [pq, sq, studyId],
  );
  const { colors } = useTheme();
  return (
    <Screen testID="participation-screen">
      <View style={{ gap: space.md, backgroundColor: colors.background }}>
        <QueryState query={both}>{({ p, s }) => <Session p={p} study={s} />}</QueryState>
      </View>
    </Screen>
  );
}

export default function ParticipationScreen() {
  return (
    <RequireRole role="tester">
      <ParticipationScreenInner />
    </RequireRole>
  );
}
