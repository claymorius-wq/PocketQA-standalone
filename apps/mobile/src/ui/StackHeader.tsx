import type { NativeStackHeaderProps, NativeStackNavigationOptions } from 'expo-router/native-stack';
import { getHeaderTitle } from 'expo-router/react-navigation';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassTile } from '../icons';
import { stackScreenOptions, usePressMotion } from '../motion';
import type { Motion } from '../theme/motion';
import { useTheme } from '../theme/ThemeProvider';
import type { Palette } from '../theme/tokens';

// The Lens stack header (§8 Stack header): one button holding a 44dp back tile and the visible
// label "Back" in primary, then the title (17/22, 600). The header is transparent and paints
// nothing: the screen's own Ground runs under it to the top edge (one key light, so a sheet or an
// Uplight dims the pool under the header too), and Screen starts its scroll view below the header
// (HeaderHeightContext), so content never scrolls under it.

const ROW_HEIGHT = 48;
const ROW_INSET = 4; // the board's header row sits at y = 48 under a 44dp status reserve, 48 tall

export function LensStackHeader({ navigation, route, options, back }: NativeStackHeaderProps) {
  const { colors, type } = useTheme();
  const insets = useSafeAreaInsets();
  const press = usePressMotion();
  const title = getHeaderTitle(options, route.name);
  return (
    <View style={[styles.bar, { paddingTop: insets.top + ROW_INSET, paddingLeft: 12 + insets.left, paddingRight: 16 + insets.right }]}>
      <View style={styles.row}>
        {back ? (
          <Pressable onPress={() => navigation.goBack()} onPressIn={press.pressIn} onPressOut={press.pressOut} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
            <Animated.View style={[styles.backContent, press.motionStyle]}>
              <GlassTile name="back" size="header" />
              <Text style={[type.button, { color: colors.primary }]}>Back</Text>
            </Animated.View>
          </Pressable>
        ) : null}
        <Text accessibilityRole="header" numberOfLines={1} style={[type.headerTitle, styles.title, { color: colors.text }]}>
          {title}
        </Text>
      </View>
    </View>
  );
}

/** Root stack options: the transparent Lens header, the ground behind every screen and the stack cross-fade. */
export function lensStackScreenOptions(colors: Palette, motion: Motion): NativeStackNavigationOptions {
  return {
    header: (props) => <LensStackHeader {...props} />,
    headerTransparent: true,
    headerShadowVisible: false,
    headerTintColor: colors.primary,
    contentStyle: { backgroundColor: colors.background },
    ...stackScreenOptions(motion),
  };
}

const styles = StyleSheet.create({
  bar: { paddingBottom: ROW_INSET },
  row: { height: ROW_HEIGHT, flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: { minHeight: ROW_HEIGHT, justifyContent: 'center', paddingRight: 8 },
  backContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { flex: 1, minWidth: 0 },
});
