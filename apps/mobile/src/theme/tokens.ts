import { Platform, type TextStyle } from 'react-native';

// Lens visual system (docs/decisions/0005-lens-visual-system.md). The dark palette and glass
// recipes are the values of the Direction A "Lens" v2 spec, translated to React Native.
// Every text/background pair the UI uses is pinned by __tests__/contrast.test.ts: ≥ 4.5:1 for
// text, ≥ 3:1 for meaningful non-text UI.
//
// TODO(light-lens): light keeps the pre-Lens flat palette and its glass recipes are flat
// surfaces (glass.enabled === false: no grain, blur, caustics or Uplight). A light Lens theme is
// planned; see the "Light theme" section of decision 0005.

export type Palette = {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string; // decorative dividers only
  borderStrong: string; // input outlines and focus rings (≥ 3:1 on surface)
  text: string;
  textMuted: string;
  primary: string;
  onPrimary: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  successBg: string;
  warningBg: string;
  dangerBg: string;
  infoBg: string;
  neutralBg: string;
  // Lens additions.
  neutral: string; // neutral status fg (pills)
  ink: string; // far-corner falloff, pressed floors
  well: string; // recessed well floor (inputs, reward numerals, segmented track)
  glassViolet: string; // selected segment, active tab tile
  disabledBg: string; // unlit glass behind a disabled primary
  rimLit: string; // rim colour at the lit top-left edge only
  violet: string; // rim mid-tone, section numerals
  lensBlue: string; // key light: focus ring, live glow
  caustic: string; // the only coloured cast shadow (under primary glass), used at 0.3–0.55 alpha
  shadow: string; // cast-shadow tint (never neutral black in dark)
  numeral: string; // big numerals
  textDim: string; // a row title that steps back (A-Moderation suspended rows)
  textFaint: string; // placeholders only
  textDisabled: string; // disabled labels on disabledBg
  upSource: string; // Uplight core and 1px bottom specular
  upHalo: string; // Uplight halo, bottom rim mid
  upPool: string; // Uplight pool, inner pool, spill
};

export const light: Palette = {
  background: '#F6F6F4',
  surface: '#FFFFFF',
  surfaceAlt: '#EEEEEB',
  border: '#E2E2DE',
  borderStrong: '#7C7C76',
  text: '#121212',
  textMuted: '#55554F',
  primary: '#3442C2',
  onPrimary: '#FFFFFF',
  success: '#17703A',
  warning: '#8A5A00',
  danger: '#B42318',
  info: '#155EAF',
  successBg: '#E5F4EA',
  warningBg: '#FBF0D9',
  dangerBg: '#FCE8E6',
  infoBg: '#E3EEFB',
  neutralBg: '#EEEEEB',
  neutral: '#55554F',
  ink: '#E9E9E5',
  well: '#FFFFFF',
  glassViolet: '#E4E6F8',
  disabledBg: '#E4E4E0',
  rimLit: '#FFFFFF',
  violet: '#5B4BC4',
  lensBlue: '#3442C2',
  caustic: '#3442C2',
  shadow: '#000000',
  numeral: '#121212',
  textDim: '#2E2E2A',
  textFaint: '#696963',
  textDisabled: '#5F5F59',
  upSource: '#EEF2FF',
  upHalo: '#8DB0FF',
  upPool: '#4E70FF',
};

export const dark: Palette = {
  background: '#0B0A1F', // ground
  surface: '#16143A', // glass (L1 body)
  surfaceAlt: '#1F1B48', // glass-raised (L2)
  border: '#39395D', // the divider rgba(214,224,255,0.18) flattened over glass
  borderStrong: '#7A74A8', // line-strong
  text: '#F2F0FB',
  textMuted: '#AEA8CF',
  primary: '#A9C1FF',
  onPrimary: '#0B0A1F',
  success: '#74D6A0',
  warning: '#EBC163',
  danger: '#FF9A90',
  info: '#8DBBFF',
  successBg: '#0F2620',
  warningBg: '#29210F',
  dangerBg: '#2E1420',
  infoBg: '#131F3F',
  neutralBg: '#1E1B3A',
  neutral: '#BDB8DA',
  ink: '#08071A',
  well: '#07061A',
  glassViolet: '#2E2366',
  disabledBg: '#2A2758',
  rimLit: '#D6E0FF',
  violet: '#8C7BFF',
  lensBlue: '#6F9BFF',
  caustic: '#6F9BFF',
  shadow: '#02010A',
  numeral: '#DCE5FF',
  textDim: '#CEC9E6',
  textFaint: '#8580A8',
  textDisabled: '#9A93C4',
  upSource: '#EEF2FF',
  upHalo: '#8DB0FF',
  upPool: '#4E70FF',
};

// ---------- Spacing, radii, touch ----------

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
/** Lens layout constants (spec §6). Card padding is CSS order: top, right, bottom, left. */
export const layout = {
  gutter: 16,
  headerGutter: 20,
  listGap: 14,
  cardPadding: { top: 18, right: 18, bottom: 16, left: 20 },
  sheetPadding: 24,
  statusBarReserve: 44,
  headerTextTop: 58,
  tabBarInset: 12,
  tabBarHeight: 74,
} as const;

