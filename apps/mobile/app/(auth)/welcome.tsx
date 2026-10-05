import { useRouter } from 'expo-router';
import { ArrowRight, LogIn, UserPlus } from 'lucide-react-native';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, ScrollView, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withDelay,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { useSession } from '../../src/auth/SessionProvider';
import { FlutedLens, GlassSurface } from '../../src/glass';
import { PASS_THROUGH } from '../../src/glass/paint';
import { GlassTile } from '../../src/icons';
import { joinWave } from '../../src/motion';
import { introPages, markIntroSeen, noteIntroLeft, pageAt, type IntroPage } from '../../src/onboarding/intro';
import { PREVIEW_BUILD } from '../../src/preview/demoAccounts';
import { SignInDock } from '../../src/screens/authParts';
import { DUR } from '../../src/theme/motion';
import { useTheme } from '../../src/theme/ThemeProvider';
import { layout, radius } from '../../src/theme/tokens';
import { Button, OwnEntrance, Screen, Text } from '../../src/ui';
import { Hairline, PageDots } from '../../src/ui/patterns';
import { Enter, ScreenContext } from '../../src/ui/screen';

// Welcome: the intro a first-time visitor sees before Sign in (src/onboarding/intro.ts). Three
// pages: what Pocket QA is, what a tester does, what a builder does. Swipe, press Next or a dot;
// Skip, Sign in and every way out go to Sign in (or Create an account over it) and remember that
// the intro was seen. Never lit: nothing here is an Uplight moment.
//
// The opening (the launch, §11.3, on a first visit only), ms from mount:
//   0     the light rises first (exposure 0.6 → 1, 700 ease-lens: the Screen's launch)
//   0     the brand lens arrives: opacity 0 → 1 (320) and scale 0.92 → 1 (700 ease-lens), with
//         its S1 shimmer (the scene slides 16 back, the glint crosses at +220)
//   80    the label row rises (the Screen's first step)
//   80    the title, word by word: each word rises out of its own clipped line box, 30 apart,
//         420 ease-lens (S5's masked rise, applied to words; the intro alone)
//   200   the body rises; 240 the dock (dots and Next)
// All of it is done by 700 (the entrance window), the glint excepted, as on Sign in. Reduced
// motion: every step is a 120ms fade in place; no scale, shimmer, word rise or parallax.
//
// Then the pager: the content follows the scroll on the UI thread. Each layer travels a little
// more than its page (DEPTH), so a page arriving comes in as a cascade (title, body, card, then
// its steps) and one leaving clears the same way; the brand lens refracts as it is carried (its
// scene drifts). The label and the dots follow the scroll too. What the pages say to assistive
// tech, the buttons and the announcement change once a page has settled, never mid-scroll.

/** Share of a page width each layer travels beyond its page's own move. */
const DEPTH = { lens: 0.32, title: 0.1, body: 0.18, card: 0.26, row: 0.06 } as const;
/** Content a page away keeps this much less opacity at most. */
const FADE = 0.65;
/** The brand lens scales down this much a page away. */
const LENS_ZOOM = 0.1;
/** Scene drift (px) behind the brand lens's ribs a page away. */
const LENS_DRIFT = 14;
/** The brand lens's arrival scale. */
const LENS_FROM = 0.92;
/** The word rise: first word at the content's first step, 30 apart, 420 each. */
const WORD = { start: 80, step: 30, rise: 420 } as const;
/** Line box of the display title (40/44) plus room for descenders under the clip. */
const WORD_DESCENT = 6;
const WORD_TRAVEL = 44 + WORD_DESCENT;
/** If a programmatic scroll never reports where it settled, the page settles anyway after this. */
const SETTLE_FALLBACK = 900;

type Action = 'next' | 'create' | 'demo';
type Corner = 'skip' | 'sign-in' | null;

