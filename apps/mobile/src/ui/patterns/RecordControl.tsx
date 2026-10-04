import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, StyleSheet, Text as RNText, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { FlutedLens, GlassSurface, useUplight, Well } from '../../glass';
import { HIDDEN, PASS_THROUGH } from '../../glass/paint';
import { GlassTile } from '../../icons';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../button';
import { UnderGlow } from './light';

/** The recorder bay: 104dp, the lens size on screens (flute ≤ 104, ADR 0006 budget). */
const BAY = 104;
/** The lens grows into the bay from this scale as recording starts (transform only, no reflow). */
const LENS_FROM = 0.52;

export type RecordControlProps = {
  /** True between "Start screen recording" and "Stop recording" (the recorder's real state). */
  live: boolean;
  onStart: () => void;
  onStop: () => void;
  /** The OS note under the bay ("Android asks for screen-capture permission each time…"). */
  help: string;
  /** Start is unavailable (evidence locked, a request in flight). Stop is never disabled. */
  startDisabled?: boolean;
  /** Start's weight: `secondary` once the screen's next step is elsewhere (A-Session: Submit is ready). Default primary. */
  startVariant?: 'primary' | 'secondary';
  startLabel?: string;
  stopLabel?: string;
  /** What a screen reader hears when recording starts. */
  liveAnnouncement?: string;
  /** Extra controls under the record button (the Attach button). */
  children?: ReactNode;
  testID?: string;
  startTestID?: string;
  stopTestID?: string;
};

/**
 * The recorder card (A-Session, U3 Live, S2). At rest the 104dp lens bay holds the idle record glyph
 * tile (its core unlit). Recording, the bay becomes the fluted lens with the record core lit from inside and
 * breathing (scale 1 → 1.06, 0.8 → 1 on the 1400ms ease-breathe cycle, ribs drifting), and the
 * card is lit from below in Mode A: the uplit layer and the under-glow breathe 0.72 ↔ 1 with it
 * (the only loop in the product). Stop is the light cut: everything to 0 in 180ms ease-exit,
 * never a gentle fade, because the recording really ended. The live LED is the IN PROGRESS
 * pill's (StatusPill), never redrawn here (C8: the LED lives only on IN PROGRESS and UPLOADING).
 * Reduced motion: the core holds 0.9 and the light 0.86, nothing drifts.
 */
export function RecordControl({
  live,
  onStart,
  onStop,
  help,
  startDisabled = false,
  startVariant = 'primary',
  startLabel = 'Start screen recording',
  stopLabel = 'Stop recording',
  liveAnnouncement = 'Pocket QA is recording your screen',
  children,
  testID = 'recorder-card',
  startTestID = 'record-start',
  stopTestID = 'record-stop',
}: RecordControlProps) {
  const { colors, motion, type } = useTheme();
  const light = useUplight('live', live);
  // Announced once as recording starts (the board's polite status); stopping is silent, the
  // button's label change says it.
  const wasLive = useRef(live);
  useEffect(() => {
    if (live && !wasLive.current) AccessibilityInfo.announceForAccessibility(liveAnnouncement);
    wasLive.current = live;
  }, [live, liveAnnouncement]);
  // The lens mounts the first time recording starts and then stays (hidden layers mount lazily).
  const [lensMounted, setLensMounted] = useState(live);
  if (live && !lensMounted) setLensMounted(true);

  const lens = useSharedValue(live ? 1 : 0);
  useEffect(() => {
    // In: 320ms ease-lens (reduced: the 120ms fade). Out: the light cut, 180ms ease-exit.
    lens.value = withTiming(live ? 1 : 0, live ? motion.timing.enter : motion.timing.cut);
  }, [live, lens, motion]);
  const lensStyle = useAnimatedStyle(() => ({
    opacity: lens.value,
    transform: [{ scale: motion.reduced ? 1 : LENS_FROM + (1 - LENS_FROM) * lens.value }],
  }));
  // The idle tile leaves in 120ms ease-exit and comes back over 240ms ease-lens.
  const tile = useSharedValue(live ? 0 : 1);
  useEffect(() => {
    tile.value = withTiming(live ? 0 : 1, live ? { ...motion.timing.exit, duration: 120 } : motion.timing.swap);
  }, [live, tile, motion]);
  const tileStyle = useAnimatedStyle(() => ({ opacity: tile.value }));

  return (
    <View style={styles.wrap}>
      <UnderGlow light={light} />
      <GlassSurface level="card" k={0.86} uplight={light.enabled ? light.u : undefined} testID={testID} accessibilityLabel="Screen recording" style={styles.card}>
        <View style={styles.top}>
          <View style={styles.bay} {...HIDDEN}>
            <Well radius={24} style={StyleSheet.absoluteFill} />
            <Animated.View style={[styles.tile, PASS_THROUGH, tileStyle]}>
              {/* At rest the core is not lit (round-4 `recordIdle`); the lit core belongs to recording. */}
              <GlassTile name="recordIdle" size="hero" />
            </Animated.View>
            {lensMounted ? (
              <Animated.View style={[StyleSheet.absoluteFill, PASS_THROUGH, lensStyle]}>
                <FlutedLens size={BAY} recording={live} shimmerOnMount={false} />
              </Animated.View>
            ) : null}
          </View>
          <RNText style={[type.small, styles.help, { color: colors.textMuted }]}>{help}</RNText>
        </View>
        {live ? (
          <Button label={stopLabel} icon="stop" variant="danger" onPress={onStop} testID={stopTestID} />
        ) : (
          <Button label={startLabel} icon="record" variant={startVariant} onPress={onStart} disabled={startDisabled} testID={startTestID} />
        )}
        {children}
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  // ≥ 32dp of ground below a lit subject (§U): 22 here plus the section's 10dp gap.
  wrap: { position: 'relative', marginBottom: 22 },
  card: { padding: 16, gap: 10 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 4 },
  bay: { width: BAY, height: BAY },
  tile: { position: 'absolute', left: (BAY - 54) / 2, top: (BAY - 54) / 2 },
  help: { flex: 1 },
});
