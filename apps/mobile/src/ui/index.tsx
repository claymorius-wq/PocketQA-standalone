import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlertTriangle, CheckSquare, CircleAlert, Info, Lock, RefreshCw, Square, WifiOff, type LucideIcon } from 'lucide-react-native';
import { ApiError } from '../api/client';
import { useTheme } from '../theme/ThemeProvider';
import { radius, space, TOUCH, type as typo } from '../theme/tokens';

type Variant = keyof typeof typo;
type Tone = 'default' | 'muted' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export function Text({ children, variant = 'body', tone = 'default', style, testID, numberOfLines }: {
  children: ReactNode;
  variant?: Variant;
  tone?: Tone;
  style?: StyleProp<TextStyle>;
  testID?: string;
  numberOfLines?: number;
}) {
  const { colors } = useTheme();
  const color = tone === 'default' ? colors.text : tone === 'muted' ? colors.textMuted : colors[tone];
  return (
    <RNText testID={testID} numberOfLines={numberOfLines} style={[typo[variant], { color }, style]} accessibilityRole={variant === 'display' || variant === 'title' ? 'header' : undefined}>
      {children}
    </RNText>
  );
}

export function Screen({ children, title, subtitle, scroll = true, testID, right }: {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  scroll?: boolean;
  testID?: string;
  right?: ReactNode;
}) {
  const { colors } = useTheme();
  const header = title ? (
    <View style={styles.header}>
      <View style={{ flex: 1 }}>
        <Text variant="display">{title}</Text>
        {subtitle ? <Text tone="muted" style={{ marginTop: 2 }}>{subtitle}</Text> : null}
      </View>
      {right}
    </View>
  ) : null;
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.background }} testID={testID}>
      {scroll ? (
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.column}>
            {header}
            {children}
          </View>
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }]}>
          <View style={[styles.column, { flex: 1 }]}>
            {header}
            {children}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

export function Card({ children, style, testID, onPress, accessibilityLabel }: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const { colors } = useTheme();
  const base = [styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style];
  if (!onPress) return <View style={base} testID={testID}>{children}</View>;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [...base, { minHeight: TOUCH }, pressed && { backgroundColor: colors.surfaceAlt }]}
    >
      {children}
    </Pressable>
  );
}

export function Button({ label, onPress, variant = 'primary', icon: Icon, loading, disabled, testID, accessibilityHint, style }: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: LucideIcon;
  loading?: boolean;
  disabled?: boolean;
  testID?: string;
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const palette = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    secondary: { bg: colors.surface, fg: colors.text, border: colors.borderStrong },
    danger: { bg: colors.surface, fg: colors.danger, border: colors.danger },
    ghost: { bg: 'transparent', fg: colors.primary, border: 'transparent' },
  }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      testID={testID}
      onPress={off ? undefined : onPress}
      disabled={!!off}
      aria-disabled={!!off}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: off ? 0.55 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={palette.fg} /> : Icon ? <Icon size={18} color={palette.fg} /> : null}
      <Text variant="heading" style={{ color: palette.fg }}>{label}</Text>
    </Pressable>
  );
}

