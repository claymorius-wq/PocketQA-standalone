import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RequireRole } from '../../src/screens/RequireRole';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import { Circle, Flag, Paperclip, Play, Send, Upload, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PermissionsAndroid, Platform, StyleSheet, Text as RNText, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { REWARD_DISCLAIMER, type Participation, type TesterStudyView } from '@pocket-qa/contracts';
import { DISPUTE_WINDOW_MS, uploadQueue } from '@pocket-qa/domain';
import { api, ApiError, uploadEvidence } from '../../src/api/client';
import { MediaPreview } from '../../src/evidence/MediaPreview';
import { nativeRecorder } from '../../src/evidence/recorder';
import { WebRecorderCard } from '../../src/evidence/WebRecorderCard';
import { applySegment, removeSegment, uploadKept, type LocalSegment } from '../../src/evidence/segments';
import { GlassBlur, GlassSurface, useUplight } from '../../src/glass';
import { GlassTile } from '../../src/icons';
import { TransferCard } from '../../src/wallet/TransferCard';
import { useSession } from '../../src/auth/SessionProvider';
import { recordingCapability } from '../../src/lib/capability';
import { bytes, credits, statusLabel, when } from '../../src/lib/format';
import { rewardText } from '../../src/lib/money';
import { PaymentStateCard } from '../../src/screens/PaymentState';
import { useEvidence, useFindings, useMyDisputes, useParticipation, useTesterStudy } from '../../src/lib/queries';
import { takeHandoff } from '../../src/motion/entrance';
import { DUR, SIGNATURE, UPLIGHT } from '../../src/theme/motion';
import { useTheme } from '../../src/theme/ThemeProvider';
import { layout, radius, space } from '../../src/theme/tokens';
import { Button, ConfirmSheet, EmptyState, Field, Notice, QueryState, Screen, StatusPill, Text, useScreenFocused } from '../../src/ui';
import { ClipRow, GlideList, Hairline, RecordControl, ReviewNotice, SectionHeader, TaskList, UnderGlow, type CommitStatus, type TaskListProps } from '../../src/ui/patterns';
import { Enter, useMountedLate } from '../../src/ui/screen';

// Your session (A-Session board, Direction A v2; CONSISTENCY round 4). One screen, every status:
// - Consented: the consent card, the task card, Withdraw, and "Start session" in the floating
//   L3 dock (the board's dock; S4 sweeps the primary after U2's pass on the consent card and when
//   it fires; it is never lit).
// - In progress: the task card with the notes wells, Evidence (the recorder with U3 Live and the
//   S2 breathing core, the review-before-upload clips gliding as they leave, Upload, Uploaded) and
//   Finish. Submit confirmed is U4: the wells sink (Lock), the Commit pass rises under Submit, the
//   sections leave, and "Awaiting review" takes their place.
// - Decided: the outcome leads (Awaiting review; Approved with U5 Earned; Rejected and the dispute
//   with U6 Earned on an overturn), then the devnet transfer, the findings and a recap of the tasks.
// - Withdrawn: the empty panel, then the recap of the tasks (as on main: saved notes stay readable).
//
// RN adaptation: the board floats "Submit for review" in the dock too. Here Submit sits at the end
// of the Finish section instead: the Screen's dock floats over the scrolled content (it ends the
// content above it, but the content scrolls under it), so it would sit over the recorder and clip
// controls the Maestro B1 flows scroll to and tap (record-start/stop, segment-keep, upload-kept).
// The consented dock (the Screen's `dock`) covers nothing those flows tap, and keeps "Start
// session" on screen.

const PICK_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/webm'];
const platform = (Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'web') as LocalSegment['capturedOn'];
const RECORDER_HELP = 'Android asks for screen-capture permission each time. A notification shows while recording, and you can stop from the status bar.';

/** The board's section gap (main `gap: 24`). */
const SECTION_GAP = space.xl;

/**
 * U4 (§10.2): the Lock and the Commit pass start once the sheet has left (240ms native exit; web
 * unmounts it at once), the sections leave at +1060 and "Awaiting review" replaces them at +1300.
 */
const U4 = { leave: 1060, release: 1300 } as const;
const SHEET_GONE = Platform.OS === 'web' ? 0 : DUR.swap;

/** An Earned rise (560 up, 700 down to rest) starts 120ms after its decision arrives. */
const EARNED_DELAY = 120;

/**
 * U5 / U6 rise only when the decision arrives while this screen is in view (CONSISTENCY §M3): a
 * refetch turns `on` from false to true while the screen is focused. A decision that is already
 * there when the component mounts (a revisit, an app restart) or that arrives while another
 * screen covers this one shows at rest. Call it in a component that stays mounted across the change.
 */
function useArrivesInView(on: boolean): boolean {
  const focused = useScreenFocused();
  // React's "previous render" pattern: the rise is known in the same render that shows the
  // decision, so the lit subject mounts rising instead of resting for a frame.
  const [prev, setPrev] = useState(on);
  const [rise, setRise] = useState(false);
  if (on !== prev) {
    setPrev(on);
    if (on && focused) setRise(true);
  }
  return on && rise;
}

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

/** Content that mounts after the screen's entrance (a new section, a decision) rises in by itself. */
function Arrive({ delay = 0, children }: { delay?: number; children: ReactNode }) {
  const late = useMountedLate();
  return late ? (
    <Enter step={0} delay={delay}>
      {children}
    </Enter>
  ) : (
    <>{children}</>
  );
}

/** A section: the heading with its fading rule, then the content. */
function Block({ title, gap = 12, children, testID }: { title: string; gap?: number; children: ReactNode; testID?: string }) {
  return (
    <View style={{ gap }} testID={testID}>
      <SectionHeader title={title} rule />
      {children}
    </View>
  );
}

function SessionHeader({ p, study }: { p: Participation; study: TesterStudyView }) {
  const { colors, type } = useTheme();
  return (
    <View style={styles.header}>
      <StatusPill status={p.status} label={statusLabel[p.status]} testID="session-status" />
      <View style={styles.headerText}>
        <Text variant="display">{study.title}</Text>
        <RNText style={[type.disclaimer, { color: colors.textMuted }]}>
          <RNText style={{ color: colors.text }}>{rewardText(p.reward)}</RNText> · {REWARD_DISCLAIMER}
        </RNText>
      </View>
    </View>
  );
}

/** U2 starts once the push has landed (dur-enter). */
const U2_AT = DUR.enter;
/** The Commit pass (560 up, hold 120, 700 down) after U2_AT, then a margin before the hand-off is spent. */
const LANDED = U2_AT + UPLIGHT.commit.rise + UPLIGHT.commit.hold + UPLIGHT.commit.fall + 100;
/** "Start session" stays unlit and gets only S4, after the pass (CONSISTENCY §U, spec §13). */
const START_SWEEP_AT = U2_AT + 600;

/**
 * The consent confirmation. U2's subject (CONSISTENCY §U): when Study's join hands over (§M3 `u2`),
 * the full Commit pass plays here in Mode A once the push has landed: the uplit layer, and the
 * under-glow with the five motes. The hand-off is spent once the pass has played on this card, so
 * a later remount (Retry, the dock toggling) shows the card at rest. The timer starts with the
 * card, not the screen, so a slow load does not use it up before the card is seen.
 */
function ConsentCard({ p, landing, onLanded }: { p: Participation; landing: boolean; onLanded: () => void }) {
  const light = useUplight('commit', landing, { delay: U2_AT });
  useEffect(() => {
    if (!landing) return;
    const t = setTimeout(onLanded, LANDED);
    return () => clearTimeout(t);
  }, [landing, onLanded]);
  return (
    // ≥ 32dp of ground below the lit card (§U): 8 here plus the 24dp section gap.
    <View style={landing ? styles.litWrap : null}>
      {landing ? <UnderGlow light={light} motes /> : null}
      {/* No label on the surface: TalkBack reads the sentence inside it, as before. */}
      <GlassSurface level="card" uplight={landing && light.enabled ? light.u : undefined} style={styles.consent}>
        <GlassTile name="consent" size="list" tint="info" />
        <Text style={styles.flex}>You consented on {when(p.consentedAt)}. Start when you’re ready to do the tasks.</Text>
      </GlassSurface>
    </View>
  );
}

function TaskNotes({ p, study, locked }: { p: Participation; study: TesterStudyView; locked: boolean }) {
  const qc = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>(() => Object.fromEntries(p.taskNotes.map((n) => [n.taskId, n.note])));
  const save = useMutation({
    mutationFn: (taskId: string) => api('putTaskNote', { params: { id: p.id, taskId }, body: { note: drafts[taskId] ?? '' } }),
    onSuccess: (np) => qc.setQueryData(['participation', p.id], np),
  });
  return (
    <TaskListSection
      study={study}
      renderStep={(t, i) => {
        const saved = p.taskNotes.find((n) => n.taskId === t.id)?.note ?? '';
        const dirty = (drafts[t.id] ?? '') !== saved;
        return (
          <Arrive delay={80}>
            <View style={styles.notes}>
              {/* The Lock (U4, §11.5): each notes well sinks into the pressed look, 40ms apart, once the sheet has left. */}
              <Field
                label="Your notes"
                value={drafts[t.id] ?? ''}
                onChangeText={(v) => setDrafts((d) => ({ ...d, [t.id]: v }))}
                multiline
                placeholder="What did you expect? Where did you hesitate?"
                testID={`task-note-${i}`}
                locked={locked}
                lockDelay={SHEET_GONE + i * SIGNATURE.lockStep}
              />
              <View style={styles.noteActions}>
                {dirty ? (
                  <Button label="Save note" variant="secondary" disabled={locked} loading={save.isPending && save.variables === t.id} onPress={() => save.mutate(t.id)} testID={`task-note-save-${i}`} />
                ) : (
                  <Button label="Saved" icon="approve" variant="ghost" disabled onPress={() => undefined} testID={`task-note-save-${i}`} style={styles.saved} />
                )}
              </View>
              {save.error && save.variables === t.id ? <Notice tone="danger" title="Note not saved">{(save.error as ApiError).message}</Notice> : null}
            </View>
          </Arrive>
        );
      }}
    />
  );
}

/** The task card (Consented, In progress): the one TaskList stepper (label, instruction, criteria). */
function TaskListSection({ study, renderStep }: { study: TesterStudyView; renderStep?: TaskListProps['renderStep'] }) {
  return (
    <Block title="Tasks">
      <TaskList tasks={study.tasks} renderStep={renderStep} />
    </Block>
  );
}

/** Decided states lead with the outcome; the tasks come back as a compact read-only recap. */
function TaskRecap({ p, study }: { p: Participation; study: TesterStudyView }) {
  return (
    <Block title="Tasks">
      <GlassSurface level="card" k={0.8} role="list" style={styles.recapCard}>
        {study.tasks.map((t, i) => {
          const saved = p.taskNotes.find((n) => n.taskId === t.id)?.note ?? '';
          return (
            <View key={t.id} role="listitem" testID={`task-${i}`} style={styles.recapStep}>
              {i > 0 ? <Hairline inset={0} style={styles.recapRule} /> : null}
              <Text variant="label" tone="muted">TASK {i + 1}</Text>
              <Text variant="headingNotice">{t.instruction}</Text>
              {t.successCriteria ? <Text variant="small" tone="muted">Done when: {t.successCriteria}</Text> : null}
              {saved ? <Text variant="bodySm" tone="muted">Your notes: {saved}</Text> : null}
            </View>
          );
        })}
      </GlassSurface>
    </Block>
  );
}

function EvidenceCapture({ p, onPendingChange, locked }: { p: Participation; onPendingChange: (n: number) => void; locked: boolean }) {
  const qc = useQueryClient();
  const { colors, type } = useTheme();
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
  const attachButton = <Button label="Attach screenshot or clip" icon={Paperclip} variant="secondary" onPress={attach} disabled={locked} testID="attach-evidence" />;
  return (
    <Block title="Evidence" gap={10}>
      {/* Above the recorder, so the reason shows where the user just tapped (a declined capture
          dialog left it off-screen below the card on the Lens layout; native run 2026-10-04). */}
      {error ? <Notice tone="danger" title="Evidence" testID="evidence-error">{error}</Notice> : null}
      {cap.available ? (
        // U3 Live and S2: the card is lit from below and the core breathes while recording.
        <RecordControl live={recording} onStart={startRecording} onStop={stopRecording} help={RECORDER_HELP} startDisabled={locked}>
          {attachButton}
        </RecordControl>
      ) : Platform.OS === 'web' ? (
        // Desktop browsers: the local-only screen and narration recorder (never uploaded);
        // mobile and unsupported browsers get its honest reason. Native above is unchanged.
        <>
          <WebRecorderCard locked={locked} />
          {attachButton}
        </>
      ) : (
        <>
          <Notice tone="warning" title="Recording unavailable" testID="recording-unavailable">{cap.reason}</Notice>
          {attachButton}
        </>
      )}
      {stopped ? (
        <Notice tone="warning" title="Recording stopped" testID="recording-stopped">
          Android stopped the recording (status-bar control or screen lock). Your clip so far is below for review.
        </Notice>
      ) : null}
      {visible.length > 0 ? <ReviewNotice /> : null}
      {/* Rows carry their own 10dp top space and the list pulls up 10, so an empty list takes no gap. */}
      <GlideList gap={0} style={styles.clips}>
        {visible.map((s) => (
          <View key={s.id} style={styles.clip}>
            <ClipRow
              name={s.name}
              mimeType={s.mimeType}
              size={s.size}
              state={s.state}
              error={s.error ?? undefined}
              preview={s.uri ? <MediaPreview uri={s.uri} mimeType={s.mimeType} testID="segment-preview" /> : null}
              onKeep={locked ? undefined : () => keep(s.id)}
              onRemove={locked ? undefined : () => remove(s.id)}
            />
          </View>
        ))}
      </GlideList>
      {queued > 0 ? <Button label={`Upload ${queued} kept item${queued === 1 ? '' : 's'}`} icon={Upload} variant="secondary" onPress={uploadAll} loading={busy} disabled={locked} testID="upload-kept" /> : null}
      <QueryState query={uploaded}>
        {(d) =>
          d.items.length ? (
            <GlassSurface level="card" k={0.8} testID="uploaded-evidence" style={styles.uploaded}>
              <Text variant="heading">Uploaded ({d.items.length})</Text>
              <GlideList gap={8}>
                {d.items.map((e) => (
                  // One line of text per item (the e2e flows match "Recording · video/mp4"), set in
                  // the board's locked row: the pressed recipe, kind first.
                  <GlassSurface key={e.id} level="pressed" radius={radius.well} grain={false} style={styles.uploadedRow}>
                    <RNText style={[type.small, { color: colors.textMuted }]}>
                      <RNText style={[type.headingNotice, styles.uploadedKind, { color: colors.text }]}>{e.kind === 'screen_recording' ? 'Recording' : 'Screenshot'}</RNText> · <RNText style={type.meta}>{e.mimeType}</RNText> · <RNText style={type.meta}>{bytes(e.sizeBytes)}</RNText> · <RNText style={type.meta}>{when(e.createdAt)}</RNText>
                    </RNText>
                  </GlassSurface>
                ))}
              </GlideList>
            </GlassSurface>
          ) : (
            <Text variant="small" tone="muted" style={styles.inset}>No evidence uploaded yet.</Text>
          )
        }
      </QueryState>
    </Block>
  );
}

/** U5 (Earned, Mode A): the Approved notice is lit from below (the kit Notice's `uplight`); it rises only when the approval arrives in view. */
function ApprovedNotice({ p, rise }: { p: Participation; rise: boolean }) {
  const light = useUplight('earned', true, { startAtRest: !rise, delay: EARNED_DELAY });
  return (
    // ≥ 32dp of ground below a lit subject (§U): 8 here plus the 24dp section gap.
    <View style={styles.litWrap}>
      <Notice tone="success" title="Approved" testID="approved-notice" uplight={light}>
        {p.reward.kind === 'token'
          ? 'The reward is released from the study escrow to the wallet you confirmed when you joined. Its state is below.'
          : `${credits(p.rewardCredits)} added to your balance. Test credits have no cash value.`}
      </Notice>
      {p.payout ? <PaymentStateCard payout={p.payout} /> : null}
    </View>
  );
}

type MyDispute = NonNullable<ReturnType<typeof useMyDisputes>['data']>['items'][number];

/** The tester's dispute; U6 (Earned, Mode A on this card) when the rejection is overturned. */
function DisputeCard({ dispute }: { dispute: MyDispute }) {
  const { colors } = useTheme();
  const over = dispute.outcome === 'overturned';
  const rise = useArrivesInView(over);
  const light = useUplight('earned', over, { startAtRest: !rise, delay: EARNED_DELAY });
  return (
    <View style={over ? styles.litWrap : null}>
      {over ? <UnderGlow light={light} /> : null}
      <GlassSurface level="card" uplight={over && light.enabled ? light.u : undefined} testID="dispute-card" style={styles.disputeCard}>
        <View style={styles.disputeHead}>
          <GlassTile name="disputes" size="list" />
          <Text variant="heading" style={styles.flex}>Your dispute</Text>
          <StatusPill status={dispute.status} />
        </View>
        {dispute.outcome ? (
          <Text>
            {dispute.outcome === 'overturned' ? 'Overturned: the reward was credited.' : 'Upheld: the rejection stands.'}{' '}
            <RNText style={{ color: colors.textMuted }}>{dispute.resolutionNote}</RNText>
          </Text>
        ) : (
          <Text variant="bodySm" tone="muted">An admin will review it.</Text>
        )}
      </GlassSurface>
    </View>
  );
}

function Decision({ p }: { p: Participation }) {
  // Devnet demo transfers are a development feature; production never shows them (ledger D4).
  const { features } = useSession();
  const findings = useFindings(p.id);
  const disputes = useMyDisputes();
  const qc = useQueryClient();
  const { colors, type } = useTheme();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  // Decision stays mounted from Awaiting review to the decision, so it sees the approval arrive.
  const approvedInView = useArrivesInView(p.status === 'approved');
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
      {/* A Notice that mounts after the screen's arrival rises in by itself. */}
      {p.status === 'approved' ? <ApprovedNotice p={p} rise={approvedInView} /> : null}
      {p.status === 'resolved' && p.payout ? <PaymentStateCard payout={p.payout} testID="payment-state-dispute" /> : null}
      {p.status === 'rejected' ? (
        <View style={styles.rejected}>
          <Notice tone="danger" title="Rejected" testID="rejected-notice">{`Reason: ${p.decisionReason ?? '—'}`}</Notice>
          {canDispute ? (
            <>
              <Text variant="small" tone="muted" style={styles.disputeUntil}>
                You can dispute until <RNText style={[type.meta, { color: colors.textMuted }]}>{when(new Date(windowEnds).toISOString())}</RNText>.
              </Text>
              <Button label="Dispute this decision" icon={Flag} variant="secondary" onPress={() => setOpen(true)} testID="dispute-open" />
            </>
          ) : null}
        </View>
      ) : null}
      {mine ? (
        <Arrive>
          <DisputeCard dispute={mine} />
        </Arrive>
      ) : null}
      <ConfirmSheet
        visible={open}
        title="Dispute the rejection"
        body="Explain why the rejection is wrong. An admin reviews disputes."
        confirmLabel="Send dispute"
        onCancel={() => setOpen(false)}
        onConfirm={() => dispute.mutate()}
        confirmDisabled={reason.trim().length < 10}
        loading={dispute.isPending}
        // C4's failure branch, announced as an alert, with this sheet's own title.
        status={dispute.isError ? 'error' : undefined}
        error={dispute.error ? (dispute.error as ApiError).message : null}
        failureTitle="Couldn’t send"
      >
        <Field label="Reason" value={reason} onChangeText={setReason} multiline locked={dispute.isPending} testID="dispute-reason" hint="At least 10 characters." />
      </ConfirmSheet>
      {features.devnetTransfers && (p.status === 'approved' || p.status === 'resolved') ? (
        <View style={styles.transfer}>
          <TransferCard participationId={p.id} role="tester" canStart={false} />
        </View>
      ) : null}
      {findings.data?.items.length ? (
        <Arrive delay={40}>
          <Block title="Findings from the builder">
            {findings.data.items.map((f) => (
              <GlassSurface key={f.id} level="card" k={0.8} style={styles.finding}>
                <View style={styles.findingHead}>
                  <Text variant="headingNotice" style={styles.flex}>{f.title}</Text>
                  <StatusPill status={f.severity === 'blocker' ? 'failed' : f.severity === 'major' ? 'pending' : 'resolved'} label={f.severity} />
                </View>
                <Text variant="bodySm" tone="muted">{f.description}</Text>
              </GlassSurface>
            ))}
          </Block>
        </Arrive>
      ) : null}
    </>
  );
}

