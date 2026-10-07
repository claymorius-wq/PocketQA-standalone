import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Compass, Smartphone } from 'lucide-react-native';
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import type { DeviceProfile } from '@pocket-qa/contracts';
import { api } from '../../src/api/client';
import { useSession } from '../../src/auth/SessionProvider';
import { FlutedLens } from '../../src/glass';
import { GradientRule } from '../../src/glass/paint';
import { GlassTile } from '../../src/icons';
import { guessDevice, profileMismatch } from '../../src/lib/device';
import { useFocusRefetch, useEligible } from '../../src/lib/queries';
import { MOTION_DISTANCE } from '../../src/theme/motion';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button, EmptyState, Notice, QueryState, Screen, Text } from '../../src/ui';
import { Clauses, SectionHeader, StudyCard } from '../../src/ui/patterns';

// Discover (A-Discover, Direction A v2; ADR 0006). The header carries the 46dp fluted lens mark
// while studies are listed (the brand mark; the empty panel's lens replaces it, never two lenses
// on a screen). S1, the refraction shimmer, plays when the lens mounts: the first load, or a
// refetch that brings studies back; never on a tab hop or Back (tab scenes stay mounted).
// The U1 hand-off after Sign in is the kit's (Screen reads the tabs layout's ArrivalContext).

/** The Settings segment labels, so the "Matched to" line names the platform the way Settings does. */
const PLATFORM_LABEL: Record<DeviceProfile['platform'], string> = { android: 'Android', ios: 'iOS', web: 'Web' };

/** L1 light distance down the list (§2 cardK): the first card is nearest the key light. */
const CARD_K = [1, 0.8, 0.64] as const;

/** S1 starts 120ms after its host lands (the board's lens.anim delay); the glint follows +220. */
const SHIMMER_DELAY = 120;

/**
 * The footer hairline (board: 120px, transparent → 0.30 → transparent), in the theme's divider
 * colour. Without glass (light) GradientRule draws it as a flat colors.border hairline.
 */
function FooterRule() {
  const { glass } = useTheme();
  const color = glass.divider.stops[0]?.color ?? 'transparent';
  const stops = useMemo(
    () => [
      { offset: 0, color, opacity: 0 },
      { offset: 0.5, color, opacity: 0.3 },
      { offset: 1, color, opacity: 0 },
    ],
    [color],
  );
  return <GradientRule length={120} stops={stops} />;
}

type ListState = 'loading' | 'error' | 'empty' | 'list';

/** Which QueryState branch shows, mirroring QueryState's own order. */
function listState(q: { isLoading: boolean; error: unknown; data: { items: unknown[] } | undefined }): ListState {
  if (q.isLoading) return 'loading';
  if (q.error) return 'error';
  if (q.data === undefined) return 'loading';
  return q.data.items.length === 0 ? 'empty' : 'list';
}

/**
 * A new fetch result re-enters in place (the board's list.a: opacity + 6dp, 240ms ease-lens;
 * reduced motion a 120ms fade). The first state needs nothing: the screen's arrival carries it.
 * A refetch that returns the same kind of result changes nothing, so nothing re-enters.
 */
function useReEnter(key: ListState) {
  const { motion } = useTheme();
  const progress = useSharedValue(1);
  const last = useRef(key);
  useEffect(() => {
    if (last.current === key) return;
    last.current = key;
    progress.value = 0;
    progress.value = withTiming(1, motion.reduced ? motion.timing.tick : motion.timing.swap);
  }, [key, progress, motion]);
  const rise = motion.reduced ? 0 : MOTION_DISTANCE.tabContentRise;
  return useAnimatedStyle(() => ({ opacity: progress.value, transform: [{ translateY: (1 - progress.value) * rise }] }));
}

/** The matched device line (board: 40dp device tile, "Matched to" label, the profile, Edit). */
function DeviceMatch({ device }: { device: DeviceProfile }) {
  const { colors, type } = useTheme();
  const platform = PLATFORM_LABEL[device.platform];
  return (
    <View style={styles.device} testID="device-matched">
      <GlassTile name="device" size="list" />
      <View style={styles.deviceText} accessible accessibilityLabel={`Matched to ${platform}, ${device.osVersion}`}>
        <RNText style={[type.label, { color: colors.textMuted }]}>{'Matched to'.toUpperCase()}</RNText>
        <Clauses parts={[platform, device.osVersion]} numberOfLines={1} style={[type.headingNotice, styles.deviceName, { color: colors.text }]} />
      </View>
      <Button label="Edit" accessibilityLabel="Edit device profile" variant="secondary" size="compact" onPress={() => router.push('/settings')} testID="device-edit" />
    </View>
  );
}

/**
 * Native only: the saved profile evidently came from another device (e.g. saved on the web). Studies
 * that need this phone's details are hidden until it's updated, so say so and offer this phone's
 * details: saved ONLY on this explicit tap (never silently), keeping the saved languages.
 */