export function Field({ label, value, onChangeText, error, hint, secure, multiline, keyboardType, testID, placeholder, autoCapitalize }: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  error?: string | null;
  hint?: string;
  secure?: boolean;
  multiline?: boolean;
  keyboardType?: 'default' | 'email-address' | 'number-pad';
  testID?: string;
  placeholder?: string;
  autoCapitalize?: 'none' | 'sentences' | 'words';
}) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="label" tone="muted">{label.toUpperCase()}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secure}
        multiline={multiline}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        autoCapitalize={autoCapitalize ?? (secure || keyboardType === 'email-address' ? 'none' : 'sentences')}
        accessibilityLabel={label}
        style={[
          styles.input,
          typo.body,
          { color: colors.text, backgroundColor: colors.surface, borderColor: error ? colors.danger : colors.borderStrong },
          multiline && { minHeight: 96, textAlignVertical: 'top', paddingTop: space.md },
        ]}
      />
      {error ? <Text variant="small" tone="danger" testID={testID ? `${testID}-error` : undefined}>{error}</Text> : hint ? <Text variant="small" tone="muted">{hint}</Text> : null}
    </View>
  );
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  draft: 'neutral',
  published: 'success',
  paused: 'warning',
  closed: 'neutral',
  consented: 'info',
  in_progress: 'info',
  submitted: 'warning',
  approved: 'success',
  rejected: 'danger',
  disputed: 'warning',
  resolved: 'neutral',
  withdrawn: 'neutral',
  open: 'warning',
  awaiting_signature: 'info',
  pending: 'warning',
  confirmed: 'success',
  failed: 'danger',
  expired: 'neutral',
  suspended: 'danger',
  ok: 'success',
};

export function StatusPill({ status, label, testID }: { status: string; label?: string; testID?: string }) {
  const { colors } = useTheme();
  const tone = STATUS_TONE[status] ?? 'neutral';
  const fg = tone === 'neutral' ? colors.textMuted : colors[tone];
  const bg = tone === 'neutral' ? colors.neutralBg : colors[`${tone}Bg`];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]} testID={testID} accessibilityLabel={`Status: ${label ?? status.replace(/_/g, ' ')}`}>
      <Text variant="label" style={{ color: fg }}>{(label ?? status.replace(/_/g, ' ')).toUpperCase()}</Text>
    </View>
  );
}

export function Notice({ tone = 'info', title, children, testID }: { tone?: 'info' | 'warning' | 'danger' | 'success'; title: string; children?: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  const Icon = tone === 'danger' ? CircleAlert : tone === 'warning' ? AlertTriangle : Info;
  return (
    <View testID={testID} accessibilityRole="summary" style={[styles.notice, { backgroundColor: colors[`${tone}Bg`], borderColor: colors[tone] }]}>
      <Icon size={20} color={colors[tone]} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="heading" style={{ color: colors[tone] }}>{title}</Text>
        {typeof children === 'string' ? <Text variant="small">{children}</Text> : children}
      </View>
    </View>
  );
}

export function Row({ children, style, gap = space.sm }: { children: ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap, flexWrap: 'wrap' }, style]}>{children}</View>;
}

export function Section({ title, children, right, testID }: { title: string; children: ReactNode; right?: ReactNode; testID?: string }) {
  return (
    <View style={{ gap: space.sm, marginTop: space.lg }} testID={testID}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Text variant="title">{title}</Text>
        {right}
      </Row>
      {children}
    </View>
  );
}

export function EmptyState({ icon: Icon, title, body, action, testID }: { icon: LucideIcon; title: string; body: string; action?: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty} testID={testID ?? 'empty-state'}>
      <Icon size={32} color={colors.textMuted} />
      <Text variant="heading" style={{ textAlign: 'center' }}>{title}</Text>
      <Text tone="muted" style={{ textAlign: 'center' }}>{body}</Text>
      {action}
    </View>
  );
}

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.empty} testID="loading-state" accessibilityLabel={label} accessibilityRole="progressbar">
      <ActivityIndicator color={colors.primary} />
      <Text tone="muted">{label}</Text>
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const e = error instanceof ApiError ? error : null;
  const offline = e?.code === 'OFFLINE';
  const notFound = e?.code === 'NOT_FOUND';
  if (e?.code === 'FORBIDDEN_ROLE') {
    // Unauthorized: retrying can't help, so no Retry button.
    return <EmptyState testID="forbidden-state" icon={Lock} title="Not allowed" body={e.message} />;
  }
  return (
    <EmptyState
      testID={offline ? 'offline-state' : notFound ? 'not-found-state' : 'error-state'}
      icon={offline ? WifiOff : AlertTriangle}
      title={offline ? 'You’re offline' : notFound ? 'Not found' : 'Something went wrong'}
      body={offline ? 'Can’t reach the local Pocket QA server. Check that the API is running, then retry.' : notFound ? 'This item doesn’t exist or you don’t have access to it.' : (e?.message ?? 'Please try again.')}
      action={onRetry && !notFound ? <Button label="Retry" icon={RefreshCw} variant="secondary" onPress={onRetry} testID="retry-button" /> : undefined}
    />
  );
}