type SessionAct = 'start' | 'submit' | 'withdraw';
type Held = { p: Participation; leaving: boolean };

/**
 * The session's own actions (Start, Submit, Withdraw), shared by the content and the dock. Submit
 * keeps the In progress view on screen for U4 (`held`): the cache takes the server's answer at
 * once, exactly as before; only the view waits for the Lock and the Commit pass to finish.
 */
function useSessionActions(id: string) {
  const qc = useQueryClient();
  const { motion } = useTheme();
  const [confirm, setConfirm] = useState<null | 'submit' | 'withdraw'>(null);
  const [failed, setFailed] = useState<null | 'submit' | 'withdraw'>(null);
  const [held, setHeld] = useState<Held | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));
  const act = useMutation({
    mutationFn: (a: SessionAct) =>
      a === 'start' ? api('startParticipation', { params: { id } }) : a === 'submit' ? api('submitParticipation', { params: { id } }) : api('withdrawParticipation', { params: { id }, body: {} }),
    onSuccess: (np, a) => {
      const prev = qc.getQueryData<Participation>(['participation', id]);
      setConfirm(null);
      if (a === 'submit' && prev?.status === 'in_progress') {
        setHeld({ p: prev, leaving: false });
        if (motion.reduced) {
          // §11.7: Commit shows nothing, so there is no pass to wait for.
          later(() => setHeld(null), DUR.tick);
        } else {
          later(() => setHeld((h) => (h ? { ...h, leaving: true } : h)), SHEET_GONE + U4.leave);
          later(() => setHeld(null), SHEET_GONE + U4.release);
        }
      }
      qc.setQueryData(['participation', id], np);
      qc.invalidateQueries({ queryKey: ['participations'] });
    },
    onError: (_e, a) => {
      if (a !== 'start') setFailed(a);
    },
  });
  const ask = (kind: 'submit' | 'withdraw') => {
    setFailed(null);
    setConfirm(kind);
  };
  // C4: the sheet shows its own failure (the danger notice) only for the request it sent.
  const sheetStatus: CommitStatus = act.isPending ? 'pending' : act.isError && failed !== null && failed === confirm ? 'error' : 'idle';
  return { act, confirm, setConfirm, ask, held, sheetStatus };
}
type SessionActions = ReturnType<typeof useSessionActions>;

