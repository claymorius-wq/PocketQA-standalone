import { useContext, type ReactNode } from 'react';
import { Text as RNText, type StyleProp, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { TypeScale } from '../theme/tokens';
import { ScreenContext } from './screen';

// A leaf module (theme + screen context only), so the kit (ui/index.tsx) and the patterns can both
// import it without an import cycle.

export type TextVariant = keyof TypeScale;
export type TextTone = 'default' | 'muted' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export function Text({ children, variant = 'body', tone = 'default', style, testID, numberOfLines }: {
  children: ReactNode;
  variant?: TextVariant;
  tone?: TextTone;
  style?: StyleProp<TextStyle>;
  testID?: string;
  numberOfLines?: number;
}) {
  const { colors, type } = useTheme();
  const screen = useContext(ScreenContext);
  // Stack-screen titles are display-stack (32/36); tab roots and sign-in keep display (40/44).
  const face = variant === 'display' && screen?.stack ? 'displayStack' : variant;
  const numeral = variant === 'numeral' || variant === 'numeralXl';
  const color = tone === 'default' ? (numeral ? colors.numeral : colors.text) : tone === 'muted' ? colors.textMuted : colors[tone];
  return (
    <RNText testID={testID} numberOfLines={numberOfLines} style={[type[face], { color }, style]} accessibilityRole={variant === 'display' || variant === 'title' ? 'header' : undefined}>
      {children}
    </RNText>
  );
}
