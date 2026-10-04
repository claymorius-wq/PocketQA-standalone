import { Children, Fragment, useContext, type ReactNode } from 'react';
import { Platform, StyleSheet, Text as RNText, type StyleProp, type TextStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { fontFamilies, type TypeScale } from '../theme/tokens';
import { ScreenContext } from './screen';

// A leaf module (theme + screen context only), so the kit (ui/index.tsx) and the patterns can both
// import it without an import cycle.

export type TextVariant = keyof TypeScale;
export type TextTone = 'default' | 'muted' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

/**
 * Paragraph wrapping that never leaves a lone short word on the last line (the boards'
 * `text-wrap: pretty`): CSS on web; Android takes the balanced line breaker (PRETTY_BREAK). Copy is
 * unchanged. For prose bodies (a study's objective, an empty state's body), not for one-liners.
 */
export const PRETTY_WRAP: TextStyle | null = Platform.OS === 'web' ? ({ textWrap: 'pretty', hyphens: 'manual' } as unknown as TextStyle) : null;
export const PRETTY_BREAK = 'balanced' as const;

/**
 * C6 clause dot spacing: the dot sits 0.28em from each clause (the boards' `margin: 0 0.28em` on
 * the dot). React Native text has no per-span margin, so each space beside the dot is tracked to
 * make it exactly 0.28em: letterSpacing = 0.28em less the face's own space advance. The advance is
 * the face's, not assumed (an Instrument Sans space is 0.2em, Red Hat Display's 0.21 to 0.22, a DM
 * Mono space a full 0.6 cell, which is tracked in), measured from the font files.
 */
const DOT_GAP_EM = 0.28;
const SPACE_EM: Record<string, number> = {
  [fontFamilies.ui400]: 0.2,
  [fontFamilies.ui600]: 0.193,
  [fontFamilies.display300]: 0.221,
  [fontFamilies.display400]: 0.215,
  [fontFamilies.display500]: 0.212,
  [fontFamilies.mono400]: 0.6,
  [fontFamilies.mono500]: 0.6,
};
/** A face the table does not know (the platform font, when the Lens fonts failed to load): an Instrument Sans space. */
const DEFAULT_SPACE_EM = 0.2;
/** The type size a separator falls back to (the small / meta line, 13). */
const DEFAULT_DOT_SIZE = 13;

/** The space advance (em) of the face a style names: the first family in the list (web lists fallbacks after it). */
function spaceEm(fontFamily: string | undefined): number {
  const face = fontFamily?.split(',')[0]?.trim().replace(/^['"]|['"]$/g, '');
  return (face ? SPACE_EM[face] : undefined) ?? DEFAULT_SPACE_EM;
}

/** The letterSpacing that makes one space of this face 0.28em wide at `fontSize`. */
export function clauseSpaceTracking(fontSize: number, fontFamily?: string): number {
  return Math.round((DOT_GAP_EM - spaceEm(fontFamily)) * fontSize * 100) / 100;
}

/**
 * The C6 clause dot inside a Text: " · " with each space tracked so the dot sits 0.28em from each
 * clause, at `fontSize` in `fontFamily` (the enclosing text's; see clauseSpaceTracking). `glue`
 * (default) makes the space after the dot a no-break space, so a line can break before a dot but
 * never after one (the boards' "no line ends on a dot"). Reads as " · " (tests, screen readers).
 */
export function ClauseDot({ fontSize = DEFAULT_DOT_SIZE, fontFamily, glue = true }: { fontSize?: number; fontFamily?: string; glue?: boolean }) {
  const track = { letterSpacing: clauseSpaceTracking(fontSize, fontFamily) };
  return (
    <>
      <RNText style={track}>{' '}</RNText>·<RNText style={track}>{glue ? '\u00A0' : ' '}</RNText>
    </>
  );
}

/** The separator the kit's Text sets as a clause dot when it is written into a string ("Admin · admin"). */
const SEPARATOR = ' · ';

/**
 * A Text's children with every " · " in their strings set as a ClauseDot, unglued, so the
 * characters are exactly the ones written (copy, tests and flows that match the string still do).
 * Children without one are returned as they are.
 */
function withClauseDots(children: ReactNode, style: TextStyle | undefined): ReactNode {
  const list = Children.toArray(children);
  if (!list.some((c) => typeof c === 'string' && c.includes(SEPARATOR))) return children;
  const fontSize = style?.fontSize ?? DEFAULT_DOT_SIZE;
  const fontFamily = style?.fontFamily;
  return list.map((c, i) =>
    typeof c === 'string' && c.includes(SEPARATOR) ? (
      <Fragment key={`dots-${i}`}>
        {c.split(SEPARATOR).map((part, j) => (
          <Fragment key={j}>
            {j > 0 ? <ClauseDot fontSize={fontSize} fontFamily={fontFamily} glue={false} /> : null}
            {part}
          </Fragment>
        ))}
      </Fragment>
    ) : (
      c
    ),
  );
}

/**
 * The kit's text. A " · " written into its string is set as the C6 clause dot (0.28em from each
 * clause, ClauseDot), so a subtitle like "Test credits · no cash value" spaces its dot like the
 * boards without the caller building Clauses; the characters are unchanged.
 */
export function Text({ children, variant = 'body', tone = 'default', style, testID, numberOfLines, pretty = false }: {
  children: ReactNode;
  variant?: TextVariant;
  tone?: TextTone;
  style?: StyleProp<TextStyle>;
  testID?: string;
  numberOfLines?: number;
  /** Prose wrapping (PRETTY_WRAP): no orphaned last word. */
  pretty?: boolean;
}) {
  const { colors, type } = useTheme();
  const screen = useContext(ScreenContext);
  // Stack-screen titles are display-stack (32/36); tab roots and sign-in keep display (40/44).
  const face = variant === 'display' && screen?.stack ? 'displayStack' : variant;
  const numeral = variant === 'numeral' || variant === 'numeralXl';
  const color = tone === 'default' ? (numeral ? colors.numeral : colors.text) : tone === 'muted' ? colors.textMuted : colors[tone];
  const textStyle = [type[face], { color }, pretty ? PRETTY_WRAP : null, style];
  return (
    <RNText
      testID={testID}
      numberOfLines={numberOfLines}
      textBreakStrategy={pretty ? PRETTY_BREAK : undefined}
      style={textStyle}
      accessibilityRole={variant === 'display' || variant === 'title' ? 'header' : undefined}
    >
      {withClauseDots(children, StyleSheet.flatten(textStyle))}
    </RNText>
  );
}
