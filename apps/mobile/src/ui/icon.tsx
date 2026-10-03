import {
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  CheckSquare,
  ChevronRight,
  Circle,
  CircleAlert,
  ClipboardList,
  Coins,
  Compass,
  Download,
  ExternalLink,
  Eye,
  FileWarning,
  Flag,
  FlaskConical,
  Gavel,
  Hourglass,
  Info,
  Link2,
  Lock,
  LogIn,
  LogOut,
  Paperclip,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  ScrollText,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Square,
  Trash2,
  Unlink,
  Upload,
  UserPlus,
  Users,
  Video,
  Wallet,
  WifiOff,
  X,
  type LucideIcon,
} from 'lucide-react-native';
import { DANGER_GLYPHS, GlassGlyph, LUCIDE_TO_GLYPH, type GlyphIcon, type GlyphName, type GlyphVariant, type LucideName } from '../icons';

// Screens still hand the kit Lucide components (Button `icon`, EmptyState `icon`, the role tab
// lists). The kit swaps each one for its Lens glyph by component identity, so no call site has to
// change; a component that is not in the mapping (a GlyphIcon from glyphIcon(), or a Lucide icon
// added later) is rendered as given.

/**
 * An icon the kit accepts: a Lens glyph name (the one source, preferred in new code), a Lucide
 * component the screens already pass, or a Lens `glyphIcon(...)`.
 */
export type KitIcon = GlyphName | LucideIcon | GlyphIcon;

const LUCIDE = {
  AlertTriangle,
  ArrowRight,
  Ban,
  Check,
  CheckSquare,
  ChevronRight,
  Circle,
  CircleAlert,
  ClipboardList,
  Coins,
  Compass,
  Download,
  ExternalLink,
  Eye,
  FileWarning,
  Flag,
  FlaskConical,
  Gavel,
  Hourglass,
  Info,
  Link2,
  Lock,
  LogIn,
  LogOut,
  Paperclip,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  ScrollText,
  Send,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Square,
  Trash2,
  Unlink,
  Upload,
  UserPlus,
  Users,
  Video,
  Wallet,
  WifiOff,
  X,
} satisfies Record<LucideName, LucideIcon>;

const BY_COMPONENT = new Map<unknown, GlyphName>(
  (Object.keys(LUCIDE) as LucideName[]).map((name) => [LUCIDE[name], LUCIDE_TO_GLYPH[name]]),
);

/** The Lens glyph that replaces a Lucide icon, or null when the icon is not a mapped Lucide one. */
export function glyphNameFor(icon: unknown): GlyphName | null {
  return BY_COMPONENT.get(icon) ?? null;
}

/** The glyph a kit icon draws: its name, the mapped Lucide icon's glyph, or null (draw as given). */
function kitGlyph(icon: KitIcon): GlyphName | null {
  return typeof icon === 'string' ? icon : glyphNameFor(icon);
}

/**
 * Draws a kit icon. Glyph names and mapped Lucide icons become glass glyphs: `danger` turns the destructive glyphs
 * (Stop, Remove, Reject) rose (§7.5); every other glyph keeps `variant`. `color` only reaches
 * unmapped icons and the flat light-theme glyph.
 */
export function KitIconView({ icon, size, variant = 'face', danger = false, color }: { icon: KitIcon; size: number; variant?: GlyphVariant; danger?: boolean; color: string }) {
  const name = kitGlyph(icon);
  if (name) {
    const v: GlyphVariant = danger && DANGER_GLYPHS.includes(name) ? 'rose' : variant;
    return <GlassGlyph name={name} size={size} variant={v} color={color} />;
  }
  const Icon = icon as GlyphIcon;
  return <Icon size={size} color={color} />;
}
