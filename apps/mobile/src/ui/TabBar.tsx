import { BottomTabBarHeightCallbackContext, type BottomTabBarProps } from 'expo-router/tabs';
import { useContext, useEffect, useState, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { GlassBlur, GlassSurface } from '../glass';
import { TabGlyph, TILE_SIZES, type GlyphName } from '../icons';
import { usePressMotion, useTabTile } from '../motion';
import { useTheme } from '../theme/ThemeProvider';
import { layout, touch } from '../theme/tokens';
import { KitIconView, type KitIcon } from './icon';

export type TabBarItem = { glyph: GlyphName | null; icon: KitIcon };

// The Lens tab bar (§8 Tab bar, §11.4): the L3 overlay floating 12dp in from the screen edges,
// 74 tall, one violet tile that slides to the active tab on spring-tab (its rim is drawn in screen
// space by the tile itself, so the lit corner never rotates), glyphs and labels cross-fading in
// 120ms. It is persistent chrome: it never re-enters on tab changes.
//
// It replaces React Navigation's BottomTabBar, so it repeats that bar's contract: the tabPress /
// tabLongPress events, `tabBarButtonTestID`, `tabBarAccessibilityLabel`, role "tab" with
// aria-selected (iOS keeps "button"), and reporting its height so screens can clear it.

const BAR_PADDING = 6;

export function LensTabBar({ state, descriptors, navigation, insets, items, blurTarget }: BottomTabBarProps & {
  items: Record<string, TabBarItem | undefined>;
  /** The focused scene's BlurTargetView (Android blurs only what that view holds). */
  blurTarget?: RefObject<View | null>;
}) {
  const { glass } = useTheme();
  const onHeight = useContext(BottomTabBarHeightCallbackContext);
  // Everything the bar covers from the bottom edge, so Screen pads its content past it.
  const covered = layout.tabBarHeight + layout.tabBarInset + insets.bottom;
  useEffect(() => {
    onHeight?.(covered);
  }, [onHeight, covered]);

  const [width, setWidth] = useState(0);
  const count = state.routes.length;
  const step = count ? Math.max(0, width - 2 * (BAR_PADDING - 1)) / count : 0;
  const tileStyle = useTabTile(state.index, step);
  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidth((prev) => (prev === w ? prev : w));
  };

  return (
    <View style={[styles.dock, { left: layout.tabBarInset + insets.left, right: layout.tabBarInset + insets.right, bottom: layout.tabBarInset + insets.bottom }]}>
      <GlassBlur blurTarget={blurTarget} style={styles.bar}>
        <View style={styles.row} onLayout={onLayout} role="tablist">
          {step > 0 ? (
            <Animated.View style={[styles.tileSlot, { width: step }, tileStyle]}>
              <GlassSurface recipe={glass.violetTile} grain={false} style={styles.tile} />
            </Animated.View>
          ) : null}
          {state.routes.map((route, index) => {
            const focused = index === state.index;
            const descriptor = descriptors[route.key];
            if (!descriptor) return null;
            const { options } = descriptor;
            const label = typeof options.tabBarLabel === 'string' ? options.tabBarLabel : (options.title ?? route.name);
            const onPress = () => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
            };
            const onLongPress = () => {
              navigation.emit({ type: 'tabLongPress', target: route.key });
            };
            return (
              <TabItem
                key={route.key}
                label={label}
                focused={focused}
                item={items[route.name]}
                testID={options.tabBarButtonTestID}
                accessibilityLabel={options.tabBarAccessibilityLabel ?? (Platform.OS === 'ios' ? `${label}, tab, ${index + 1} of ${count}` : undefined)}
                onPress={onPress}
                onLongPress={onLongPress}
              />
            );
          })}
        </View>
      </GlassBlur>
    </View>
  );
}

function TabItem({ label, focused, item, testID, accessibilityLabel, onPress, onLongPress }: {
  label: string;
  focused: boolean;
  item: TabBarItem | undefined;
  testID?: string;
  accessibilityLabel?: string;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { colors, type, motion } = useTheme();
  const press = usePressMotion();
  const lit = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    lit.value = withTiming(focused ? 1 : 0, motion.timing.tick);
  }, [focused, lit, motion]);
  const muted = colors.textMuted;
  const primary = colors.primary;
  const labelStyle = useAnimatedStyle(() => ({ color: interpolateColor(lit.value, [0, 1], [muted, primary]) }));
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={press.pressIn}
      onPressOut={press.pressOut}
      role={Platform.OS === 'ios' ? 'button' : 'tab'}
      aria-selected={focused}
      accessibilityLabel={accessibilityLabel}
      style={styles.tab}
    >
      <Animated.View style={[styles.tabContent, press.motionStyle]}>
        <View style={styles.glyphSlot}>
          {item?.glyph ? (
            <TabGlyph name={item.glyph} focused={focused} />
          ) : item ? (
            <KitIconView icon={item.icon} size={TILE_SIZES.tab.glyph} variant={focused ? 'lit' : 'muted'} color={focused ? primary : muted} />
          ) : null}
        </View>
        <Animated.Text numberOfLines={1} style={[type.tabLabel, labelStyle]}>
          {label}
        </Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

// Inside the bar's 1dp border: a 60dp item centred in the 72dp row, its tile + 4 + label column
// (32 + 4 + 16) centred in the item, so the tile's top sits 10dp down.
const ROW = layout.tabBarHeight - 2;
const ITEM = touch.tab;
const TILE_TOP = (ROW - ITEM) / 2 + (ITEM - (TILE_SIZES.tab.height + 4 + 16)) / 2;

const styles = StyleSheet.create({
  dock: { position: 'absolute' },
  bar: { height: layout.tabBarHeight },
  row: { flexDirection: 'row', alignItems: 'center', height: ROW, paddingHorizontal: BAR_PADDING - 1 },
  tileSlot: { position: 'absolute', top: TILE_TOP, left: BAR_PADDING - 1, height: TILE_SIZES.tab.height, alignItems: 'center' },
  tile: { width: TILE_SIZES.tab.width, height: TILE_SIZES.tab.height },
  tab: { flex: 1, minHeight: ITEM, alignItems: 'center', justifyContent: 'center' },
  tabContent: { alignItems: 'center', gap: 4 },
  glyphSlot: { width: TILE_SIZES.tab.width, height: TILE_SIZES.tab.height, alignItems: 'center', justifyContent: 'center' },
});