/**
 * Corner radii. `sm`/`md`/`lg`/`pill` are the pre-Lens keys the app already uses; the rest are the
 * Lens squircle sizes. Pair them with `squircle` so iOS draws continuous corners.
 */
export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
  card: 24,
  raised: 20,
  notice: 20,
  tile: 18, // 54px glyph tile
  tileSm: 12, // 36–40px glyph tile
  button: 18,
  input: 16,
  well: 16,
  segmentTrack: 18,
  segment: 14,
  tabTile: 12,
  checkbox: 9,
  tabBar: 26,
  overlay: 26,
  sheet: 28, // top corners only
} as const;
/** iOS continuous corners; Android and web ignore it and draw circular arcs. */
export const squircle = { borderCurve: 'continuous' } as const;

/** Minimum touch target (dp), plan §2. */
export const TOUCH = 48;
/**
 * Lens control heights. The spec's 44px segments are raised to the repo minimum, TOUCH.
 */
export const touch = { min: TOUCH, button: 52, input: 52, inputMultiline: 96, segment: TOUCH, tab: 60, listRow: 64, checkbox: 26 } as const;

// ---------- Type ----------

/** Font family names as registered by expo-font in app/_layout.tsx (one file per weight). */
export const fontFamilies = {
  display300: 'RedHatDisplay_300Light',
  display400: 'RedHatDisplay_400Regular',
  display500: 'RedHatDisplay_500Medium',
  ui400: 'InstrumentSans_400Regular',
  ui600: 'InstrumentSans_600SemiBold',
  mono400: 'DMMono_400Regular',
  mono500: 'DMMono_500Medium',
} as const;
type FontKey = keyof typeof fontFamilies;

const WEB_FALLBACK = {
  display: "'Segoe UI Variable Display', 'Segoe UI', system-ui, sans-serif",
  ui: "'Segoe UI', 'Helvetica Neue', system-ui, sans-serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
} as const;

export type TypeStyle = Pick<TextStyle, 'fontFamily' | 'fontSize' | 'lineHeight' | 'fontWeight' | 'letterSpacing' | 'fontVariant'>;
export type FontState = 'lens' | 'system';

// Each Lens weight is its own font file, so the loaded style names the file and omits
// fontWeight: on web a face registered without a weight would be synthetically emboldened, and
// on Android a weight on a single-file family is resolved against the file anyway. The 'system'
// state (font loading failed) keeps the weight on the platform font so hierarchy survives.
function face(font: FontKey, state: FontState): Pick<TextStyle, 'fontFamily' | 'fontWeight'> {
  const weight = font.slice(-3) as TextStyle['fontWeight'];
  if (state === 'system') return { fontWeight: weight };
  const name = fontFamilies[font];
  const group = font.startsWith('display') ? 'display' : font.startsWith('ui') ? 'ui' : 'mono';
  return { fontFamily: Platform.OS === 'web' ? `${name}, ${WEB_FALLBACK[group]}` : name };
}

const TABULAR: TextStyle['fontVariant'] = ['tabular-nums'];

/** The Lens type scale (spec §5). Labels are uppercased by the caller, never by the style. */
export function typeScale(state: FontState) {
  return {
    numeralXl: { ...face('display300', state), fontSize: 56, lineHeight: 56, letterSpacing: -1.6, fontVariant: TABULAR },
    numeral: { ...face('display300', state), fontSize: 38, lineHeight: 42, letterSpacing: -1.2, fontVariant: TABULAR },
    display: { ...face('display400', state), fontSize: 40, lineHeight: 44, letterSpacing: -1.2 },
    displayStack: { ...face('display400', state), fontSize: 32, lineHeight: 36, letterSpacing: -0.8 },
    headerTitle: { ...face('ui600', state), fontSize: 17, lineHeight: 22 },
    title: { ...face('display500', state), fontSize: 19, lineHeight: 24, letterSpacing: -0.2 },
    heading: { ...face('ui600', state), fontSize: 16, lineHeight: 22 },
    headingNotice: { ...face('ui600', state), fontSize: 15, lineHeight: 20 },
    button: { ...face('ui600', state), fontSize: 15, lineHeight: 20 },
    body: { ...face('ui400', state), fontSize: 15, lineHeight: 22 },
    bodySm: { ...face('ui400', state), fontSize: 14, lineHeight: 20 },
    small: { ...face('ui400', state), fontSize: 13, lineHeight: 18 },
    disclaimer: { ...face('ui400', state), fontSize: 12, lineHeight: 16 },
    label: { ...face('mono500', state), fontSize: 12, lineHeight: 16, letterSpacing: 0.48 },
    meta: { ...face('mono400', state), fontSize: 12, lineHeight: 16, fontVariant: TABULAR },
    tabLabel: { ...face('ui600', state), fontSize: 12, lineHeight: 16 },
    segment: { ...face('ui600', state), fontSize: 14, lineHeight: 18 },
    // Segments that choose an amount (A-Budget top-up): Red Hat Display 500 18/22 tabular.
    segmentNumeral: { ...face('display500', state), fontSize: 18, lineHeight: 22, fontVariant: TABULAR },
    // An input that takes a number (A-NewStudy Reward, Slots): Red Hat Display 300 28/32 tabular.
    inputNumeral: { ...face('display300', state), fontSize: 28, lineHeight: 32, fontVariant: TABULAR },
    amount: { ...face('display400', state), fontSize: 18, lineHeight: 24, fontVariant: TABULAR },
  } satisfies Record<string, TypeStyle>;
}
export type TypeScale = ReturnType<typeof typeScale>;

