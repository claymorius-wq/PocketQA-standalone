import { Fragment, type ReactNode } from 'react';
import { Text as RNText, type StyleProp, type TextStyle } from 'react-native';
import { when } from '../../lib/format';
import { useTheme } from '../../theme/ThemeProvider';

// Type for lists, dates and meta (CONSISTENCY.md C6; Direction A §5). One implementation each:
// - Meta: DM Mono 400 12/16 muted, tabular, one line. Only for readouts of three words or fewer
//   ("1 task", "5 slots left", "48 KB", ids). Never sentences.
// - DateText: the date is mono (`Oct 3, 2:05 PM`, lib/format `when`); a verb before it is
//   Instrument Sans 13/18 muted ("Submitted Oct 3, 2:05 PM").
// - Clauses: clauses joined by " · ". RN adaptation: React Native text has no per-span nowrap, so
//   the dot is glued to the clause after it with a no-break space; a line can break before a dot,
//   never after one, which is the board's "no line ends on a dot" rule.
// - Byline: the person in 600 text colour, the rest 400 muted.
// - Amount: Red Hat Display 400 18/24 tabular; +50 in success, −250 (U+2212) in text colour.

/** The separator between clauses: a regular space before the dot, a no-break space after it. */
export const CLAUSE_SEPARATOR = ' · ';

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
  return (
    <RNText testID={testID} numberOfLines={numberOfLines} style={[type.small, { color: colors.textMuted }, style]}>
      {shown.map((p, i) => (
        <Fragment key={i}>
          {i > 0 ? CLAUSE_SEPARATOR : null}
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