function DeviceMismatch({ device }: { device: DeviceProfile }) {
  const { refreshUser } = useSession();
  const qc = useQueryClient();
  const use = useMutation({
    mutationFn: () => api('putDevice', { body: { ...guessDevice(), languages: device.languages } }),
    onSuccess: () => {
      void refreshUser();
      // Eligibility depends on the device profile.
      void qc.invalidateQueries({ queryKey: ['eligible'] });
    },
  });
  return (
    <Notice tone="warning" title="Your device profile was saved from another device" testID="device-mismatch">
      <Text variant="bodySm" tone="muted">
        Some studies may be hidden until it matches this phone.
      </Text>
      <View style={styles.mismatchAction}>
        <Button label="Use this phone’s details" variant="secondary" size="compact" onPress={() => use.mutate()} loading={use.isPending} testID="device-use-this-phone" />
      </View>
    </Notice>
  );
}

export default function Discover() {
  const { user } = useSession();
  const { colors, type } = useTheme();
  const q = useEligible(user?.id);
  useFocusRefetch(q);
  const state = listState(q);
  const reEnter = useReEnter(state);
  const device = user?.device ?? null;
  // The brand mark shows only beside a list: an empty or failed load has its own panel.
  const lens =
    state === 'list' ? (
      <View style={styles.lens}>
        <FlutedLens size={46} shimmerDelay={SHIMMER_DELAY} testID="discover-lens" />
      </View>
    ) : undefined;
  return (
    // `fill`: the content reaches the tab bar, so the list's footer can sit pinned above it (A-Discover).
    <Screen title="Discover" subtitle="Studies that match your device" testID="discover-screen" right={lens} fill>
      {!device ? (
        <Notice tone="warning" title="Add your device profile" testID="device-missing">
          Studies are matched to your self-reported device. Add it in Settings to see what’s available.
        </Notice>
      ) : (
        <>
          {profileMismatch(device) ? <DeviceMismatch device={device} /> : null}
          <DeviceMatch device={device} />
        </>
      )}
      <Animated.View style={[styles.grow, reEnter]} testID="discover-results">
        <QueryState
          query={q}
          empty={(d) =>
            d.items.length === 0 ? (
              <EmptyState
                icon={device ? Compass : Smartphone}
                title={device ? 'No matching studies right now' : 'No device profile yet'}
                body={device ? 'New studies appear here when builders publish them. Check back later.' : 'Add your device in Settings to start matching.'}
                action={!device ? <Button label="Open settings" variant="secondary" onPress={() => router.push('/settings')} testID="open-settings" /> : undefined}
                actionStretch={!device}
              />
            ) : null
          }
        >
          {(d) => (
            <View style={styles.grow}>
              <SectionHeader variant="label" title="Open studies" count={d.items.length} />
              <View style={styles.cards}>
                {d.items.map((s, i) => (
                  <StudyCard
                    key={s.id}
                    title={s.title}
                    objective={s.objective}
                    rewardCredits={s.rewardCredits}
                    rewardUnits={s.reward.kind === 'token' ? s.reward.units : undefined}
                    rewardSettlement={s.reward.kind === 'token' ? s.reward.settlement : undefined}
                    taskCount={s.taskCount}
                    slotsRemaining={s.slotsRemaining}
                    onPress={() => router.push(`/study/${s.id}`)}
                    testID={`study-card-${s.id}`}
                    accessibilityLabel={`Open study ${s.title}`}
                    k={CARD_K[Math.min(i, CARD_K.length - 1)]}
                  />
                ))}
              </View>
              <View style={styles.footer}>
                <FooterRule />
                {/* The board balances this over two lines (text-wrap: balance); Android's balanced break does the same. */}
                <RNText textBreakStrategy="balanced" style={[type.small, styles.footerText, { color: colors.textMuted }]}>New studies appear here when they match your device.</RNText>
              </View>
            </View>
          )}
        </QueryState>
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // The board sets the lens 2dp in from the header's right edge.
  lens: { marginRight: 2 },
  mismatchAction: { marginTop: 10, alignItems: 'flex-start' },
  // 12 between tile, text and Edit; 8 more below the row than the list gap.
  device: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  deviceText: { flex: 1, minWidth: 0, gap: 2 },
  deviceName: { lineHeight: 22 },
  // "Open studies · 1" sits 10 above the first card; cards keep the screen's 14 between them.
  cards: { marginTop: 10, gap: 14 },
  // The results (and the list in them) take the free room of the `fill` Screen.
  grow: { flexGrow: 1 },
  // The board pins this above the tab bar (margin-top auto); a long list still keeps 28 above it.
  footer: { marginTop: 'auto', alignItems: 'center', gap: 12, paddingTop: 28, paddingHorizontal: 24, paddingBottom: 6 },
  // Two balanced lines as on the board ("New studies appear here / when they match your device."),
  // never a lone last word.
  footerText: { textAlign: 'center', maxWidth: 180 },
});