/**
 * Static type scale for modules that style outside React. app/_layout.tsx holds the first render
 * until the fonts load, so the Lens families are in place; ThemeProvider's `type` also covers a
 * failed load.
 */
export const type: TypeScale = typeScale('lens');

// ---------- Glass recipes ----------

/** A colour stop; `color` is opaque hex, alpha is carried separately (react-native-svg Stop). */
export type GradientStop = { offset: number; color: string; opacity: number };
/** CSS `linear-gradient(<angle>deg, …)`; see gradient.ts for the SVG vector. */
export type LinearGradientSpec = { kind: 'linear'; angle: number; stops: GradientStop[] };
/**
 * CSS `radial-gradient(<rx> <ry> at <cx> <cy>, …)`. The centre is a fraction of the box;
 * the radii are fractions of the box width/height, or pixels when `units` is 'px'.
 */
export type RadialGradientSpec = { kind: 'radial'; cx: number; cy: number; rx: number; ry: number; units: 'fraction' | 'px'; stops: GradientStop[] };
export type GradientSpec = LinearGradientSpec | RadialGradientSpec;
/** A CSS box-shadow list; RN (New Architecture) and react-native-web take it as `boxShadow`. */
export type ShadowRecipe = string | undefined;

/**
 * A glass surface. `fill` and `rim` layers are listed in paint order (first is painted first,
 * the reverse of CSS `background` order). The rim is the 1px border-box ring around the fill.
 */
export type GlassSurface = { radius: number; fill: GradientSpec[]; rim: GradientSpec[]; shadow: ShadowRecipe };

const s = (offset: number, color: string, opacity = 1): GradientStop => ({ offset, color, opacity });
const lin = (angle: number, ...stops: GradientStop[]): LinearGradientSpec => ({ kind: 'linear', angle, stops });
const rad = (rx: number, ry: number, cx: number, cy: number, ...stops: GradientStop[]): RadialGradientSpec => ({ kind: 'radial', cx, cy, rx, ry, units: 'fraction', stops });
const radPx = (rx: number, ry: number, cx: number, cy: number, ...stops: GradientStop[]): RadialGradientSpec => ({ kind: 'radial', cx, cy, rx, ry, units: 'px', stops });
const solid = (color: string): LinearGradientSpec => lin(180, s(0, color), s(1, color));
const f3 = (n: number) => Number(n.toFixed(3));

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
type ToneRgb = Record<Tone, string>;
const TONE_HEX: ToneRgb = { success: '#74D6A0', warning: '#EBC163', danger: '#FF9A90', info: '#8DBBFF', neutral: '#BDB8DA' };
const TONE_BG: ToneRgb = { success: '#0F2620', warning: '#29210F', danger: '#2E1420', info: '#131F3F', neutral: '#1E1B3A' };
const TONE_RGB: ToneRgb = { success: '116,214,160', warning: '235,193,99', danger: '255,154,144', info: '141,187,255', neutral: '189,184,218' };

/** Uplight floor geometry: three ellipses anchored at the subject's x on the container bottom. */
export type UplightFloor = { layers: RadialGradientSpec[] };

