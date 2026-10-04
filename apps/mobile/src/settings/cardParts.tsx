import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { GlassTile, type GlyphName } from '../icons';
import { Text } from '../ui';
import { Enter, useMountedLate } from '../ui/screen';

// Pieces the Settings cards share (A-Settings board): SettingsScreen's Device profile and Your
// data cards and the wallet card (src/wallet/WalletSection) all open with the same header row.
// They live in this neutral module, below both src/screens and src/wallet, so the wallet feature
// never imports from a screen. Interim home: they belong in src/ui/patterns (shared request).

/** A card's header row: the 40dp glyph tile, the title (19 Red Hat Display), an optional trailing status. */
export function CardHead({ glyph, title, right }: { glyph: GlyphName; title: string; right?: ReactNode }) {
  return (
    <View style={styles.row}>
      <GlassTile name={glyph} size="list" />
      <View style={styles.title}>
        <Text variant="title">{title}</Text>
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

/**
 * Content that appears after its screen's entrance (the Android API field, the wallet's swapped
 * controls) enters by itself, the way a late Notice does; on first render it simply stands.
 */
export function LateEnter({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const late = useMountedLate();
  return late ? (
    <Enter step={0} delay={0} style={style}>
      {children}
    </Enter>
  ) : (
    <View style={style}>{children}</View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  title: { flex: 1, minWidth: 0 },
  right: { flexShrink: 0 },
});
