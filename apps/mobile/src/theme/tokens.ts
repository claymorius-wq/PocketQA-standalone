// Color tokens for both themes. Every text/background pair used by the UI is pinned by
// __tests__/contrast.test.ts: ≥ 4.5:1 for text, ≥ 3:1 for meaningful non-text UI.
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
};

export const dark: Palette = {
  background: '#0D0D0F',
  surface: '#17171B',
  surfaceAlt: '#222227',
  border: '#2C2C32',
  borderStrong: '#7E7E88',
  text: '#F3F3F5',
  textMuted: '#AAAAB4',
  primary: '#9AA5FF',
  onPrimary: '#0D0D0F',
  success: '#57C27A',
  warning: '#E5B54A',
  danger: '#FF8A80',
  info: '#6CB0FF',
  successBg: '#13281B',
  warningBg: '#2D2412',
  dangerBg: '#331816',
  infoBg: '#142338',
  neutralBg: '#222227',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;
/** Minimum touch target (dp), plan §2. */
export const TOUCH = 48;
export const type = {
  display: { fontSize: 28, lineHeight: 34, fontWeight: '700' as const, letterSpacing: -0.4 },
  title: { fontSize: 20, lineHeight: 26, fontWeight: '700' as const, letterSpacing: -0.2 },
  heading: { fontSize: 16, lineHeight: 22, fontWeight: '600' as const },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' as const },
  small: { fontSize: 13, lineHeight: 18, fontWeight: '400' as const },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600' as const, letterSpacing: 0.4 },
};