function Session({ p, study, actions, landing, onLanded }: { p: Participation; study: TesterStudyView; actions: SessionActions; landing: boolean; onLanded: () => void }) {
  const [pendingEvidence, setPendingEvidence] = useState(0);
  const { act, confirm, setConfirm, ask, held, sheetStatus } = actions;
  const locked = !!held;
  const inProgress = p.status === 'in_progress';
  const decided = p.status === 'submitted' || p.status === 'approved' || p.status === 'rejected' || p.status === 'disputed' || p.status === 'resolved';
  const u4 = useUplight('commit', locked, { delay: SHEET_GONE });
  // The In progress sections leave together once the Commit pass has peaked (U4).
  const leave = useSharedValue(1);
  const { motion } = useTheme();
  useEffect(() => {
    leave.value = held?.leaving ? withTiming(0, motion.timing.exit) : 1;
  }, [held?.leaving, leave, motion]);
  const leaveStyle = useAnimatedStyle(() => ({ opacity: leave.value }));

  return (
    <View style={styles.session}>
      <SessionHeader p={p} study={study} />
      {p.status === 'consented' ? <ConsentCard p={p} landing={landing} onLanded={onLanded} /> : null}
      {act.error ? (
        <View style={p.status === 'consented' ? styles.underConsent : null}>
          <Notice tone="danger" title="Action failed" testID="session-error">{(act.error as ApiError).message}</Notice>
        </View>
      ) : null}
      {p.status === 'withdrawn' ? <EmptyState icon={Circle} title="You withdrew" body={p.decisionReason ?? 'This session is closed. Nothing more is needed from you.'} /> : null}
      {decided ? <Decision p={p} /> : null}
      {decided || p.status === 'withdrawn' ? (
        <Arrive delay={80}>
          <TaskRecap p={p} study={study} />
        </Arrive>
      ) : null}
      {p.status === 'consented' ? (
        <>
          <TaskListSection study={study} />
          <Button label="Withdraw from study" icon={X} variant="ghost" onPress={() => ask('withdraw')} testID="session-withdraw" style={[styles.withdraw, styles.withdrawConsented]} />
        </>
      ) : null}
      {inProgress ? (
        <Animated.View style={[styles.session, leaveStyle]}>
          <TaskNotes p={p} study={study} locked={locked} />
          <Arrive>
            <EvidenceCapture p={p} onPendingChange={setPendingEvidence} locked={locked} />
          </Arrive>
          <Arrive delay={40}>
            <Block title="Finish" gap={10}>
              {pendingEvidence > 0 ? (
                <Notice tone="warning" title="Evidence not uploaded yet" testID="pending-evidence">
                  {`Stop any recording, then upload or remove ${pendingEvidence} item${pendingEvidence === 1 ? '' : 's'} before submitting. Submitting locks your evidence.`}
                </Notice>
              ) : null}
              {/* U4 (Commit, Mode A): Submit sits in flow here (the Maestro adaptation above) with Withdraw
                  below it, so its light is the under-glow with the motes, not a Mode B floor. 22 here
                  plus the 10dp block gap keep 32dp of ground before Withdraw (§U). */}
              <View style={styles.submitWrap}>
                <UnderGlow light={u4} motes />
                {/* `locked` through the U4 hold: presses are ignored and the button is announced busy, its look unchanged. */}
                <Button label="Submit for review" icon={Send} onPress={() => ask('submit')} disabled={pendingEvidence > 0} locked={locked} testID="session-submit" />
              </View>
              <Button label="Withdraw from study" icon={X} variant="ghost" onPress={() => ask('withdraw')} locked={locked} testID="session-withdraw" style={styles.withdraw} />
            </Block>
          </Arrive>
        </Animated.View>
      ) : null}
      <ConfirmSheet
        visible={confirm !== null}
        title={confirm === 'submit' ? 'Submit for review?' : 'Withdraw from this study?'}
        body={confirm === 'submit' ? 'After you submit, your notes and evidence are locked. Upload any kept items first.' : 'Your slot is released. You can’t rejoin this study.'}
        confirmLabel={confirm === 'submit' ? 'Submit' : 'Withdraw'}
        destructive={confirm === 'withdraw'}
        loading={act.isPending}
        status={sheetStatus}
        error={act.error ? (act.error as ApiError).message : null}
        onCancel={() => setConfirm(null)}
        onConfirm={() => confirm && act.mutate(confirm)}
      />
    </View>
  );
}