export default function Welcome() {
  const router = useRouter();
  const { features } = useSession();
  const { motion } = useTheme();
  const pages = introPages({ testCredits: features.testCredits });
  const count = pages.length;
  // The page that has settled in view; mid-scroll it stays the last one that did.
  const [page, setPage] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { width, height } = size;
  const pager = useAnimatedRef<Animated.ScrollView>();
  const x = useSharedValue(0);
  const reported = useSharedValue(0);
  // Where Next or a dot is taking the pager, until it settles there.
  const target = useRef<number | null>(null);
  const fallback = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Controls that replace one another after the first render fade in (SwapIn).
  const opened = useRef(false);
  useEffect(() => {
    opened.current = true;
    return () => clearTimeout(fallback.current);
  }, []);
  const last = page === count - 1;
  // The shared demo preview has no self-registration (the gate refuses it), so its way in is Sign in.
  const canSignUp = !PREVIEW_BUILD;
  const action: Action = last ? (canSignUp ? 'create' : 'demo') : 'next';
  const corner: Corner = last ? (canSignUp ? 'sign-in' : null) : 'skip';

  const position = useDerivedValue(() => (width > 0 ? x.value / width : 0));
  const drift = useDerivedValue(() => (motion.reduced ? 0 : Math.max(-1, Math.min(1, position.value)) * LENS_DRIFT));

  function settle(p: number) {
    target.current = null;
    clearTimeout(fallback.current);
    setPage(p);
  }

  // The pager's offset drives everything that follows the scroll; a page counts as settled once
  // the offset rests on it (within a pixel), whoever moved it.
  const onScroll = useAnimatedScrollHandler(
    {
      onScroll: (e) => {
        x.value = e.contentOffset.x;
        if (width <= 0) return;
        const p = pageAt(e.contentOffset.x, width, count);
        if (p !== reported.value && Math.abs(e.contentOffset.x - p * width) < 1) {
          reported.value = p;
          scheduleOnRN(settle, p);
        }
      },
    },
    [width, count],
  );

  function show(i: number) {
    const to = Math.min(count - 1, Math.max(0, i));
    if (to === (target.current ?? page)) return;
    target.current = to;
    pager.current?.scrollTo({ x: to * width, animated: !motion.reduced });
    clearTimeout(fallback.current);
    fallback.current = setTimeout(() => {
      reported.value = to;
      settle(to);
    }, SETTLE_FALLBACK);
  }

  function leave(to: 'sign-in' | 'sign-up') {
    void markIntroSeen();
    noteIntroLeft();
    router.replace('/sign-in');
    // Sign up opens over Sign in, so Back from it returns to Sign in rather than leaving the app.
    if (to === 'sign-up') router.push('/sign-up');
  }

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
  };

  // A new width (split screen, a foldable, a resized window) keeps the settled page in view.
  useEffect(() => {
    if (width > 0) pager.current?.scrollTo({ x: page * width, animated: false });
    // Only the width: page changes scroll through show() or the user's own swipe.
  }, [width]);

  // The page that settled is announced: native through the screen reader, web through a polite
  // live region (react-native-web's announceForAccessibility does nothing). Not on mount.
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef(page);
  useEffect(() => {
    if (announced.current === page) return;
    announced.current = page;
    const text = `Page ${page + 1} of ${count}. ${pages[page]?.title ?? ''}`;
    if (Platform.OS === 'web') setAnnouncement(text);
    else AccessibilityInfo.announceForAccessibility(text);
  }, [page, count, pages]);

  return (
    <Screen
      testID="welcome-screen"
      scroll={false}
      // The pager, the last step, takes the free room; each page scrolls if it is taller.
      fill
      dockPlacement="edge"
      // The pages run to the dock's top edge, under its scrim's fade, so a page that scrolls
      // (a short phone, a large text size) fades out there instead of being cut.
      dockClearance={0}
      // Sign in's dock, unlit, the same height on every page (the second way out is in the top row).
      dock={
        <SignInDock>
          <Enter step={4}>
            <View style={styles.dock}>
              <PageDots count={count} current={page} position={position} onSelect={show} testID="intro-dots" dotTestID="intro-dot" />
              <SwapIn key={action} swap={opened.current}>
                {action === 'next' ? (
                  <Button label="Next" icon={ArrowRight} onPress={() => show((target.current ?? page) + 1)} testID="intro-next" />
                ) : action === 'create' ? (
                  <Button label="Create an account" icon={UserPlus} onPress={() => leave('sign-up')} testID="intro-get-started" />
                ) : (
                  <Button label="Explore the demo" icon={LogIn} onPress={() => leave('sign-in')} testID="intro-get-started" />
                )}
              </SwapIn>
            </View>
          </Enter>
        </SignInDock>
      }
    >
      <View key="top" style={styles.top}>
        <View style={styles.labels}>
          {pages.map((p, i) => (
            <PageLabel key={p.key} text={p.label} index={i} position={position} current={i === page} />
          ))}
        </View>
        {/* Skip leaves from any page but the last; there, Sign in is the second way in. */}
        <View style={styles.corner}>
          {corner ? (
            <SwapIn key={corner} swap={opened.current}>
              {corner === 'skip' ? (
                <Button label="Skip" variant="ghost" size="compact" onPress={() => leave('sign-in')} testID="intro-skip" accessibilityHint="Goes to sign in" />
              ) : (
                <Button label="Sign in" variant="ghost" size="compact" onPress={() => leave('sign-in')} testID="intro-sign-in" accessibilityHint="For an account you already have" />
              )}
            </SwapIn>
          ) : null}
        </View>
        {Platform.OS === 'web' ? (
          <View style={styles.announcer} aria-live="polite" testID="intro-announcer">
            <Text variant="small">{announcement}</Text>
          </View>
        ) : null}
      </View>
      <OwnEntrance key="pager">
        <View style={styles.pagerFrame} onLayout={onLayout} testID="intro-pager-frame">
          {width > 0 ? (
            <Animated.ScrollView ref={pager} style={StyleSheet.absoluteFill} horizontal pagingEnabled showsHorizontalScrollIndicator={false} onScroll={onScroll} scrollEventThrottle={16} testID="intro-pager">
              {pages.map((p, i) => (
                // Off-screen pages are hidden from assistive tech, so a screen reader reads the page in view.
                <View key={p.key} style={{ width, height }} aria-hidden={i !== page} testID={`intro-page-${p.key}`}>
                  {/* A page taller than the room (a short phone, a large text size) scrolls, never clips. */}
                  <ScrollView style={styles.fill} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false} testID={`intro-scroll-${p.key}`}>
                    <PageBody page={p} index={i} position={position} width={width} drift={drift} />
                  </ScrollView>
                </View>
              ))}
            </Animated.ScrollView>
          ) : null}
        </View>
      </OwnEntrance>
    </Screen>
  );
}