/** Renders loading / error / offline / empty states around a react-query result. */
export function QueryState<T>({ query, empty, children }: {
  query: { isLoading: boolean; error: unknown; data: T | undefined; refetch: () => unknown };
  empty?: (data: T) => ReactNode | null;
  children: (data: T) => ReactNode;
}) {
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (query.data === undefined) return <LoadingState />;
  const e = empty?.(query.data);
  return <>{e ?? children(query.data)}</>;
}

export function Segmented<T extends string>({ options, value, onChange, testID }: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segmented, { borderColor: colors.borderStrong, backgroundColor: colors.surface }]} accessibilityRole="radiogroup" testID={testID}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            testID={testID ? `${testID}-${o.value}` : undefined}
            onPress={() => onChange(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[styles.segment, on && { backgroundColor: colors.primary }]}
          >
            <Text variant="heading" style={{ color: on ? colors.onPrimary : colors.text }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Checkbox({ checked, onChange, label, testID }: { checked: boolean; onChange: (v: boolean) => void; label: string; testID?: string }) {
  const { colors } = useTheme();
  const Icon = checked ? CheckSquare : Square;
  return (
    <Pressable testID={testID} onPress={() => onChange(!checked)} accessibilityRole="checkbox" accessibilityState={{ checked }} style={styles.checkbox}>
      <Icon size={24} color={checked ? colors.primary : colors.borderStrong} />
      <Text style={{ flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

/** In-app confirmation (native alerts don't exist on web, and block automation). */
export function ConfirmSheet({ visible, title, body, confirmLabel, destructive, onConfirm, onCancel, children, confirmDisabled, loading }: {
  visible: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
  confirmDisabled?: boolean;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  // Unmount when closed: react-native-web's fade-out can leave a closed Modal mounted
  // and visible over the page (found by e2e/admin-dispute.spec.ts).
  if (!visible) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]} testID="confirm-sheet" accessibilityViewIsModal>
          <Text variant="title">{title}</Text>
          {body ? <Text tone="muted">{body}</Text> : null}
          {children}
          <Row style={{ justifyContent: 'flex-end', marginTop: space.sm }}>
            <Button label="Cancel" variant="secondary" onPress={onCancel} testID="confirm-cancel" />
            <Button label={confirmLabel} variant={destructive ? 'danger' : 'primary'} onPress={onConfirm} disabled={confirmDisabled} loading={loading} testID="confirm-ok" />
          </Row>
        </View>
      </View>
    </Modal>
  );
}

export function Divider() {
  const { colors } = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: space.sm }} />;
}

const styles = StyleSheet.create({
  content: { padding: space.lg, paddingBottom: space.xxl * 2 },
  column: { width: '100%', maxWidth: 720, alignSelf: 'center', gap: space.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, marginBottom: space.sm },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  button: { minHeight: TOUCH, borderRadius: radius.md, borderWidth: 1.5, paddingHorizontal: space.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm },
  input: { minHeight: TOUCH, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: space.md },
  pill: { borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 3, alignSelf: 'flex-start' },
  notice: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: 1, alignItems: 'flex-start' },
  empty: { alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.xxl, paddingHorizontal: space.lg },
  segmented: { flexDirection: 'row', borderWidth: 1.5, borderRadius: radius.md, overflow: 'hidden' },
  segment: { flex: 1, minHeight: TOUCH, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.sm },
  checkbox: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: TOUCH },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: space.lg },
  sheet: { width: '100%', maxWidth: 480, borderRadius: radius.lg, borderWidth: 1, padding: space.xl, gap: space.md },
});
