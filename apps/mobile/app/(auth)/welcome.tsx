import { useRouter } from 'expo-router';
import { ArrowRight, LogIn, UserPlus } from 'lucide-react-native';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, Text as RNText, ScrollView, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
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
import { introPages, markIntroSeen, noteIntroLeft, pageAt, type IntroPage } from '../../src/onboarding/intro';
import { PREVIEW_BUILD } from '../../src/preview/demoAccounts';
import { SignInDock } from '../../src/screens/authParts';
import { DUR, INTRO } from '../../src/theme/motion';
import { useTheme } from '../../src/theme/ThemeProvider';
import { layout, radius } from '../../src/theme/tokens';
import { Button, OwnEntrance, Screen, Text } from '../../src/ui';
import { Hairline, PageDots } from '../../src/ui/patterns';
import { Enter, useEntranceDelay } from '../../src/ui/screen';

// Welcome: the intro a first-time visitor sees before Sign in (src/onboarding/intro.ts). Three
// pages: what Pocket QA is, what a tester does, what a builder does. Swipe, press Next or a dot;
// Skip, Sign in and every way out go to Sign in (or Sign up over the intro) and remember that the
// intro was seen. Never lit: nothing here is an Uplight moment.
//
// The opening (the launch, §11.3, on a first visit only; INTRO in theme/motion.ts is a proposal
// awaiting Hamza's design sign-off), ms from mount:
//   0     the light rises first (exposure 0.6 → 1, 700 ease-lens: the Screen's launch)
//   0     the brand lens arrives: opacity 0 → 1 (dur-enter) and scale 0.92 → 1 (dur-rise
//         ease-lens), with its S1 shimmer (the scene slides 16 back, the glint crosses at +220)
//   80    the label row rises (the Screen's first step)
//   80    the title, word by word, 40 apart: each word rises out of its own clipped line box
//         over 420 ease-lens
//   200   the body rises; 240 the dock (dots and Next)
// All of it is done by 700 (the entrance window), the glint excepted, as on Sign in. Reduced
// motion: every step is a 120ms fade in place; no scale, shimmer, word rise or parallax.
//
// Then the pager: the content follows the scroll on the UI thread. Each layer travels a little
// more than its page (INTRO.depth), so a page arriving comes in as a cascade (title, body, then
// the card) and one leaving clears the same way; the brand lens refracts as it is carried (its
// scene drifts). The label and the dots follow the scroll too. What the pages say to assistive
// tech, the buttons and the announcement change once a page has settled, never mid-scroll.

/** Line box of the display title (40/44) plus room for descenders under the clip. */
const WORD_DESCENT = 6;
const WORD_TRAVEL = 44 + WORD_DESCENT;
/** If a programmatic scroll never reports where it settled, the page settles anyway after this. */
const SETTLE_FALLBACK = 900;
/** No programmatic target on the UI thread. */
const NONE = -1;

type Action = 'next' | 'create' | 'demo';
type Corner = 'skip' | 'sign-in' | null;

