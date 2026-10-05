import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { Capability } from '../lib/capability';
import { bytes } from '../lib/format';
import { Button, Checkbox, Notice, Text } from '../ui';
import { RecordControl } from '../ui/patterns';
import { downloadLocal } from './localDownload';
import { browserRecorderEnv, MAX_DURATION_MS, webRecordingCapability, WebScreenRecorder, type RecorderState, type StopReason } from './webScreenRecorder';

/**
 * The desktop web recorder in the tester's session (docs/plans/web-screen-audio-recording.md).
 * Screen plus microphone narration, LOCAL ONLY: replay, download or discard; never uploaded.
 * Consent is per session: it lives in this component and resets when the screen unmounts.
 */
const PRIVACY =
  'Everything visible in what you share is recorded, including other apps, notifications and passwords. Choose a single tab or window rather than your whole screen, and close anything private first. ' +
  'Your microphone records your narration; the tab’s or computer’s own sound isn’t recorded. ' +
  'The recording stays on this device in this page: it’s not uploaded. Downloading it is your choice, and Discard deletes it from this page.';
const HELP = 'The browser asks what to share every time, then for the microphone. Stop here, or with the browser’s own “Stop sharing”.';
const ENDED: Partial<Record<StopReason, string>> = {
  'screen-ended': 'You stopped sharing from the browser; the recording up to that point is kept.',
  'mic-ended': 'The microphone stopped (unplugged or blocked); the recording up to that point is kept.',
  'recorder-error': 'The browser stopped the recording unexpectedly; what was captured is kept.',
  'max-duration': `The recording reached the ${MAX_DURATION_MS / 60_000}-minute limit and stopped; it is kept below.`,
  'max-size': 'The recording reached the size limit and stopped; it is kept below.',
};

export function WebRecorderCard({ locked, capability }: { locked: boolean; capability?: Capability }) {
  const cap = useMemo(() => capability ?? webRecordingCapability(), [capability]);
  const [state, setState] = useState<RecorderState>({ kind: 'ready', notice: null });
  const [consented, setConsented] = useState(false);
  const ctl = useRef<WebScreenRecorder | null>(null);
  const fresh = () => new WebScreenRecorder(browserRecorderEnv(), { onChange: setState });
  if (cap.available && !ctl.current) ctl.current = fresh();

  useEffect(() => {
    if (!cap.available) return;
    // Leaving the page also releases the devices and drops the bytes. Read through the ref: a
    // restarted card has a new controller.
    const onHide = () => ctl.current?.dispose();
    if (Platform.OS === 'web') window.addEventListener('pagehide', onHide);
    return () => {
      if (Platform.OS === 'web') window.removeEventListener('pagehide', onHide);
      ctl.current?.dispose();
    };
  }, [cap.available]);

  if (!cap.available) {
    return (
      <Notice tone="warning" title="Recording unavailable" testID="recording-unavailable">
        {cap.reason}
      </Notice>
    );
  }
  const rec = ctl.current!;
  // Closed under a still-mounted card (the page came back from the back/forward cache after
  // pagehide, or sign-out disposed it): say so and offer a fresh start with fresh consent.
  if (state.kind === 'disposed') {
    const restart = () => {
      ctl.current = fresh();
      setConsented(false);
      setState({ kind: 'ready', notice: null });
    };
    return (
      <View style={styles.wrap} testID="web-recorder">
        <Notice tone="warning" title="Recording" testID="web-rec-error">
          This recording was closed (the page was hidden or you signed out). Nothing was kept.
        </Notice>
        <Button label="Start over" icon="record" variant="secondary" onPress={restart} testID="web-rec-restart" />
      </View>
    );
  }
  const recording = state.kind === 'recording';
  const asking = state.kind === 'requesting-screen' || state.kind === 'requesting-mic';
  const busy = asking || state.kind === 'stopping';
  const problem = state.kind === 'error' ? state.message : state.kind === 'ready' ? state.notice : null;

  return (
    <View style={styles.wrap} testID="web-recorder">
      <Notice tone="info" title="Record this session in your browser" testID="web-rec-privacy">
        {PRIVACY}
      </Notice>
      {problem ? (
        <Notice tone={state.kind === 'error' ? 'danger' : 'warning'} title="Recording" testID="web-rec-error">
          {problem}
        </Notice>
      ) : null}
      {state.kind === 'review' ? (
        <Review state={state} onDiscard={() => rec.discard()} />
      ) : (
        <>
          <Checkbox checked={consented} onChange={setConsented} label="For this session, I agree to share a screen I choose and to record my microphone for narration." testID="web-rec-consent" />
          <RecordControl
            live={recording}
            onStart={() => rec.start()}
            onStop={() => rec.stop()}
            help={HELP}
            startDisabled={locked || !consented || busy}
            startLabel="Share screen and start recording"
            liveAnnouncement="Pocket QA is recording what you shared, with your microphone"
            startTestID="web-rec-start"
            stopTestID="web-rec-stop"
            testID="web-rec-control"
          />
          <Status state={state} />
          {/* A prompt may never be answered: the user can always back out (pqa-qa r1 P2-1). */}
          {asking ? <Button label="Cancel" icon="reject" variant="ghost" onPress={() => rec.cancel()} testID="web-rec-cancel" /> : null}
        </>
      )}
    </View>
  );
}

function Status({ state }: { state: RecorderState }) {
  const text =
    state.kind === 'recording'
      ? `Recording · ${clock(state.elapsedMs)} / ${clock(MAX_DURATION_MS)}`
      : state.kind === 'requesting-screen'
        ? 'Choose a tab, window or screen in the browser’s dialog…'
        : state.kind === 'requesting-mic'
          ? 'Allow the microphone in the browser’s prompt for your narration…'
          : state.kind === 'stopping'
            ? 'Finishing the recording…'
            : null;
  if (!text) return null;
  return (
    <View accessibilityLiveRegion="polite">
      <Text variant="bodySm" testID="web-rec-status">
        {text}
      </Text>
    </View>
  );
}

function Review({ state, onDiscard }: { state: Extract<RecorderState, { kind: 'review' }>; onDiscard: () => void }) {
  const ended = ENDED[state.endedBy];
  return (
    <View style={styles.wrap}>
      {ended ? (
        <Notice tone="warning" title="Recording stopped" testID="web-rec-ended">
          {ended}
        </Notice>
      ) : null}
      <Text variant="bodySm" testID="web-rec-review">
        {`Recording ready · ${clock(state.durationMs)} · ${bytes(state.size)}. It stays on this device until you download or discard it.`}
      </Text>
      <Player url={state.url} />
      <View style={styles.row}>
        <Button label="Download recording" icon="download" variant="secondary" onPress={() => downloadLocal(state.url, state.fileName)} testID="web-rec-download" />
        <Button label="Discard recording" icon="remove" variant="ghost" onPress={onDiscard} testID="web-rec-discard" />
      </View>
    </View>
  );
}

/** The browser's own player on the local blob (web); narration plays with it. */
function Player({ url }: { url: string }) {
  return createElement('video', {
    src: url,
    controls: true,
    playsInline: true,
    preload: 'metadata',
    style: { width: '100%', maxHeight: 360, borderRadius: 12, background: '#000' },
    'data-testid': 'web-rec-player',
    ...(Platform.OS === 'web' ? {} : { testID: 'web-rec-player' }),
  });
}

function clock(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
});
