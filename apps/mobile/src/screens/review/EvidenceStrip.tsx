import { useMutation } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, Text as RNText, View, type LayoutChangeEvent } from 'react-native';
import Animated, { interpolate, ReduceMotion, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { Evidence } from '@pocket-qa/contracts';
import { api, ApiError, mediaUrl } from '../../api/client';
import { GlassSurface, Well } from '../../glass';
import { GlassTile } from '../../icons';
import { bytes } from '../../lib/format';
import { usePressMotion } from '../../motion';
import { DUR } from '../../theme/motion';
import { useTheme } from '../../theme/ThemeProvider';
import type { GlassSurface as GlassRecipe } from '../../theme/tokens';
import { FocusPressable, Notice, Spinner, Text } from '../../ui';
import { Meta } from '../../ui/patterns';

// A-Review "Evidence": a 2-up strip of device-framed tiles (173 × 316 on a 390 board). Each tile is
// an L1 card holding a recessed well (the screen reserved up front, so opening one never changes
// the layout); the whole well is the View button, which asks for a short-lived playback link
// exactly as EvidenceItem does. Opening is the screen's signature: the frame is revealed from its
// middle 8% to the full frame (the board's clip-path, here two well-coloured shutters sliding out
// on the UI thread, 420ms ease-lens) while the media fades up from 0.25. Reduced motion: a 120ms fade.

/** The tile's height on the board; the well sits 6dp inside the card. */
export const EVIDENCE_TILE_HEIGHT = 316;
const TILE_GAP = 12;
const FRAME_INSET = 6;
const FRAME_RADIUS = 18;
const MEDIA_RADIUS = FRAME_RADIUS - 1;
/** The clip reveal starts from the middle band: inset(46% 0 46% 0). */
const REVEAL_FROM = 0.46;

// The closed tile's glass (board: a faint diagonal sheen over a translucent violet floor) and its
// pressed layer (C5: a darker floor pressed in). Paint order is first-painted-first. Dark Lens only:
// with glass off (the flat light theme) the face takes the theme's own well and pressed card.
const lin = (angle: number, stops: [number, string, number][]) => ({ kind: 'linear' as const, angle, stops: stops.map(([offset, color, opacity]) => ({ offset, color, opacity })) });
const VIEW_REST: GlassRecipe = {
  radius: MEDIA_RADIUS,
  fill: [
    lin(170, [[0, '#1C1942', 0.55], [1, '#110F2E', 0.35]]),
    lin(118, [[0.34, '#A0BAFF', 0], [0.5, '#A0BAFF', 0.06], [0.64, '#A0BAFF', 0]]),
  ],
  rim: [],
  shadow: 'inset 1px 1px 0 rgba(214,224,255,0.08)',
};
const VIEW_PRESSED: GlassRecipe = {
  radius: MEDIA_RADIUS,
  fill: [lin(170, [[0, '#110F2E', 0.55], [1, '#0C0B24', 0.45]])],
  rim: [],
  shadow: 'inset 3px 4px 10px rgba(2,1,10,0.7)',
};

/** Reports each tile's playback error so the strip can show it under the grid, full width. */
type ErrorReport = (id: string, message: string | null) => void;

export function EvidenceStrip({ items }: { items: Evidence[] }) {
  const [width, setWidth] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const report = useCallback<ErrorReport>((id, message) => {
    setErrors((prev) => {
      if ((prev[id] ?? null) === message) return prev;
      const next = { ...prev };
      if (message === null) delete next[id];
      else next[id] = message;
      return next;
    });
  }, []);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth((prev) => (prev === w ? prev : w));
  };
  const tile = width > 0 ? (width - TILE_GAP) / 2 : 0;
  return (
    <View style={styles.strip}>
      <View testID="evidence-strip" style={styles.grid} onLayout={onLayout}>
        {tile > 0 ? items.map((e, i) => <EvidenceTile key={e.id} e={e} index={i} width={tile} onError={report} />) : null}
      </View>
      <Text variant="small" tone="muted" style={styles.inset}>Playback links expire after 5 minutes.</Text>
      {items
        .filter((e) => errors[e.id])
        .map((e) => (
          <Notice key={e.id} tone="danger" title="Can’t open evidence">
            {errors[e.id]}
          </Notice>
        ))}
    </View>
  );
}

function EvidenceTile({ e, index, width, onError }: { e: Evidence; index: number; width: number; onError: ErrorReport }) {
  const { colors, type } = useTheme();
  const [url, setUrl] = useState<string | null>(null);
  // The same request EvidenceItem makes: a short-lived playback token for this item only.
  const open = useMutation({
    mutationFn: () => api('playbackToken', { params: { id: e.id } }),
    onSuccess: (t) => setUrl(mediaUrl(t.token)),
  });
  const message = open.error ? (open.error as ApiError).message : null;
  useEffect(() => onError(e.id, message), [e.id, message, onError]);
  useEffect(() => () => onError(e.id, null), [e.id, onError]);
  const label = e.kind === 'screen_recording' ? 'Screen recording' : 'Screenshot';
  return (
    <View testID="evidence-item" style={[styles.tile, { width }]}>
      <GlassSurface level="card" k={1} style={styles.card}>
        <Well radius={FRAME_RADIUS} style={styles.frame}>
          {url ? (
            <Reveal>
              <EvidenceMedia uri={url} mimeType={e.mimeType} />
            </Reveal>
          ) : (
            <ViewButton busy={open.isPending} onPress={() => open.mutate()} />
          )}
        </Well>
      </GlassSurface>
      <View style={styles.caption}>
        <View style={styles.captionRow}>
          <RNText {...HIDDEN_TEXT} style={[type.label, styles.index, { color: colors.textMuted }]}>{`#${index + 1}`}</RNText>
          <RNText numberOfLines={1} style={[type.headingNotice, styles.flexText, { color: colors.text }]}>
            {label}
          </RNText>
        </View>
        <Meta>{`${e.capturedOn} · ${bytes(e.sizeBytes)}`}</Meta>
      </View>
    </View>
  );
}