export type GlassRecipes = {
  /** false in light: render flat fills, skip grain, blur, caustics, Uplight and the lens shimmer. */
  enabled: boolean;
  ground: {
    base: LinearGradientSpec;
    /** Positioned boxes in px on a 390-wide reference screen; scale x/width by screenWidth / 390. */
    keyPool: { left: number; top: number; width: number; height: number; gradient: RadialGradientSpec };
    shaft: { left: number; top: number; width: number; height: number; rotate: number; gradient: LinearGradientSpec };
    falloff: { right: number; bottom: number; width: number; height: number; gradient: RadialGradientSpec };
    referenceWidth: number;
  };
  /** Key-pool exposure (opacity): at rest, while an Uplight moment is lit, behind a sheet, entrance start. */
  exposure: { rest: number; uplit: number; sheet: number; entranceFrom: number };
  grain: { ground: number; card: number; lens: number; tile: number };
  /** L1 card; k = how much key light reaches it (1 nearest the light, 0.8, 0.64… down a list). */
  card: (k?: number) => GlassSurface;
  cardPressed: GlassSurface;
  raised: GlassSurface;
  violetTile: GlassSurface;
  glyphTile: (opts?: { violet?: boolean; tint?: Tone; radius?: number }) => GlassSurface;
  /** The stacked hairline ring inset 3px inside a glyph tile. */
  stackRing: { inset: number; rim: LinearGradientSpec };
  /**
   * L3, the only real blur (tab bar or bottom dock, and sheets): expo-blur at `blurIntensity`.
   * Android blurs only with `blurMethod` and a BlurTargetView around the content behind it;
   * 'none' falls back to the translucent fill alone.
   */
  overlay: GlassSurface & { blurIntensity: number; blurTint: 'dark' | 'light'; blurMethod: 'none' | 'dimezisBlurViewSdk31Plus' };
  well: GlassSurface;
  /**
   * The unlit recessed well: no far-wall bloom, the rim at line-strong all round and a deeper floor.
   * A fact the app cannot provide (A-Review "Analysis unavailable"): recessed, but never lit.
   */
  wellDark: GlassSurface;
  wellFocus: { rim: LinearGradientSpec[]; shadow: ShadowRecipe };
  wellError: { fill: GradientSpec[]; rim: LinearGradientSpec[] };
  primary: GlassSurface;
  primaryPressed: GlassSurface;
  primaryDisabled: GlassSurface;
  secondary: GlassSurface;
  secondaryPressed: GlassSurface;
  destructive: GlassSurface;
  pill: (tone: Tone) => GlassSurface;
  notice: (tone: Tone) => GlassSurface;
  /** The live LED glow on IN PROGRESS / UPLOADING pills. */
  ledShadow: (tone: Tone) => ShadowRecipe;
  divider: LinearGradientSpec;
  sheet: { backdrop: string; grabber: string };
  /** A locked Field's pressed shade over its well (the Lock, §11.5): the well's floor, darker. Undefined where wells are flat (light). */
  lockShade: string | undefined;
  uplight: {
    floor: UplightFloor;
    card: (u: number) => GlassSurface;
    notice: (tone: Tone) => GlassSurface;
    /** RN draws one text shadow; the spec's second 1px specular shadow is dropped. */
    numeral: (u: number) => Pick<TextStyle, 'textShadowColor' | 'textShadowOffset' | 'textShadowRadius'>;
    commitConfirmShadow: ShadowRecipe;
    /**
     * The commit confirm's fourth shadow on its own (§10.3): the spill under a primary that the
     * Uplight reaches (a commit sheet's confirm, Sign in under U1). Drawn on a layer whose opacity is u.
     */
    spill: ShadowRecipe;
    /** A primary's uplit edge (A-SignIn U1): the bright bottom specular and a short inner wash from below, opacity u. */
    primaryEdge: ShadowRecipe;
    /** [x, y (from the bottom), diameter px, peak opacity] as fractions of the floor box. */
    motes: readonly (readonly [number, number, number, number])[];
  };
  flute: {
    /** Each rib mirrors (scaleX −m) a slice sampled k × (ribCentre − S/2) further out; the scene is padded by pad × S. */
    m: number;
    k: number;
    pad: number;
    rim: LinearGradientSpec;
    ribShade: LinearGradientSpec;
    scene: { ground: LinearGradientSpec; sphere: RadialGradientSpec; specular: RadialGradientSpec; backing: string };
    innerShadow: ShadowRecipe;
    shadow: ShadowRecipe;
    /** Rib count that keeps ribs 7–10px wide: 7 at 54, 12 at 104, 22 at 220. */
    ribs: (size: number) => number;
  };
  /** Record core paint (lit from inside) and its glow colour. */
  recordCore: { face: RadialGradientSpec; glow: string };
};

const RIM_L1 = (k: number) => lin(135, s(0, '#D6E0FF', f3(0.5 * k)), s(0.3, '#8C7BFF', f3(0.26 * k)), s(0.62, '#463A96', 0.16), s(1, '#1E1A46', 0.1));
const CARD_FILL = lin(160, s(0, '#1C1942'), s(0.45, '#16143A'), s(1, '#110F2E'));
const CARD_BLOOM = (k: number) => rad(1.2, 0.8, 0, 0, s(0, '#6F9BFF', f3(0.1 * k)), s(0.5, '#6F9BFF', 0));

const UPLIGHT_SPILL = '0 14px 30px -10px rgba(141,176,255,0.6)';
const PRIMARY_SHADOW = 'inset 0 1px 0 rgba(255,255,255,0.65), inset -2px -3px 6px rgba(60,70,170,0.35), 8px 12px 26px -10px rgba(111,155,255,0.55), 2px 3px 6px -2px rgba(2,1,10,0.7)';

// Rib width interpolates through the spec's anchors (54 → 7 ribs, 104 → 12, 220 → 22), clamped to 7–10px.
const RIB_ANCHORS: [number, number][] = [[54, 54 / 7], [104, 104 / 12], [220, 10]];
function fluteRibs(size: number): number {
  const [first] = RIB_ANCHORS;
  let width = first![1];
  for (let i = 1; i < RIB_ANCHORS.length; i++) {
    const [s0, w0] = RIB_ANCHORS[i - 1]!;
    const [s1, w1] = RIB_ANCHORS[i]!;
    if (size >= s0) width = size >= s1 ? w1 : w0 + ((w1 - w0) * (size - s0)) / (s1 - s0);
  }
  return Math.max(1, Math.round(size / Math.min(10, Math.max(7, width))));
}

