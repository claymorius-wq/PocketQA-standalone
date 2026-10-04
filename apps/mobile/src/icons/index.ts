import { createElement, type ComponentType } from 'react';
import { GlassGlyph } from './GlassGlyph';
import type { GlyphName } from './glyphs';
import type { GlyphVariant } from './material';

// Lens icon set (spec §7): extruded glass glyphs drawn with react-native-svg.
//
// React Native adaptations of the board renderer (lens-glyphs.mjs `icon()`):
// - Cast shadow and record glow: SVG `feGaussianBlur` on web; on native a stack of dilated
//   silhouettes at falling alpha (material.SOFT_LAYERS), because react-native-svg's Android blur
//   runs RenderScript on every draw.
// - Sheen and rose core fill the part geometry directly instead of a full-box rect masked to the
//   part (same pixels, two fewer masks per part). The bevel crescents keep the spec's masks.
// - The SVG canvas is padded 6 units on every side so the shadow is not clipped by the view.
// - Light theme (`glass.enabled === false`) draws a flat silhouette in the palette colour.
//   TODO(light-lens): the light Lens theme will define a light glyph material.
// - The spec suggests baking tab-bar and list glyphs to @2x/@3x PNGs; measure on the Seeker first.

export { GlassGlyph, type GlassGlyphProps } from './GlassGlyph';
export { GlassTile, TabGlyph, TILE_SIZES, type GlassTileProps, type TileSize } from './GlassTile';
export { BALANCE_POSE, BalanceGlyph, BalanceTile, panShift, type BalanceGlyphProps, type BalancePose } from './Balance';
export { ALIASES, GLYPHS, GLYPH_NAMES, resolveGlyph, type GlyphAlias, type GlyphName, type GlyphPart } from './glyphs';
export type { GlyphVariant } from './material';

/**
 * Every lucide-react-native icon the app imports today, and the Lens glyph that replaces it.
 * Context exceptions, decided by the boards:
 * - `Coins` is `credits` (tester tab, Credits screen) but `budget` on the builder's Budget tab
 *   (see TAB_GLYPHS).
 * - `Square` / `CheckSquare` in the ui Checkbox are not glyphs in the Lens: the checkbox is the
 *   §8 recipe (26px primary-glass square) with the `approve` check when checked. `Square` maps to
 *   `stop` for "Stop recording".
 * - `Sparkles` ("Analysis unavailable") is `info` on purpose: the A-Review handoff drops the
 *   sparkle trope.
 * - `Video` ("Start screen recording") is `record`; `Circle` (withdrawn EmptyState) is `ring`.
 */
export const LUCIDE_TO_GLYPH = {
  AlertTriangle: 'warning',
  ArrowRight: 'forward',
  Ban: 'ban',
  Check: 'approve',
  CheckSquare: 'approve',
  ChevronRight: 'chevron',
  Circle: 'ring',
  CircleAlert: 'alert',
  ClipboardList: 'work',
  Coins: 'credits',
  Compass: 'discover',
  Download: 'download',
  ExternalLink: 'external',
  Eye: 'eye',
  FileWarning: 'fileWarning',
  Flag: 'flag',
  FlaskConical: 'studies',
  Gavel: 'disputes',
  Hourglass: 'stuck',
  Info: 'info',
  Link2: 'link',
  KeyRound: 'lock', // forgot password
  Lock: 'lock',
  Mail: 'send', // resend verification email
  LogIn: 'signIn',
  LogOut: 'signOut',
  Paperclip: 'attach',
  Pause: 'pause',
  Play: 'play',
  Plus: 'plus',
  RefreshCw: 'refresh',
  Rocket: 'publish',
  Save: 'save',
  ScrollText: 'audit',
  Send: 'send',
  Settings: 'settings',
  ShieldAlert: 'moderation',
  ShieldCheck: 'consent',
  Smartphone: 'device',
  Sparkles: 'info',
  Square: 'stop',
  Trash2: 'remove',
  Unlink: 'unlink',
  Upload: 'upload',
  UserPlus: 'join',
  Users: 'users',
  Video: 'record',
  Wallet: 'wallet',
  WifiOff: 'offline',
  X: 'reject',
} as const satisfies Record<string, GlyphName>;
export type LucideName = keyof typeof LUCIDE_TO_GLYPH;

/** Glyphs that take the rose face when they act on something destructive (spec §7.5). */
export const DANGER_GLYPHS: readonly GlyphName[] = ['stop', 'remove', 'reject'];

/** Tab glyphs per role, keyed by the expo-router tab route name (app/(role)/_layout.tsx). */
export const TAB_GLYPHS = {
  tester: { discover: 'discover', work: 'work', credits: 'credits', settings: 'settings' },
  builder: { studies: 'studies', budget: 'budget', 'builder-settings': 'settings' },
  admin: { disputes: 'disputes', stuck: 'stuck', moderation: 'moderation', audit: 'audit', 'admin-settings': 'settings' },
} as const satisfies Record<'tester' | 'builder' | 'admin', Record<string, GlyphName>>;

/** The props a Lucide icon takes where the app renders `<Icon size color />`. */
export type GlyphIconProps = { size?: number; color?: string };
export type GlyphIcon = ComponentType<GlyphIconProps>;

const iconCache = new Map<string, GlyphIcon>();
/**
 * A stable component with the Lucide call shape (`size`, `color`) that draws a Lens glyph, so a
 * component typed for `LucideIcon` can switch per call site. `color` only tints the flat light
 * theme glyph; the Lens glyph keeps its glass.
 */
export function glyphIcon(name: GlyphName, variant: GlyphVariant = 'face'): GlyphIcon {
  const key = `${name}:${variant}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const Icon = ({ size = 24, color }: GlyphIconProps) => createElement(GlassGlyph, { name, size, variant, color });
    Icon.displayName = `GlyphIcon(${key})`;
    icon = Icon;
    iconCache.set(key, icon);
  }
  return icon;
}
