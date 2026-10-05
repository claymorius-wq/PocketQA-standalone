import { useRouter } from 'expo-router';
import { ArrowRight, LogIn, UserPlus } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { useSession } from '../../src/auth/SessionProvider';
import { FlutedLens, GlassSurface } from '../../src/glass';
import { GlassTile } from '../../src/icons';
import { introPages, markIntroSeen, pageAt, type IntroPage } from '../../src/onboarding/intro';
import { PREVIEW_BUILD } from '../../src/preview/demoAccounts';
import { SignInDock } from '../../src/screens/authParts';
import { useTheme } from '../../src/theme/ThemeProvider';
import { layout, radius } from '../../src/theme/tokens';
import { Button, Screen, Text } from '../../src/ui';
import { FocusPressable } from '../../src/ui/focus';
import { Hairline } from '../../src/ui/patterns';

// Welcome: the intro a first-time visitor sees before Sign in (src/onboarding/intro.ts). Three
// pages: what Pocket QA is, what a tester does, what a builder does. Swipe or press Next; Skip
// and every way out go to Sign in (or Create an account) and remember that the intro was seen.
// Never lit: U1 belongs to Sign in, and nothing here is an Uplight moment.
export default function Welcome() {
  const router = useRouter();
  const { features } = useSession();
  const { motion } = useTheme();
  const pages = introPages({ testCredits: features.testCredits });
  const [page, setPage] = useState(0);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { width, height } = size;
  const pager = useRef<ScrollView>(null);
  const last = page === pages.length - 1;
  // The shared demo preview has no self-registration (the gate refuses it), so its way in is Sign in.
  const canSignUp = !PREVIEW_BUILD;

  function leave(to: '/sign-in' | '/sign-up') {
    void markIntroSeen();
    router.replace(to);
  }

  function show(i: number) {
    const next = Math.min(pages.length - 1, Math.max(0, i));
    setPage(next);
    pager.current?.scrollTo({ x: next * width, animated: !motion.reduced });
  }

  const onLayout = (e: LayoutChangeEvent) => {
    const { width: w, height: h } = e.nativeEvent.layout;
    setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
  };
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => setPage(pageAt(e.nativeEvent.contentOffset.x, width, pages.length));

  return (
    <Screen
      testID="welcome-screen"
      scroll={false}
      // The pager, the last step, takes the free room, so each page can hold its content in the middle.
      fill
      dockPlacement="edge"
      dockClearance={layout.listGap}
      // Sign in's dock, unlit: the same gutter, home-indicator room and ground fade as Sign in.
      dock={
        <SignInDock>
          <View style={styles.dock}>
          <Dots count={pages.length} current={page} onSelect={show} />
          {last ? (
            canSignUp ? (
              <Button label="Create an account" icon={UserPlus} onPress={() => leave('/sign-up')} testID="intro-get-started" />
            ) : (
              <Button label="Explore the demo" icon={LogIn} onPress={() => leave('/sign-in')} testID="intro-get-started" />
            )
          ) : (
            <Button label="Next" icon={ArrowRight} onPress={() => show(page + 1)} testID="intro-next" />
          )}
          {last && canSignUp ? (
            <Button label="I already have an account" variant="ghost" onPress={() => leave('/sign-in')} testID="intro-sign-in" />
          ) : null}
          </View>
        </SignInDock>
      }
    >
      <View key="top" style={styles.top}>
        <Text variant="label" tone="primary" testID="intro-label">
          {pages[page]?.label}
        </Text>
        {/* Skip leaves for Sign in from any page but the last, where the way in is the primary. */}
        {last ? <View style={styles.skipSpace} /> : <Button label="Skip" variant="ghost" size="compact" onPress={() => leave('/sign-in')} testID="intro-skip" accessibilityHint="Goes to sign in" />}
      </View>
      <View key="pager" style={styles.pagerFrame} onLayout={onLayout} testID="intro-pager-frame">
        {width > 0 ? (
          <ScrollView
            ref={pager}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={onScroll}
            scrollEventThrottle={32}
            testID="intro-pager"
          >
            {pages.map((p, i) => (
              // Off-screen pages are hidden from assistive tech, so a screen reader reads the page in view.
              <View key={p.key} style={[styles.page, { width, height }]} aria-hidden={i !== page} testID={`intro-page-${p.key}`}>
                <PageBody page={p} />
              </View>
            ))}
          </ScrollView>
        ) : null}
      </View>
    </Screen>
  );
}

/** One page: the brand lens on the first, the steps card on the others. */
function PageBody({ page }: { page: IntroPage }) {
  return (
    <View style={styles.pageBody}>
      {page.key === 'welcome' ? (
        <View style={styles.lens}>
          <FlutedLens size={120} />
        </View>
      ) : null}
      <View style={styles.copy}>
        <Text variant="display">{page.title}</Text>
        <Text tone="muted">{page.body}</Text>
      </View>
      {page.steps ? (
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
      ) : null}
    </View>
  );
}

/** Page dots: the current page is a longer, primary pill. Each dot is a 44dp target that opens its page. */
function Dots({ count, current, onSelect }: { count: number; current: number; onSelect: (i: number) => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.dots} accessibilityRole="tablist" accessibilityLabel={`Page ${current + 1} of ${count}`} accessibilityLiveRegion="polite" testID="intro-dots">
      {Array.from({ length: count }, (_, i) => (
        <FocusPressable
          key={i}
          ringRadius={22}
          style={styles.dotHit}
          onPress={() => onSelect(i)}
          accessibilityRole="tab"
          accessibilityLabel={`Page ${i + 1} of ${count}`}
          accessibilityState={{ selected: i === current }}
          testID={`intro-dot-${i}`}
        >
          <View style={[styles.dot, i === current ? [styles.dotOn, { backgroundColor: colors.primary }] : { backgroundColor: colors.borderStrong }]} />
        </FocusPressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 },
  skipSpace: { height: 48 },
  pagerFrame: { flex: 1, marginHorizontal: -layout.gutter },
  // Each page fills the pager and holds its content a little above the middle.
  page: { paddingHorizontal: layout.gutter, justifyContent: 'center', paddingBottom: 56 },
  pageBody: { gap: 20 },
  lens: { alignSelf: 'flex-start', marginBottom: 4 },
  copy: { gap: 10 },
  card: {
    borderRadius: radius.card,
    paddingTop: layout.cardPadding.top - 4,
    paddingRight: layout.cardPadding.right,
    paddingBottom: layout.cardPadding.bottom - 4,
    paddingLeft: layout.cardPadding.left,
  },
  rule: { marginVertical: 2 },
  step: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingVertical: 10 },
  stepText: { flex: 1, gap: 2 },
  dock: { gap: 12 },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  dotHit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  dotOn: { width: 24 },
});