/**
 * The consented dock (A-Session `fin.dock`): the Screen's `dock`, the L3 overlay floating 12dp in
 * from the edges, holding "Start session". It arrives with the screen (push), or rises in by
 * itself when the data comes later; its blur reads the Screen's content.
 */
function StartDock({ onStart, loading, landing }: { onStart: () => void; loading: boolean; landing: boolean }) {
  const { motion } = useTheme();
  // After U2 (the consent card's pass), "Start session" gets S4 once, at +600; it is never lit.
  const [sweep, setSweep] = useState(0);
  useEffect(() => {
    if (!landing || motion.reduced) return;
    const t = setTimeout(() => setSweep((n) => n + 1), START_SWEEP_AT);
    return () => clearTimeout(t);
  }, [landing, motion.reduced]);
  return (
    <GlassBlur radius={radius.overlay} style={styles.dockSurface}>
      {/* The kit's S4 band, through the Button: press-shifted, and never while disabled or loading. */}
      <Button label="Start session" icon={Play} onPress={onStart} loading={loading} sweepSignal={sweep} testID="session-start" />
    </GlassBlur>
  );
}

function ParticipationScreenInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  // U2's hand-off (§M3): Study's join pass lands on the consent card, once.
  const [landing, setLanding] = useState(() => takeHandoff('u2'));
  const onLanded = useCallback(() => setLanding(false), []);
  const pq = useParticipation(id);
  const studyId = pq.data?.studyId ?? '';
  const sq = useTesterStudy(studyId);
  const actions = useSessionActions(id);
  const both = useMemo(
    () => ({
      isLoading: pq.isLoading || (!!studyId && sq.isLoading),
      error: pq.error ?? sq.error,
      data: pq.data && sq.data ? { p: pq.data, s: sq.data } : undefined,
      refetch: () => Promise.all([pq.refetch(), sq.refetch()]),
    }),
    [pq, sq, studyId],
  );
  // While U4 plays, the screen still shows the session as it was when it was submitted.
  const shown = actions.held?.p ?? both.data?.p;
  const docked = shown?.status === 'consented';
  return (
    <Screen
      testID="participation-screen"
      // The scroll content ends 16 above the floating dock.
      dockClearance={space.lg}
      dock={docked ? <StartDock onStart={() => actions.act.mutate('start')} loading={actions.act.isPending && actions.act.variables === 'start'} landing={landing} /> : null}
    >
      {/* No background here: only the Screen's Ground paints the ground (Lens §2 light model). */}
      <QueryState query={both}>{({ p, s }) => <Session p={actions.held?.p ?? p} study={s} actions={actions} landing={landing} onLanded={onLanded} />}</QueryState>
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

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  session: { gap: SECTION_GAP },
  // Board: the pill, then the title and its meta line; 4dp in from the content edge.
  // marginTop 8: the board's pill sits at main top 112 here (A-Study's is 104).
  header: { gap: 10, marginTop: 8, paddingHorizontal: layout.headerGutter - layout.gutter, alignItems: 'flex-start' },
  headerText: { gap: 6, alignSelf: 'stretch' },
  consent: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingTop: 15, paddingRight: 17, paddingBottom: 15, paddingLeft: 15 },
  // The board pulls the action error up under the consent card (margin-top −12).
  underConsent: { marginTop: -12 },
  notes: { gap: 6, marginTop: 8 },
  noteActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 4 },
  // The board's quiet Saved (padding 0 12): the kit's disabled ghost dims it, so it never reads as tappable.
  saved: { paddingHorizontal: 12 },
  recapCard: { paddingTop: 15, paddingRight: 17, paddingBottom: 17, paddingLeft: 17, gap: 14 },
  recapStep: { gap: 4 },
  recapRule: { top: -7 },
  withdraw: { alignSelf: 'flex-start', paddingLeft: 8, paddingRight: 12, marginLeft: -4 },
  withdrawConsented: { marginTop: -10 },
  clips: { marginTop: -10 },
  clip: { paddingTop: 10 },
  uploaded: { padding: 15, gap: 10 },
  uploadedRow: { paddingTop: 10, paddingRight: 13, paddingBottom: 11, paddingLeft: 13 },
  uploadedKind: { fontSize: 14 },
  inset: { paddingHorizontal: 4 },
  litWrap: { position: 'relative', marginBottom: space.sm },
  submitWrap: { position: 'relative', marginBottom: 22 },
  rejected: { gap: 12 },
  disputeUntil: { marginTop: 2, paddingHorizontal: 4 },
  disputeCard: { paddingTop: 15, paddingRight: 17, paddingBottom: 17, paddingLeft: 15, gap: 12 },
  disputeHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  // The board sets the transfer card 24 further down (48 under a lit decision).
  transfer: { marginTop: space.xl },
  finding: { paddingTop: 15, paddingRight: 17, paddingBottom: 17, paddingLeft: 17, gap: 6 },
  findingHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  dockSurface: { padding: 9 },
});
