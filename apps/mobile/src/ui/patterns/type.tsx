import { Fragment, type ReactNode } from 'react';
import { StyleSheet, Text as RNText, type StyleProp, type TextStyle } from 'react-native';
import { when } from '../../lib/format';
import { useTheme } from '../../theme/ThemeProvider';
import { ClauseDot } from '../text';

export { ClauseDot };

// Type for lists, dates and meta (CONSISTENCY.md C6; Direction A §5). One implementation each:
// - Meta: DM Mono 400 12/16 muted, tabular, one line. Only for readouts of three words or fewer
//   ("1 task", "5 slots left", "48 KB", ids). Never sentences.
// - DateText: the date is mono (`Oct 3, 2:05 PM`, lib/format `when`); a verb before it is
//   Instrument Sans 13/18 muted ("Submitted Oct 3, 2:05 PM").
// - Clauses: clauses joined by a dot 0.28em from each side (C6 `margin: 0 0.28em`). RN adaptation:
//   React Native text has no per-span margin or nowrap, so the dot sits between a space and a
//   no-break space, each tracked to exactly 0.28em of the text's own face (ClauseDot in ui/text:
//   0.28em less that face's measured space advance). The no-break space glues the dot to the
//   clause after it: a line can break before a dot, never after one, which is the board's "no line
//   ends on a dot" rule. The kit's Text sets a " · " written into its string the same way (a Screen
//   subtitle, a disclaimer), keeping the characters as written.
// - Byline: the person in 600 text colour, the rest 400 muted.
// - Amount: Red Hat Display 400 18/24 tabular; +50 in success, −250 (U+2212) in text colour.

/**
 * The separator as plain text, for strings that cannot hold a nested Text (an accessibility label):
 * a space before the dot, a no-break space after it. Visible clauses use ClauseDot.
 */
export const CLAUSE_SEPARATOR = ' · ';

/** The type size a separator falls back to (the small / meta line, 13). */
const DEFAULT_SIZE = 13;

/** The font size a style resolves to (for ClauseDot's tracking). */
export function fontSizeOf(style: StyleProp<TextStyle>): number {
  return StyleSheet.flatten(style)?.fontSize ?? DEFAULT_SIZE;
}

/** The font family a style resolves to (for ClauseDot's tracking: each face has its own space advance). */
export function fontFamilyOf(style: StyleProp<TextStyle>): string | undefined {
  return StyleSheet.flatten(style)?.fontFamily;
}

export function Meta({ children, testID, style, tone = 'muted' }: { children: ReactNode; testID?: string; style?: StyleProp<TextStyle>; tone?: 'muted' | 'default' }) {
  const { colors, type } = useTheme();
  return (
    <RNText testID={testID} numberOfLines={1} style={[type.meta, { color: tone === 'muted' ? colors.textMuted : colors.text }, style]}>
      {children}
    </RNText>
  );
}

/**
 * A date (C6). `iso` is the server timestamp the screens already hold; it is printed with the
 * app's `when()` so every date reads `Oct 3, 2:05 PM`. `verb` ("Joined", "Submitted") is set in
 * Instrument Sans before it. A card header shows the bare date, right-aligned on the pill row.
 */
export function DateText({ iso, verb, testID, style }: { iso: string | null | undefined; verb?: string; testID?: string; style?: StyleProp<TextStyle> }) {
  const { colors, type } = useTheme();
  const date = <RNText style={[type.meta, { color: colors.textMuted }]}>{when(iso)}</RNText>;
  if (!verb) {
    return (
      <RNText testID={testID} numberOfLines={1} style={[type.meta, { color: colors.textMuted }, style]}>
        {when(iso)}
      </RNText>
    );
  }
  return (
    <RNText testID={testID} style={[type.small, { color: colors.textMuted }, style]}>
      {verb} {date}
    </RNText>
  );
}

/** Clauses joined by a dot that never ends a line. Strings and inline Text nodes both work. */
export function Clauses({ parts, testID, style, numberOfLines }: { parts: ReactNode[]; testID?: string; style?: StyleProp<TextStyle>; numberOfLines?: number }) {
  const { colors, type } = useTheme();
  const shown = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== '');
  const size = fontSizeOf([type.small, style]);
  const family = fontFamilyOf([type.small, style]);
  return (
    <RNText testID={testID} numberOfLines={numberOfLines} style={[type.small, { color: colors.textMuted }, style]}>
      {shown.map((p, i) => (
        <Fragment key={i}>
          {i > 0 ? <ClauseDot fontSize={size} fontFamily={family} /> : null}
          {p}
        </Fragment>
      ))}
    </RNText>
  );
}

/** "Tara Tester · 0 evidence items · 2 notes": the person leads in 600, the clauses follow muted. */
export function Byline({ name, parts = [], testID }: { name: string; parts?: ReactNode[]; testID?: string }) {
  const { colors, type } = useTheme();
  // The 600 face: the loaded Lens style names the weight's own file (no fontWeight, see tokens.ts
  // face()); the system fallback carries the explicit weight.
  const person = <RNText style={[type.small, { color: colors.text, fontFamily: type.heading.fontFamily, fontWeight: type.heading.fontWeight }]}>{name}</RNText>;
  return <Clauses testID={testID} parts={[person, ...parts]} />;
}

/** The minus sign amounts use (U+2212), never a hyphen. */
export const MINUS = '−';

/** Formats a signed credit amount the way the ledger shows it: +50, −250. */
export function signedAmount(n: number): string {
  return `${n >= 0 ? '+' : MINUS}${Math.abs(n).toLocaleString('en-US')}`;
}

/**
 * A signed amount, right-aligned at the end of a row. Screen readers hear the words ("plus 50 test
 * credits"), not the glyphs. `unit` names what is counted (default "test credits").
 */
export function Amount({ value, unit = 'test credits', testID, style }: { value: number; unit?: string; testID?: string; style?: StyleProp<TextStyle> }) {
  const { colors, type } = useTheme();
  const words = `${value >= 0 ? 'plus' : 'minus'} ${Math.abs(value).toLocaleString('en-US')} ${unit}`;
  return (
    <RNText testID={testID} accessibilityLabel={words} style={[type.amount, { color: value >= 0 ? colors.success : colors.text, textAlign: 'right' }, style]}>
      {signedAmount(value)}
    </RNText>
  );
}