const HIDDEN_TEXT = { accessible: false, importantForAccessibility: 'no-hide-descendants' as const, 'aria-hidden': true };

/** The whole well is the View button: the 54dp eye tile over the label; busy swaps the tile for the spinner. */
function ViewButton({ busy, onPress }: { busy: boolean; onPress: () => void }) {
  const { colors, type, glass } = useTheme();
  const press = usePressMotion(busy);
  const [rest, down] = useMemo<[GlassRecipe, GlassRecipe]>(
    () => (glass.enabled ? [VIEW_REST, VIEW_PRESSED] : [{ ...glass.well, radius: MEDIA_RADIUS }, { ...glass.cardPressed, radius: MEDIA_RADIUS }]),
    [glass],
  );
  return (
    <FocusPressable
      ringRadius={MEDIA_RADIUS}
      testID="evidence-view"
      accessibilityRole="button"
      accessibilityLabel="View"
      accessibilityState={{ busy, disabled: busy }}
      disabled={busy}
      onPress={onPress}
      onPressIn={press.pressIn}
      onPressOut={press.pressOut}
      style={StyleSheet.absoluteFill}
    >
      <GlassSurface recipe={rest} pressed={press.progress} pressShift={press.shift} pressedRecipe={down} grain={false} style={styles.viewFace}>
        <View style={styles.viewGlyph}>{busy ? <Spinner /> : <GlassTile name="eye" size="hero" />}</View>
        <RNText {...HIDDEN_TEXT} style={[type.button, { color: colors.text }]}>View</RNText>
      </GlassSurface>
    </FocusPressable>
  );
}

/**
 * The opening reveal: two shutters in the well's floor colour cover all but the middle 8% of the
 * frame and slide out (420ms ease-lens) while the media fades 0.25 → 1 by 60% of the way.
 */
function Reveal({ children }: { children: ReactNode }) {
  const { colors, motion } = useTheme();
  const [height, setHeight] = useState(0);
  const p = useSharedValue(0);
  const reduced = motion.reduced;
  useEffect(() => {
    p.value = withTiming(1, reduced ? motion.timing.tick : { duration: DUR.sheet, easing: motion.ease.lens, reduceMotion: ReduceMotion.Never });
    // Mount only: the reveal plays once, when the link arrives.
  }, []);
  const media = useAnimatedStyle(() => ({ opacity: reduced ? p.value : interpolate(p.value, [0, 0.6, 1], [0.25, 1, 1]) }));
  const top = useAnimatedStyle(() => ({ transform: [{ translateY: -p.value * height * REVEAL_FROM }] }));
  const bottom = useAnimatedStyle(() => ({ transform: [{ translateY: p.value * height * REVEAL_FROM }] }));
  const onLayout = (e: LayoutChangeEvent) => {
    const h = e.nativeEvent.layout.height;
    setHeight((prev) => (prev === h ? prev : h));
  };
  const shutter = { backgroundColor: colors.well, height: height * REVEAL_FROM };
  return (
    <View style={[styles.media, { backgroundColor: colors.well }]} onLayout={onLayout}>
      <Animated.View style={[StyleSheet.absoluteFill, media]}>{children}</Animated.View>
      {!reduced && height > 0 ? (
        <>
          <Animated.View style={[styles.shutterTop, shutter, top]} />
          <Animated.View style={[styles.shutterBottom, shutter, bottom]} />
        </>
      ) : null}
    </View>
  );
}

/** The media itself, as MediaPreview renders it (same props and testID), fitted to the frame. */
function EvidenceMedia({ uri, mimeType }: { uri: string; mimeType: string }) {
  if (mimeType.startsWith('video/')) return <EvidenceVideo uri={uri} />;
  return <Image source={{ uri }} cachePolicy="none" style={StyleSheet.absoluteFill} contentFit="contain" accessibilityLabel="Evidence preview" testID="evidence-media" />;
}

function EvidenceVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" testID="evidence-media" />;
}

const styles = StyleSheet.create({
  strip: { gap: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', columnGap: TILE_GAP, rowGap: 16 },
  tile: { gap: 10, minWidth: 0 },
  card: { height: EVIDENCE_TILE_HEIGHT, borderRadius: 24, padding: FRAME_INSET },
  frame: { flex: 1 },
  viewFace: { flex: 1, borderRadius: MEDIA_RADIUS, alignItems: 'center', justifyContent: 'center', gap: 12 },
  viewGlyph: { width: 54, height: 54, alignItems: 'center', justifyContent: 'center' },
  media: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: MEDIA_RADIUS, overflow: 'hidden' },
  shutterTop: { position: 'absolute', top: 0, left: 0, right: 0, pointerEvents: 'none' },
  shutterBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, pointerEvents: 'none' },
  caption: { gap: 2, paddingHorizontal: 4, minWidth: 0 },
  captionRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, minWidth: 0 },
  index: { letterSpacing: 0 },
  flexText: { flexShrink: 1 },
  inset: { paddingLeft: 4 },
});