/**
 * One page. The first page plays the opening (it is the one in view at launch); the others
 * arrive with the scroll, so they carry no entrance of their own.
 */
function PageBody({ page, index, position, width, drift }: { page: IntroPage; index: number; position: SharedValue<number>; width: number; drift: SharedValue<number> }) {
  const opening = index === 0;
  const layer = { position, index, width };
  return (
    <View style={styles.pageBody}>
      {page.key === 'welcome' ? (
        <Parallax {...layer} depth={DEPTH.lens} zoom={LENS_ZOOM} style={styles.lens}>
          <LensArrival>
            <FlutedLens size={104} drift={drift} />
          </LensArrival>
        </Parallax>
      ) : null}
      <View style={styles.copy}>
        <Parallax {...layer} depth={DEPTH.title}>
          {opening ? <RisingTitle text={page.title} /> : <Text variant="display">{page.title}</Text>}
        </Parallax>
        <Parallax {...layer} depth={DEPTH.body}>
          <Opening play={opening} step={3}>
            <Text tone="muted">{page.body}</Text>
          </Opening>
        </Parallax>
      </View>
      {page.steps ? (
        <Parallax {...layer} depth={DEPTH.card}>
          <GlassSurface level="card" k={1} style={styles.card}>
            {page.steps.map((s, i) => (
              <Parallax key={s.title} {...layer} depth={DEPTH.row * (i + 1)}>
                {i > 0 ? <Hairline inset={0} style={styles.rule} /> : null}
                <View style={styles.step}>
                  <GlassTile name={s.glyph} size="list" />
                  <View style={styles.stepText}>
                    <Text variant="heading">{s.title}</Text>
                    <Text variant="small" tone="muted">
                      {s.body}
                    </Text>
                  </View>
                </View>
              </Parallax>
            ))}
          </GlassSurface>
        </Parallax>
      ) : null}
    </View>
  );
}

/** An entrance step on the opening page only; elsewhere its children as they are. */
function Opening({ play, step, children }: { play: boolean; step: number; children: ReactNode }) {
  return play ? <Enter step={step}>{children}</Enter> : <>{children}</>;
}

/** The ms left until `at` on the screen's entrance wave (0 outside a Screen, or once it has passed). */
function useWaveDelay(at: number): number {
  const screen = useContext(ScreenContext);
  const [delay] = useState(() => Math.max(0, at - (screen ? joinWave(screen.wave, Date.now()) : 0)));
  return delay;
}

/** The brand lens's arrival: it fades in and settles from 0.92 while its S1 shimmer plays. */
function LensArrival({ children }: { children: ReactNode }) {
  const { motion } = useTheme();
  const delay = useWaveDelay(0);
  const opacity = useSharedValue(0);
  const scale = useSharedValue(motion.reduced ? 1 : LENS_FROM);
  useEffect(() => {
    opacity.value = withDelay(delay, withTiming(1, motion.reduced ? motion.timing.tick : motion.timing.enter));
    if (!motion.reduced) scale.value = withDelay(delay, withTiming(1, motion.timing.settle));
    // Mount only: the arrival plays once.
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * The opening title, word by word: each word rises out of its own clipped line box. One heading
 * for assistive tech, named by the whole title; the words are hidden from it. Reduced motion: the
 * whole title fades in as an entrance step.
 */
function RisingTitle({ text }: { text: string }) {
  const { motion } = useTheme();
  if (motion.reduced) {
    return (
      <Enter step={0}>
        <Text variant="display">
          {text}
        </Text>
      </Enter>
    );
  }
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={text} style={styles.words} testID="intro-title">
      {text.split(' ').map((word, i) => (
        <RisingWord key={i} word={word} at={WORD.start + i * WORD.step} />
      ))}
    </View>
  );
}

function RisingWord({ word, at }: { word: string; at: number }) {
  const { motion } = useTheme();
  const delay = useWaveDelay(at);
  const rise = useSharedValue(0);
  useEffect(() => {
    rise.value = withDelay(delay, withTiming(1, { duration: WORD.rise, easing: motion.ease.lens, reduceMotion: ReduceMotion.Never }));
    // Mount only.
  }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - rise.value) * WORD_TRAVEL }] }));
  return (
    <View style={styles.wordClip} aria-hidden>
      <Animated.View style={style}>
        <Text variant="display">{word}</Text>
      </Animated.View>
    </View>
  );
}