export const glassDark: GlassRecipes = {
  enabled: true,
  ground: {
    base: lin(165, s(0, '#0D0C26'), s(0.48, '#0B0A1F'), s(1, '#08071A')),
    keyPool: { left: -190, top: -230, width: 620, height: 560, gradient: rad(0.5, 0.5, 0.5, 0.5, s(0, '#6084FF', 0.26), s(0.45, '#6084FF', 0.09), s(1, '#6084FF', 0)) },
    shaft: { left: -40, top: -60, width: 150, height: 1000, rotate: -34, gradient: lin(90, s(0, '#7896FF', 0), s(0.5, '#7896FF', 0.055), s(1, '#7896FF', 0)) },
    falloff: { right: -200, bottom: -160, width: 520, height: 460, gradient: rad(0.5, 0.5, 0.5, 0.5, s(0, '#704CE0', 0.1), s(1, '#704CE0', 0)) },
    referenceWidth: 390,
  },
  exposure: { rest: 1, uplit: 0.72, sheet: 0.4, entranceFrom: 0.6 },
  grain: { ground: 0.064, card: 0.056, lens: 0.128, tile: 0.056 },
  card: (k = 1) => ({
    radius: radius.card,
    fill: [CARD_FILL, CARD_BLOOM(k)],
    rim: [RIM_L1(k)],
    shadow: `inset 1px 1px 0 rgba(214,224,255,${f3(0.07 * k)}), 10px 16px 32px -14px rgba(2,1,10,0.85), 3px 5px 10px -4px rgba(2,1,10,0.55)`,
  }),
  cardPressed: {
    radius: radius.card,
    fill: [lin(160, s(0, '#110F2E'), s(1, '#0E0C28'))],
    rim: [lin(135, s(0, '#D6E0FF', 0.22), s(0.4, '#8C7BFF', 0.14), s(1, '#1E1A46', 0.08))],
    shadow: 'inset 3px 4px 10px rgba(2,1,10,0.7), 1px 2px 4px -2px rgba(2,1,10,0.6)',
  },
  raised: {
    radius: radius.raised,
    fill: [lin(150, s(0, '#2B2468'), s(0.5, '#221C55'), s(1, '#1A1544')), rad(1.1, 0.9, 0, 0, s(0, '#8CAAFF', 0.2), s(0.55, '#8CAAFF', 0))],
    rim: [lin(135, s(0, '#E2EAFF', 0.85), s(0.32, '#9687FF', 0.45), s(0.65, '#5042AA', 0.22), s(1, '#1E1A46', 0.12))],
    shadow: 'inset 1px 1px 0 rgba(230,236,255,0.14), inset -1px -2px 0 rgba(4,3,20,0.35), 12px 18px 30px -12px rgba(2,1,10,0.9), 3px 5px 10px -4px rgba(2,1,10,0.6)',
  },
  violetTile: {
    radius: radius.tabTile,
    fill: [lin(150, s(0, '#3A2E86'), s(0.55, '#2E2366'), s(1, '#241B52'))],
    rim: [lin(135, s(0, '#DCE6FF', 0.9), s(0.4, '#8C7BFF', 0.4), s(1, '#2E2366', 0.2))],
    shadow: 'inset 1px 1px 0 rgba(230,236,255,0.18), 4px 6px 12px -4px rgba(2,1,10,0.8), 5px 7px 14px -6px rgba(111,155,255,0.45)',
  },
  glyphTile: ({ violet = false, tint, radius: r = radius.tile } = {}) => ({
    radius: r,
    fill: violet
      ? [lin(150, s(0, '#4434A0'), s(0.5, '#33277A'), s(1, '#261D5C')), rad(0.9, 0.8, 0.18, 0.12, s(0, '#AABEFF', 0.3), s(0.6, '#AABEFF', 0))]
      : [lin(150, s(0, '#2A2360'), s(0.55, '#201B4C'), s(1, '#191540')), rad(1, 0.9, 0.1, 0.06, s(0, '#96AFFF', 0.22), s(0.58, '#96AFFF', 0))],
    rim: [
      tint
        ? lin(135, s(0, TONE_HEX[tint], 0.9), s(0.38, TONE_HEX[tint], 0.32), s(0.72, '#5042AA', 0.16), s(1, '#1E1A46', 0.1))
        : lin(135, s(0, '#E8EEFF', 0.92), s(0.3, '#9687FF', 0.48), s(0.64, '#5042AA', 0.22), s(1, '#1E1A46', 0.12)),
    ],
    shadow: `inset 1px 1px 0 rgba(235,240,255,0.18), inset -1px -2px 0 rgba(4,3,20,0.4), 9px 13px 22px -9px rgba(2,1,10,0.95)${violet ? ', 7px 10px 20px -8px rgba(111,155,255,0.5)' : ''}`,
  }),
  stackRing: { inset: 3, rim: lin(135, s(0, '#DCE6FF', 0.3), s(0.45, '#9687FF', 0.1), s(0.8, '#1E1A46', 0)) },
  overlay: {
    radius: radius.overlay,
    fill: [lin(180, s(0, '#241F52', 0.5), s(1, '#110F28', 0.74))],
    rim: [lin(135, s(0, '#D6E0FF', 0.6), s(0.35, '#8C7BFF', 0.26), s(1, '#3C3282', 0.12))],
    shadow: 'inset 0 1px 0 rgba(214,224,255,0.06), 12px 20px 40px -10px rgba(2,1,10,0.9)',
    blurIntensity: 40,
    blurTint: 'dark',
    blurMethod: 'dimezisBlurViewSdk31Plus',
  },
  well: {
    radius: radius.well,
    fill: [lin(160, s(0, '#07061A'), s(1, '#0C0B24')), rad(0.9, 1.2, 1, 1, s(0, '#6F9BFF', 0.14), s(0.6, '#6F9BFF', 0))],
    rim: [lin(135, s(0, '#7A74A8'), s(0.45, '#7A74A8'), s(1, '#A0BAFF'))],
    shadow: 'inset 3px 4px 8px rgba(2,1,10,0.80), inset -1px -1px 0 rgba(150,175,255,0.16)',
  },
  wellDark: {
    radius: radius.well,
    fill: [lin(160, s(0, '#07061A'), s(1, '#0A0920'))],
    rim: [lin(135, s(0, '#7A74A8'), s(0.5, '#7A74A8', 0.75), s(1, '#7A74A8', 0.45))],
    shadow: 'inset 3px 4px 10px rgba(2,1,10,0.85)',
  },
  wellFocus: {
    rim: [lin(135, s(0, '#D6E0FF'), s(0.45, '#6F9BFF'), s(1, '#4A5BC8'))],
    shadow: 'inset 3px 4px 8px rgba(2,1,10,0.80), 0 0 0 3px rgba(111,155,255,0.22), 4px 6px 16px -6px rgba(111,155,255,0.45)',
  },
  wellError: {
    fill: [lin(160, s(0, '#0C0614'), s(1, '#120A1C'))],
    rim: [lin(135, s(0, '#FFC9C3'), s(0.45, '#FF9A90'), s(1, '#8A3B4A'))],
  },
  primary: {
    radius: radius.button,
    fill: [lin(135, s(0, '#D2DDFF'), s(0.4, '#A9C1FF'), s(1, '#8299F5'))],
    rim: [lin(135, s(0, '#FFFFFF'), s(0.4, '#B9CBFF'), s(1, '#4E5FC9'))],
    shadow: PRIMARY_SHADOW,
  },
  primaryPressed: {
    radius: radius.button,
    fill: [lin(135, s(0, '#B8C9FF'), s(0.45, '#94ADFA'), s(1, '#7189EC'))],
    rim: [lin(135, s(0, '#C9D6FF'), s(0.5, '#8FA6FF'), s(1, '#3E4DB0'))],
    shadow: 'inset 2px 3px 6px rgba(40,46,140,0.45), 2px 4px 10px -6px rgba(111,155,255,0.45)',
  },
  primaryDisabled: {
    radius: radius.button,
    fill: [lin(135, s(0, '#2A2758'), s(1, '#221F4C'))],
    rim: [lin(135, s(0, '#A9C1FF', 0.3), s(1, '#A9C1FF', 0.08))],
    shadow: undefined,
  },
  secondary: {
    radius: radius.button,
    fill: [lin(150, s(0, '#262058'), s(0.55, '#1F1B48'), s(1, '#1A1640')), rad(1.1, 0.9, 0, 0, s(0, '#8CAAFF', 0.16), s(0.55, '#8CAAFF', 0))],
    rim: [lin(135, s(0, '#E2EAFF', 0.75), s(0.35, '#9687FF', 0.38), s(0.7, '#5042AA', 0.18), s(1, '#1E1A46', 0.1))],
    shadow: 'inset 1px 1px 0 rgba(230,236,255,0.12), 8px 12px 22px -12px rgba(2,1,10,0.9)',
  },
  secondaryPressed: {
    radius: radius.button,
    fill: [lin(150, s(0, '#17143A'), s(1, '#141133'))],
    rim: [lin(135, s(0, '#E2EAFF', 0.35), s(0.4, '#9687FF', 0.2), s(1, '#1E1A46', 0.1))],
    shadow: 'inset 3px 4px 8px rgba(2,1,10,0.7)',
  },
  destructive: {
    radius: radius.button,
    fill: [lin(150, s(0, '#2A1530'), s(0.55, '#22122B'), s(1, '#1C1026'))],
    rim: [lin(135, s(0, '#FFC8C2', 0.75), s(0.35, '#FF9A90', 0.4), s(0.75, '#783246', 0.18), s(1, '#281428', 0.1))],
    shadow: 'inset 1px 1px 0 rgba(255,220,214,0.10), 8px 12px 22px -12px rgba(2,1,10,0.9)',
  },
  pill: (tone) => ({
    radius: radius.pill,
    fill: [solid(TONE_BG[tone])],
    rim: [lin(135, s(0, TONE_HEX[tone], 0.7), s(0.45, TONE_HEX[tone], 0.22), s(1, TONE_HEX[tone], 0.06))],
    shadow: undefined,
  }),
  notice: (tone) => ({
    radius: radius.notice,
    fill: [lin(160, s(0, TONE_BG[tone]), s(1, '#110F2C'))],
    rim: [lin(135, s(0, TONE_HEX[tone], 0.7), s(0.4, TONE_HEX[tone], 0.22), s(1, TONE_HEX[tone], 0.06))],
    shadow: `inset 1px 1px 0 rgba(${TONE_RGB[tone]},0.10), 8px 12px 24px -12px rgba(2,1,10,0.9)`,
  }),
  ledShadow: (tone) => `0 0 0 2px rgba(${TONE_RGB[tone]},0.18), 0 0 8px rgba(${TONE_RGB[tone]},0.75)`,
  divider: lin(90, s(0, '#D6E0FF', 0.18), s(0.8, '#D6E0FF', 0)),
  sheet: { backdrop: 'rgba(4,3,14,0.62)', grabber: 'rgba(214,224,255,0.28)' },
  lockShade: 'rgba(8,7,26,0.36)',
  uplight: {
    floor: {
      layers: [
        radPx(440, 260, 0.5, 1, s(0, '#4E70FF', 0.24), s(0.55, '#4E70FF', 0.06), s(1, '#4E70FF', 0)),
        radPx(230, 130, 0.5, 1, s(0, '#8DB0FF', 0.42), s(1, '#8DB0FF', 0)),
        radPx(90, 26, 0.5, 1, s(0, '#EEF2FF', 0.6), s(1, '#EEF2FF', 0)),
      ],
    },
    card: (u) => ({
      radius: radius.card,
      fill: [CARD_FILL, CARD_BLOOM(1), rad(1.2, 0.7, 0.5, 1, s(0, '#4E70FF', f3(0.3 * u)), s(0.7, '#4E70FF', 0))],
      rim: [RIM_L1(1), lin(0, s(0, '#E2EAFF', f3(0.85 * u)), s(0.22, '#8DB0FF', f3(0.34 * u)), s(0.46, '#8DB0FF', 0))],
      shadow: `inset 1px 1px 0 rgba(214,224,255,0.07), inset 0 -1px 0 rgba(238,242,255,${f3(0.4 * u)}), inset 0 -28px 36px -26px rgba(78,112,255,${f3(0.36 * u)}), 10px 16px 32px -14px rgba(2,1,10,0.6), 0 16px 34px -14px rgba(78,112,255,${f3(0.38 * u)})`,
    }),
    notice: (tone) => ({
      radius: radius.notice,
      fill: [lin(160, s(0, TONE_BG[tone]), s(1, '#110F2C')), rad(1.2, 0.7, 0.5, 1, s(0, '#4E70FF', 0.16), s(0.7, '#4E70FF', 0))],
      rim: [lin(135, s(0, TONE_HEX[tone], 0.7), s(0.4, TONE_HEX[tone], 0.22), s(1, TONE_HEX[tone], 0.06)), lin(0, s(0, '#E2EAFF', 0.42), s(0.4, '#8DB0FF', 0))],
      shadow: 'inset 0 -1px 0 rgba(238,242,255,0.2), 8px 12px 24px -12px rgba(2,1,10,0.7), 0 14px 30px -14px rgba(78,112,255,0.3)',
    }),
    numeral: (u) => ({ textShadowColor: `rgba(141,176,255,${f3(0.55 * u)})`, textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 18 }),
    commitConfirmShadow: `${PRIMARY_SHADOW}, ${UPLIGHT_SPILL}`,
    spill: UPLIGHT_SPILL,
    primaryEdge: 'inset 0 -1px 0 rgba(238,242,255,0.9), inset 0 -16px 18px -14px rgba(238,242,255,0.6)',
    motes: [[0.38, 0.3, 1.5, 0.55], [0.52, 0.58, 1, 0.45], [0.61, 0.22, 2, 0.35], [0.45, 0.74, 1, 0.5], [0.57, 0.44, 1.5, 0.4]],
  },
  flute: {
    m: 0.5,
    k: 0.14,
    pad: 0.3,
    rim: lin(135, s(0, '#FFFFFF'), s(0.3, '#B7C6FF'), s(0.7, '#6A5BD0'), s(1, '#2A2266')),
    ribShade: lin(90, s(0, '#FFFFFF', 0.55), s(0.1, '#FFFFFF', 0.16), s(0.3, '#FFFFFF', 0), s(0.55, '#100C3C', 0), s(0.92, '#100C3C', 0.42), s(1, '#FFFFFF', 0.1)),
    scene: {
      ground: lin(140, s(0, '#E2DEFC'), s(0.38, '#B3A9F0'), s(0.78, '#6B5CC8'), s(1, '#3F3192')),
      sphere: rad(0.31, 0.31, 0.47, 0.52, s(0, '#3E5BFF'), s(0.38, '#2233DA'), s(0.8, '#141CA6'), s(0.92, '#0E1385'), s(1, '#0E1385', 0)),
      specular: rad(0.09, 0.09, 0.39, 0.35, s(0, '#F0F4FF', 0.95), s(1, '#F0F4FF', 0)),
      backing: '#3C318F',
    },
    innerShadow: 'inset 1px 1px 0 rgba(255,255,255,0.6), inset -3px -4px 10px rgba(20,16,70,0.5)',
    shadow: '8px 12px 24px -8px rgba(2,1,10,0.9), 3px 4px 8px -2px rgba(2,1,10,0.6), 8px 12px 30px -6px rgba(70,100,255,0.32)',
    ribs: fluteRibs,
  },
  recordCore: { face: rad(0.5, 0.5, 0.5, 0.5, s(0, '#FFF3FB'), s(0.5, '#F6B6E0'), s(1, '#A983F2')), glow: '#F3A6DD' },
};