export default function Welcome() {
  const router = useRouter();
  const { features } = useSession();
  const { motion, glass } = useTheme();
  const pages = introPages({ testCredits: features.testCredits });
  const count = pages.length;
  // The page that has settled in view; mid-scroll it stays the last one that did.
  const [page, setPage] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { width, height } = size;
  const pager = useAnimatedRef<Animated.ScrollView>();
  const x = useSharedValue(0);
  const reported = useSharedValue(0);
  // Where Next or a dot is taking the pager, until it settles there (or the user takes over). The
  // UI thread's copy keeps a pass through a page on the way from counting as a settle.
  const target = useRef<number | null>(null);
  const targetUI = useSharedValue(NONE);
  const fallback = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Controls that replace one another after the first render fade in (SwapIn); each slot carries
  // keyboard focus from the control it loses to the one it gains.
  const opened = useRef(false);
  const carryDock = useRef(false);
  const carryCorner = useRef(false);
  useEffect(() => {
    opened.current = true;
    return () => clearTimeout(fallback.current);
  }, []);
  const last = page === count - 1;
  // The shared demo preview has no self-registration (the gate refuses it), so its way in is Sign in.
  const canSignUp = !PREVIEW_BUILD;
  const action: Action = last ? (canSignUp ? 'create' : 'demo') : 'next';
  const corner: Corner = last ? (canSignUp ? 'sign-in' : null) : 'skip';
  // A slot left empty (the shared preview's last page has no corner) drops the focus it carried,
  // so a control that returns much later never takes it: a carry lives for the commit that swaps
  // its slot. (After the leaving control's cleanup, in the same commit.)
  useLayoutEffect(() => {
    if (!corner) carryCorner.current = false;
  }, [corner]);

  // Worklets capture plain values only.
  const still = motion.reduced || !glass.enabled;
  const position = useDerivedValue(() => (width > 0 ? x.value / width : 0));
  const drift = useDerivedValue(() => (still ? 0 : Math.max(-1, Math.min(1, position.value)) * INTRO.lensDrift));

  function settle(p: number) {
    target.current = null;
    targetUI.value = NONE;
    clearTimeout(fallback.current);
    setPage(p);
  }
  /** The user took over: their own scroll decides where the pager rests. */
  function release() {
    target.current = null;
    targetUI.value = NONE;
    clearTimeout(fallback.current);
  }

  // The pager's offset drives everything that follows the scroll. A page counts as settled once
  // the offset rests on it (within a pixel), whoever moved it; while Next or a dot is on its way,
  // only the page it is heading to counts, so a page passed on the way never settles.
  const onScroll = useAnimatedScrollHandler(
    {
      onScroll: (e) => {
        x.value = e.contentOffset.x;
        if (width <= 0) return;
        const p = pageAt(e.contentOffset.x, width, count);
        if (p === reported.value || Math.abs(e.contentOffset.x - p * width) >= 1) return;
        if (targetUI.value !== NONE && p !== targetUI.value) return;
        reported.value = p;
        scheduleOnRN(settle, p);
      },
      onBeginDrag: () => {
        if (targetUI.value === NONE) return;
        targetUI.value = NONE;
        scheduleOnRN(release);
      },
    },
    [width, count],
  );

  function show(i: number) {
    const to = Math.min(count - 1, Math.max(0, i));
    if (to === (target.current ?? page)) return;
    target.current = to;
    targetUI.value = to;
    pager.current?.scrollTo({ x: to * width, animated: !motion.reduced });
    clearTimeout(fallback.current);
    // A scroll that never reports where it came to rest: settle where the pager is, not where it
    // was sent (the user may have taken it back).
    fallback.current = setTimeout(() => {
      const at = pageAt(x.value, width, count);
      reported.value = at;
      settle(at);
    }, SETTLE_FALLBACK);
  }

  function leave(to: 'sign-in' | 'sign-up') {
    void markIntroSeen();
    // Sign up opens over the intro, so Back from it returns here (its last page) rather than
    // leaving the app. Sign in takes the intro's place: the visit starts there from now on.
    if (to === 'sign-up') {
      router.push('/sign-up');
      return;
    }
    noteIntroLeft();
    router.replace('/sign-in');
  }

  // Hidden under a screen pushed over it (the web stack sets display: none), the frame reports
  // 0×0: the pager keeps its size and stays mounted, so it is on the settled page in the first
  // frame shown again. Chromium, Firefox and WebKit restore a re-shown scroller's offset themselves
  // (a one-off probe, docs/verification.md); e2e/intro.spec.ts reads that first frame in Chromium.
  // For an engine that doesn't, the pager is re-aligned here, once the layout arrives (a frame late).
  const hidden = useRef(false);
  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    if (w === 0 || h === 0) {
      hidden.current = true;
      return;
    }
    if (hidden.current) {
      hidden.current = false;
      pager.current?.scrollTo({ x: page * w, animated: false });
    }
    setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
  };

  // A new width (split screen, a foldable, a resized window) keeps the settled page in view, and
  // drops any scroll on its way.
  useEffect(() => {
    if (width <= 0) return;
    release();
    pager.current?.scrollTo({ x: page * width, animated: false });
    // Only the width: page changes scroll through show() or the user's own swipe.
  }, [width]);

  // The page that settled is announced: native through the screen reader (queued on iOS, so a
  // focus move doesn't drop it), web through a polite live region (react-native-web's
  // announceForAccessibility does nothing). Not on mount.
  const [announcement, setAnnouncement] = useState('');
  const announced = useRef(page);
  useEffect(() => {
    if (announced.current === page) return;
    announced.current = page;
    const text = `Page ${page + 1} of ${count}. ${pages[page]?.title ?? ''}`;
    if (Platform.OS === 'web') setAnnouncement(text);
    else if (Platform.OS === 'ios') AccessibilityInfo.announceForAccessibilityWithOptions(text, { queue: true });
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
              <SwapIn key={action} swap={opened.current} carry={carryDock}>
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
            <SwapIn key={corner} swap={opened.current} carry={carryCorner}>
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
                  {/* A page taller than the room (a short phone, a large text size) scrolls, never clips.
                      Pages out of view are never keyboard stops; the one in view is a stop only when
                      it scrolls (the browser's own rule for scrollers). */}
                  <ScrollView style={styles.fill} contentContainerStyle={styles.pageContent} showsVerticalScrollIndicator={false} focusable={i === page ? undefined : false} testID={`intro-scroll-${p.key}`}>
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
 * arrive with the scroll, so they carry no entrance of their own. Text fades with distance; the
 * glass (the lens, the steps card) never does, because its layers would show through each other.
 */
function PageBody({ page, index, position, width, drift }: { page: IntroPage; index: number; position: SharedValue<number>; width: number; drift: SharedValue<number> }) {
  const opening = index === 0;
  const layer = { position, index, width };
  return (
    <View style={styles.pageBody}>
      {page.key === 'welcome' ? (
        <Parallax {...layer} depth={INTRO.depth.lens} zoom={INTRO.lensZoom} fade={false} style={styles.lens}>
          <LensArrival>
            <FlutedLens size={104} drift={drift} />
          </LensArrival>
        </Parallax>
      ) : null}
      <View style={styles.copy}>
        <Parallax {...layer} depth={INTRO.depth.title}>
          {opening ? <RisingTitle text={page.title} /> : <Text variant="display">{page.title}</Text>}
        </Parallax>
        <Parallax {...layer} depth={INTRO.depth.body}>
          <Opening play={opening} step={3}>
            <Text tone="muted">{page.body}</Text>
          </Opening>
        </Parallax>
      </View>
      {page.steps ? (
        <Parallax {...layer} depth={INTRO.depth.card} fade={false}>
          <GlassSurface level="card" k={1} style={styles.card}>
            {page.steps.map((s, i) => (
              <View key={s.title}>
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
              </View>
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

/**
 * The brand lens's arrival: it fades in and settles from INTRO.lensFrom over dur-rise while its S1
 * shimmer plays, so it is done inside the entrance window although the pager mounts a frame late.
 */
function LensArrival({ children }: { children: ReactNode }) {
  const { motion } = useTheme();
  const delay = useEntranceDelay(0);
  const moves = delay !== null;
  const opacity = useSharedValue(moves ? 0 : 1);
  const scale = useSharedValue(moves && !motion.reduced ? INTRO.lensFrom : 1);
  useEffect(() => {
    if (delay === null) return;
    opacity.value = withDelay(delay, withTiming(1, motion.reduced ? motion.timing.tick : motion.timing.enter));
    if (!motion.reduced) scale.value = withDelay(delay, withTiming(1, { duration: DUR.rise, easing: motion.ease.lens, reduceMotion: ReduceMotion.Never }));
    // Mount only: the arrival plays once.
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value, transform: [{ scale: scale.value }] }));
  return <Animated.View style={style}>{children}</Animated.View>;
}

/**
 * The opening title, word by word: each word rises out of its own clipped line box. One heading
 * for assistive tech, named by the whole title; the words are plain text hidden from it (never a
 * heading each). Reduced motion, or a screen that arrives as one root: the whole title as it is.
 */
function RisingTitle({ text }: { text: string }) {
  const { motion } = useTheme();
  const delay = useEntranceDelay(INTRO.wordStart);
  if (motion.reduced || delay === null) {
    return motion.reduced ? (
      <Enter step={0}>
        <Text variant="display">{text}</Text>
      </Enter>
    ) : (
      <Text variant="display">{text}</Text>
    );
  }
  return (
    <View accessible accessibilityRole="header" accessibilityLabel={text} style={styles.words} testID="intro-title">
      {text.split(' ').map((word, i) => (
        <RisingWord key={i} word={word} delay={delay + i * INTRO.wordStep} />
      ))}
    </View>
  );
}

function RisingWord({ word, delay }: { word: string; delay: number }) {
  const { motion, type, colors } = useTheme();
  const rise = useSharedValue(0);
  useEffect(() => {
    rise.value = withDelay(delay, withTiming(1, { duration: INTRO.wordRise, easing: motion.ease.lens, reduceMotion: ReduceMotion.Never }));
    // Mount only.
  }, []);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: (1 - rise.value) * WORD_TRAVEL }] }));
  return (
    <View style={styles.wordClip} aria-hidden>
      <Animated.View style={style}>
        <RNText style={[type.display, { color: colors.text }]}>{word}</RNText>
      </Animated.View>
    </View>
  );
}

/**
 * A layer of a page that follows the pager: `d` is how far its page is from view (−1 … 1), and
 * the layer travels `depth` of a page width beyond the page's own move, fading as it goes (text
 * only: `fade`) and scaling (with `zoom`). Reduced motion: it moves with its page, nothing more.
 */
function Parallax({ position, index, width, depth, zoom = 0, fade = true, style, children }: { position: SharedValue<number>; index: number; width: number; depth: number; zoom?: number; fade?: boolean; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const { motion } = useTheme();
  const still = motion.reduced;
  const animated = useAnimatedStyle(() => {
    if (still) return { opacity: 1, transform: [{ translateX: 0 }, { scale: 1 }] };
    const d = Math.max(-1, Math.min(1, position.value - index));
    return { opacity: fade ? 1 - INTRO.fade * Math.abs(d) : 1, transform: [{ translateX: -d * width * depth }, { scale: 1 - zoom * Math.abs(d) }] };
  });
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/** The top row's label for one page: it cross-fades with the scroll, rising in and out by 6 (in place under reduced motion). */
function PageLabel({ text, index, position, current }: { text: string; index: number; position: SharedValue<number>; current: boolean }) {
  const { motion } = useTheme();
  const rise = motion.reduced ? 0 : 6;
  const style = useAnimatedStyle(() => {
    const d = position.value - index;
    return { opacity: Math.max(0, 1 - Math.abs(d) * 2), transform: [{ translateY: Math.max(-1, Math.min(1, -d)) * rise }] };
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
 * one it replaced can't land on it. Keyed by role. On the web, if the control it replaced held
 * keyboard focus, focus moves to it once it has arrived: each slot carries its own focus through
 * `carry`, so a swap in one slot never pulls focus into another. The first one arrives with its
 * entrance step (`swap` false).
 */
function SwapIn({ swap, carry, children }: { swap: boolean; carry: { current: boolean }; children: ReactNode }) {
  const { motion } = useTheme();
  const [armed, setArmed] = useState(!swap);
  const opacity = useSharedValue(swap ? 0 : 1);
  const box = useRef<View>(null);
  // Leaving: did this control hold focus? A layout effect's cleanup runs before React detaches the
  // control, so the focused element is still in it here.
  useLayoutEffect(
    () => () => {
      if (Platform.OS === 'web' && typeof document !== 'undefined') carry.current = !!(box.current as unknown as HTMLElement | null)?.contains(document.activeElement);
    },
    [],
  );
  useEffect(() => {
    if (!swap) return;
    const take = carry.current;
    carry.current = false;
    opacity.value = withTiming(1, motion.reduced ? motion.timing.tick : motion.timing.swap);
    const t = setTimeout(() => {
      setArmed(true);
      // Only while focus is still on the page itself: never take it from where the user moved it.
      if (take && (!document.activeElement || document.activeElement === document.body)) {
        (box.current as unknown as HTMLElement | null)?.querySelector<HTMLElement>('[tabindex="0"], button')?.focus();
      }
    }, motion.reduced ? DUR.tick : DUR.swap);
    return () => clearTimeout(t);
    // Mount only: a swap plays once.
  }, []);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View ref={box} style={[style, armed ? null : PASS_THROUGH]}>
      {children}
    </Animated.View>
  );
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
