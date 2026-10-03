import { memo, useEffect, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { ClipPath, Defs, G, Path, Rect } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { radius, squircle, type GlassSurface, type LinearGradientSpec, type Tone } from '../theme/tokens';
import { GlassGlyph } from './GlassGlyph';
import type { GlyphName } from './glyphs';
import type { GlyphVariant } from './material';
import { splitShadow } from './shadow';
import { GradientDef } from '../glass/paint';
import { useSvgId } from './svg';

/**
 * Tile sizes from the boards (spec §6–§8): `hero` 54 nav/action tiles, `header` the stack-header
 * back tile, `list` the leading list-row tile, `notice` the notice tile, `chip` the study-card
 * chevron, `tab` the active tab tile (48×32 violet; inactive tabs show the bare muted glyph).
 */
export const TILE_SIZES = {
  hero: { width: 54, height: 54, radius: radius.tile, glyph: 34 },
  header: { width: 44, height: 44, radius: 14, glyph: 20 },
  list: { width: 40, height: 40, radius: radius.tileSm, glyph: 26 },
  notice: { width: 36, height: 36, radius: radius.tileSm, glyph: 24 },
  chip: { width: 32, height: 32, radius: 11, glyph: 18 },
  tab: { width: 48, height: 32, radius: radius.tabTile, glyph: 26 },
} as const;
export type TileSize = keyof typeof TILE_SIZES;

export type GlassTileProps = {
  name: GlyphName;
  size?: TileSize;
  /** The violet, lit tile: the active nav tile, or the tab bar's selected tab. */
  active?: boolean;
  /** Meaning rides on the rim tint, never on the glyph colour (spec §7.5). */
  tint?: Tone;
  /** Glyph variant; defaults to `lit` when active, else `face` (`muted` for an inactive tab). */
  variant?: GlyphVariant;
  /** The second hairline ring inset 3px (two sheets of glass). Default on, except the tab tile. */
  stacked?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * The squircle glass tile that holds a glyph (spec §4 "Glyph tile"): gradient fill and bloom, a
 * 135° gradient rim lit top-left, the stacked inner ring, hard inset edges and the cast shadow
 * (plus the blue caustic when active). Decorative: the control around it carries the label.
 */
export const GlassTile = memo(function GlassTile({ name, size = 'hero', active = false, tint, variant, stacked, style, testID }: GlassTileProps) {
  const { glass } = useTheme();
  const dims = TILE_SIZES[size];
  const isTab = size === 'tab';

  if (isTab && !active) {
    return (
      <View testID={testID} style={[{ width: dims.width, height: dims.height, pointerEvents: 'none', alignItems: 'center', justifyContent: 'center' }, style]}>
        <GlassGlyph name={name} size={dims.glyph} variant={variant ?? 'muted'} />
      </View>
    );
  }

  const surface: GlassSurface = isTab ? { ...glass.violetTile, radius: dims.radius } : glass.glyphTile({ violet: active, tint, radius: dims.radius });
  return (
    <TileSurface
      testID={testID}
      style={style}
      width={dims.width}
      height={dims.height}
      surface={surface}
      ring={(stacked ?? !isTab) ? glass.stackRing : undefined}
    >
      <GlassGlyph name={name} size={dims.glyph} variant={variant ?? (active ? 'lit' : 'face')} />
    </TileSurface>
  );
});

const roundedRect = (x: number, y: number, w: number, h: number, r: number) => {
  const q = Math.max(0, Math.min(r, w / 2, h / 2));
  return `M${x + q} ${y}H${x + w - q}A${q} ${q} 0 0 1 ${x + w} ${y + q}V${y + h - q}A${q} ${q} 0 0 1 ${x + w - q} ${y + h}H${x + q}A${q} ${q} 0 0 1 ${x} ${y + h - q}V${y + q}A${q} ${q} 0 0 1 ${x + q} ${y}Z`;
};

/**
 * Draws a GlassSurface recipe behind its children. CSS's padding-box/border-box gradient rim
 * becomes the rim gradient on the full rect with the fill on the rect inset 1px (radius − 1).
 */
function TileSurface({
  width: w,
  height: h,
  surface,
  ring,
  style,
  testID,
  children,
}: {
  width: number;
  height: number;
  surface: GlassSurface;
  ring?: { inset: number; rim: LinearGradientSpec };
  style?: StyleProp<ViewStyle>;
  testID?: string;
  children: ReactNode;
}) {
  const id = useSvgId();
  const r = surface.radius;
  const { outer, insetEdges } = splitShadow(surface.shadow);
  const pad = { x: 1, y: 1, w: w - 2, h: h - 2, r: Math.max(0, r - 1) };
  const paddingBox = roundedRect(pad.x, pad.y, pad.w, pad.h, pad.r);
  // The stacked ring is a child box `inset` px inside the padding box, radius r − inset, 1px wide.
  const ringBox = ring ? { o: 1 + ring.inset, r: r - ring.inset } : undefined;

  return (
    <View
      testID={testID}
      accessible={false}
      aria-hidden
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[{ width: w, height: h, borderRadius: r, pointerEvents: 'none', alignItems: 'center', justifyContent: 'center' }, squircle, outer ? { boxShadow: outer } : null, style]}
    >
      <Svg width={w} height={h} style={{ position: 'absolute', left: 0, top: 0 }}>
        <Defs>
          {surface.rim.map((g, i) => (
            <GradientDef key={`r${i}`} id={`${id}-rim${i}`} spec={g} box={{ x: 0, y: 0, w, h }} />
          ))}
          {surface.fill.map((g, i) => (
            <GradientDef key={`f${i}`} id={`${id}-fill${i}`} spec={g} box={pad} />
          ))}
          {ringBox && ring ? <GradientDef id={`${id}-ring`} spec={ring.rim} box={{ x: ringBox.o, y: ringBox.o, w: w - 2 * ringBox.o, h: h - 2 * ringBox.o }} /> : null}
          <ClipPath id={`${id}-pad`}>
            <Path d={paddingBox} />
          </ClipPath>
        </Defs>
        {surface.rim.map((_, i) => (
          <Rect key={`r${i}`} x={0} y={0} width={w} height={h} rx={r} ry={r} fill={`url(#${id}-rim${i})`} />
        ))}
        {surface.fill.map((_, i) => (
          <Path key={`f${i}`} d={paddingBox} fill={`url(#${id}-fill${i})`} />
        ))}
        <G clipPath={`url(#${id}-pad)`}>
          {insetEdges.map((e, i) => (
            <Path
              key={i}
              d={`M-100 -100H${w + 100}V${h + 100}H-100Z${roundedRect(pad.x + e.dx, pad.y + e.dy, pad.w, pad.h, pad.r)}`}
              fill={e.color}
              fillRule="evenodd"
            />
          ))}
        </G>
        {ringBox ? (
          <Rect
            x={ringBox.o + 0.5}
            y={ringBox.o + 0.5}
            width={w - 2 * ringBox.o - 1}
            height={h - 2 * ringBox.o - 1}
            rx={Math.max(0, ringBox.r - 0.5)}
            ry={Math.max(0, ringBox.r - 0.5)}
            fill="none"
            stroke={`url(#${id}-ring)`}
            strokeWidth={1}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

/**
 * A tab-bar glyph that cross-fades muted ↔ lit in 120 ms when its tab gains or loses focus
 * (spec §11: "glyphs cross-fade lit ↔ muted in 120 ms"; reduced motion keeps the fade). The violet
 * tile behind the active tab belongs to the tab bar, which slides one tile between tabs.
 */
export function TabGlyph({ name, focused, size = TILE_SIZES.tab.glyph }: { name: GlyphName; focused: boolean; size?: number }) {
  const { motion } = useTheme();
  const lit = useSharedValue(focused ? 1 : 0);
  useEffect(() => {
    lit.value = withTiming(focused ? 1 : 0, motion.timing.tick);
  }, [focused, lit, motion]);
  const litStyle = useAnimatedStyle(() => ({ opacity: lit.value }));
  const mutedStyle = useAnimatedStyle(() => ({ opacity: 1 - lit.value }));
  return (
    <View style={{ width: size, height: size, pointerEvents: 'none' }}>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, mutedStyle]}>
        <GlassGlyph name={name} size={size} variant="muted" />
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: 0, top: 0 }, litStyle]}>
        <GlassGlyph name={name} size={size} variant="lit" />
      </Animated.View>
    </View>
  );
}
