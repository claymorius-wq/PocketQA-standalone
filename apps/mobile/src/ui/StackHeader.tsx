import type { NativeStackHeaderProps, NativeStackNavigationOptions } from 'expo-router/native-stack';
import { getHeaderTitle } from 'expo-router/react-navigation';
import { useContext } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GradientRule } from '../glass/paint';
import { GlassTile } from '../icons';
import { usePressMotion } from '../motion';
import { useArrival, type ArrivalNavigation } from '../motion/entrance';
import { useTheme } from '../theme/ThemeProvider';
import { statusBand, type Palette } from '../theme/tokens';
import { FocusPressable } from './focus';
import { ArrivalContext, arrivalOf } from './screen';

// The one Lens stack header (CONSISTENCY C2, spec §8 Stack header): the Back button (44dp glass
// back tile, radius 14, glyph 20, then the visible label "Back" in primary 600 15/20), a 1×22
// vertical divider at 0.30, then the title (600 17/22) as the screen's header. The row sits 6 below
// the 44dp status band (the board's top 50; on the web, below the page's own inset: statusBand),
// 16 in from both edges, 44 tall, gap 12, so the title starts at the same x on every stack screen.
//
// It never enters on its own: it is part of the content root that pushes in (§M3), so it plays the
// same arrival as its Screen (useArrival with the same navigation and the same ArrivalContext), and
// it returns with `back`. Root-stack screens always push: no layout sets an ArrivalContext around
// them and no screen passes Screen `entrance` (a screen that ever does must set the context too).
// It paints nothing behind itself: the screen's own Ground runs under it to the top edge (one key
// light; a sheet or an Uplight dims the pool under the header too). Screen starts its content
// below it (HeaderHeightContext) and lets it scroll up under it, behind the HeaderScrim: a strip of
// that same ground, opaque through the whole Back / title row and fading out only below it, so
// nothing scrolled shows through the controls and content dissolves into the ground instead of
// being cut.

const ROW_HEIGHT = 44;
const ROW_TOP = 6; // below the status band: the board's header top is 50 under a 44 reserve
const ROW_BOTTOM = 4;
/** The ground under the 44dp control row, inside the header's height (Screen's HeaderScrim is solid down to the row's bottom). */
export const HEADER_ROW_BOTTOM = ROW_BOTTOM;
const EDGE = 16;
const BACK_RADIUS = 16; // the focus ring follows it (C1)
const DIVIDER = { height: 22, color: '#D6E0FF', peak: 0.3 } as const;
/** rgba(214,224,255,0.30) at its middle, 0 at both ends. */
const DIVIDER_STOPS = [
  { offset: 0, color: DIVIDER.color, opacity: 0 },
  { offset: 0.5, color: DIVIDER.color, opacity: DIVIDER.peak },
  { offset: 1, color: DIVIDER.color, opacity: 0 },
] as const;

export function LensStackHeader({ navigation, route, options, back }: NativeStackHeaderProps) {
  const { colors, type } = useTheme();
  const insets = useSafeAreaInsets();
  const press = usePressMotion();
  const arrival = useArrival(arrivalOf(useContext(ArrivalContext)) ?? 'push', navigation as unknown as ArrivalNavigation, route.key);
  const title = getHeaderTitle(options, route.name);
  // Back shows only when there is history to return to (`back`), exactly as main's native header:
  // a screen reached by a deep link or a web refresh shows the title alone. No new navigation path.
  // The same status-band rule as the tab roots' titles (Screen): the boards' 44 whatever the device inset.
  // On web the band is only the page's own safe-area inset: the browser's status bar sits outside the page.
  const top = statusBand(insets.top, Platform.OS === 'web') + ROW_TOP;
  return (
    <View style={[styles.bar, { paddingTop: top, paddingLeft: insets.left, paddingRight: insets.right }]}>
      {/* The push arrival slides the row in from +24, past the right edge; on web this frame clips it
          there, so mobile web never widens its layout viewport (that left a white strip after scrolling).
          The frame spans the full width and reaches CLIP_SLACK above and below the row, so the focus ring
          is not cut (the back tile's soft shadow tail, about 26 below it, is cut after 12 on web only);
          its negative margins keep the header's height unchanged. Native has no viewport to widen and
          does not clip. */}
      <View style={styles.clip}>
        <Animated.View style={[styles.row, arrival.style]}>
          {back ? (
            <>
              <FocusPressable
                ringRadius={BACK_RADIUS}
                onPress={() => navigation.goBack()}
                onPressIn={press.pressIn}
                onPressOut={press.pressOut}
                accessibilityRole="button"
                accessibilityLabel="Back"
                style={styles.back}
              >
                <Animated.View style={[styles.backContent, press.motionStyle]}>
                  <GlassTile name="back" size="header" />
                  <Text style={[type.button, { color: colors.primary }]}>Back</Text>
                </Animated.View>
              </FocusPressable>
              <HeaderDivider />
            </>
          ) : null}
          <Text accessibilityRole="header" numberOfLines={1} style={[type.headerTitle, styles.title, { color: colors.text }]}>
            {title}
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

/** The 1×22 divider between Back and the title (the one GradientRule, vertical). Light: flat. */
function HeaderDivider() {
  return <GradientRule direction="y" length={DIVIDER.height} stops={DIVIDER_STOPS} />;
}

/**
 * Stack navigators run no scene animation of their own (`animation: 'none'`): the arriving screen
 * plays its push / back on the UI thread (src/motion/entrance.ts), the same on Android, iOS and web.
 * Used by every Lens stack, with or without the header.
 */
export const LENS_STACK_ANIMATION = { animation: 'none' } as const satisfies Pick<NativeStackNavigationOptions, 'animation'>;

/** Root stack options: the transparent Lens header, the ground colour behind every screen, no native transition. */
export function lensStackScreenOptions(colors: Palette): NativeStackNavigationOptions {
  return {
    header: (props) => <LensStackHeader {...props} />,
    headerTransparent: true,
    headerShadowVisible: false,
    headerTintColor: colors.primary,
    contentStyle: { backgroundColor: colors.background },
    ...LENS_STACK_ANIMATION,
  };
}

/** Room the clip frame keeps above and below the row for the focus ring (web clips; native does not). */
const CLIP_SLACK = 12;

const styles = StyleSheet.create({
  bar: { paddingBottom: ROW_BOTTOM },
  clip: { overflow: Platform.OS === 'web' ? 'hidden' : 'visible', paddingHorizontal: EDGE, paddingVertical: CLIP_SLACK, marginVertical: -CLIP_SLACK },
  row: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { minHeight: ROW_HEIGHT, justifyContent: 'center', paddingRight: 8 },
  backContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, minWidth: 0 },
});