// Light degrades every recipe to a flat surface with a solid hairline rim and no shadows.
const flat = (fill: string, rim: string, r: number): GlassSurface => ({ radius: r, fill: [solid(fill)], rim: [solid(rim)], shadow: undefined });
const L = light;
const LIGHT_PRIMARY_PRESSED = '#28339A';
const LIGHT_TONE: Record<Tone, [string, string]> = {
  success: [L.success, L.successBg],
  warning: [L.warning, L.warningBg],
  danger: [L.danger, L.dangerBg],
  info: [L.info, L.infoBg],
  neutral: [L.neutral, L.neutralBg],
};

export const glassLight: GlassRecipes = {
  enabled: false,
  ground: {
    base: solid(L.background),
    keyPool: { left: 0, top: 0, width: 0, height: 0, gradient: rad(0.5, 0.5, 0.5, 0.5, s(0, L.background, 0), s(1, L.background, 0)) },
    shaft: { left: 0, top: 0, width: 0, height: 0, rotate: 0, gradient: lin(90, s(0, L.background, 0), s(1, L.background, 0)) },
    falloff: { right: 0, bottom: 0, width: 0, height: 0, gradient: rad(0.5, 0.5, 0.5, 0.5, s(0, L.background, 0), s(1, L.background, 0)) },
    referenceWidth: 390,
  },
  exposure: { rest: 1, uplit: 1, sheet: 1, entranceFrom: 1 },
  grain: { ground: 0, card: 0, lens: 0, tile: 0 },
  card: () => flat(L.surface, L.border, radius.card),
  cardPressed: flat(L.surfaceAlt, L.border, radius.card),
  raised: flat(L.surfaceAlt, L.border, radius.raised),
  violetTile: flat(L.glassViolet, L.primary, radius.tabTile),
  glyphTile: ({ violet = false, tint, radius: r = radius.tile } = {}) => flat(violet ? L.glassViolet : L.surfaceAlt, tint ? LIGHT_TONE[tint][0] : L.border, r),
  stackRing: { inset: 3, rim: solid(L.surface) },
  overlay: { ...flat(L.surface, L.border, radius.overlay), blurIntensity: 0, blurTint: 'light', blurMethod: 'none' },
  well: flat(L.well, L.borderStrong, radius.well),
  wellDark: flat(L.well, L.borderStrong, radius.well),
  wellFocus: { rim: [solid(L.primary)], shadow: undefined },
  wellError: { fill: [solid(L.well)], rim: [solid(L.danger)] },
  primary: flat(L.primary, L.primary, radius.button),
  // Pressed must read as pressed without the Lens layers: a darker primary (onPrimary 10.34:1, checked by contrast.test).
  primaryPressed: flat(LIGHT_PRIMARY_PRESSED, LIGHT_PRIMARY_PRESSED, radius.button),
  primaryDisabled: flat(L.disabledBg, L.border, radius.button),
  secondary: flat(L.surface, L.borderStrong, radius.button),
  secondaryPressed: flat(L.surfaceAlt, L.borderStrong, radius.button),
  destructive: flat(L.surface, L.danger, radius.button),
  pill: (tone) => flat(LIGHT_TONE[tone][1], LIGHT_TONE[tone][1], radius.pill),
  notice: (tone) => flat(LIGHT_TONE[tone][1], LIGHT_TONE[tone][0], radius.notice),
  ledShadow: () => undefined,
  divider: solid(L.border),
  sheet: { backdrop: 'rgba(0,0,0,0.5)', grabber: L.border },
  lockShade: undefined,
  uplight: {
    floor: { layers: [] },
    card: () => flat(L.surface, L.border, radius.card),
    notice: (tone) => flat(LIGHT_TONE[tone][1], LIGHT_TONE[tone][0], radius.notice),
    numeral: () => ({}),
    commitConfirmShadow: undefined,
    spill: undefined,
    primaryEdge: undefined,
    motes: [],
  },
  flute: { ...glassDark.flute, shadow: undefined },
  recordCore: glassDark.recordCore,
};