/**
 * A layer of a page that follows the pager: `d` is how far its page is from view (−1 … 1), and
 * the layer travels `depth` of a page width beyond the page's own move, fading as it goes (and
 * scaling, with `zoom`). Reduced motion: it moves with its page, nothing more.
 */
function Parallax({ position, index, width, depth, zoom = 0, style, children }: { position: SharedValue<number>; index: number; width: number; depth: number; zoom?: number; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const { motion } = useTheme();
  const still = motion.reduced;
  const animated = useAnimatedStyle(() => {
    if (still) return { opacity: 1, transform: [{ translateX: 0 }, { scale: 1 }] };
    const d = Math.max(-1, Math.min(1, position.value - index));
    return { opacity: 1 - FADE * Math.abs(d), transform: [{ translateX: -d * width * depth }, { scale: 1 - zoom * Math.abs(d) }] };
  });
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/** The top row's label for one page: it cross-fades with the scroll, rising in and out by 6. */
function PageLabel({ text, index, position, current }: { text: string; index: number; position: SharedValue<number>; current: boolean }) {
  const style = useAnimatedStyle(() => {
    const d = position.value - index;
    return { opacity: Math.max(0, 1 - Math.abs(d) * 2), transform: [{ translateY: Math.max(-1, Math.min(1, -d)) * 6 }] };
  });
  return (
    <Animated.View style={[styles.label, style]} aria-hidden={!current}>
      <Text variant="label" tone="primary" testID={current ? 'intro-label' : undefined}>
        {text}
      </Text>
    </Animated.View>
  );
}

/**
 * A control that takes another's place (Next → Create an account, Skip → Sign in): it fades in
 * over dur-swap and takes no touches until it has arrived, so a quick second tap meant for the
 * one it replaced can't land on it. Keyed by role, so focus never carries over either. The first
 * one arrives with its entrance step (`swap` false).
 */
function SwapIn({ swap, children }: { swap: boolean; children: ReactNode }) {
  const { motion } = useTheme();
  const [armed, setArmed] = useState(!swap);
  const opacity = useSharedValue(swap ? 0 : 1);
  useEffect(() => {
    if (!swap) return;
    opacity.value = withTiming(1, motion.reduced ? motion.timing.tick : motion.timing.swap);
    const t = setTimeout(() => setArmed(true), motion.reduced ? DUR.tick : DUR.swap);
    return () => clearTimeout(t);
    // Mount only: a swap plays once.
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[style, armed ? null : PASS_THROUGH]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  labels: { flex: 1, height: 48 },
  label: { position: 'absolute', left: 0, top: 0, bottom: 0, justifyContent: 'center' },
  corner: { minHeight: 48, justifyContent: 'center' },
  // Visually hidden: read by screen readers, never seen.
  announcer: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', left: 0, top: 0 },
  // The pager fills the frame without sizing it: pages take the frame's measured size, so their
  // height never holds the frame open when the room shrinks (the dock measuring in, a rotation).
  pagerFrame: { flex: 1, marginHorizontal: -layout.gutter },
  // Each page holds its content a little above the middle, and scrolls when it is taller.
  // A page that fits ends where the dock's scrim starts to fade (its listGap), so nothing at rest is veiled.
  pageContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: layout.gutter, paddingTop: 4, paddingBottom: layout.listGap },
  pageBody: { gap: 16 },
  lens: { alignSelf: 'flex-start', marginBottom: 4 },
  copy: { gap: 10 },
  words: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10 },
  // The clip box reaches WORD_DESCENT below the line box (and gives it back), so descenders show.
  wordClip: { overflow: 'hidden', paddingBottom: WORD_DESCENT, marginBottom: -WORD_DESCENT },
  card: {
    borderRadius: radius.card,
    paddingTop: layout.cardPadding.top - 4,
    paddingRight: layout.cardPadding.right,
    paddingBottom: layout.cardPadding.bottom - 4,
    paddingLeft: layout.cardPadding.left,
  },
  rule: { marginVertical: 2 },
  step: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingVertical: 6 },
  stepText: { flex: 1, gap: 2 },
  dock: { gap: 12 },
});
