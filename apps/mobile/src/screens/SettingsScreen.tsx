import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text as RNText, View } from 'react-native';
import type { DeviceProfile } from '@pocket-qa/contracts';
import { api, ApiError } from '../api/client';
import { useSession } from '../auth/SessionProvider';
import { GradientRule } from '../glass/paint';
import { useAiStatus } from '../lib/queries';
import { useTheme, type ThemePreference } from '../theme/ThemeProvider';
import { Button, Card, ConfirmSheet, Field, Notice, Screen, Segmented, StatusPill, Text } from '../ui';
import { SectionHeader, SheetFailure } from '../ui/patterns';
import { WalletSection } from '../wallet/WalletSection';
import { CardHead, LateEnter } from '../settings/cardParts';

// Settings in the Lens (A-Settings board, one board for every role): Appearance is an instrument
// control on the ground; Matching (testers), Wallet (testers and builders) and Account are L1 cards
// stepping away from the light (k = 1, 0.8, 0.64); AI analysis is a readout on the ground; Sign out
// sits on the ground under Account. Signature (§13): the segment tile slides and "Device profile
// saved" enters. There is no Uplight on this screen: linking a wallet is not a payment (§14) and
// deleting an account is destructive.

function guessDevice(): DeviceProfile {
  const os = Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : 'web';
  return {
    platform: os,
    osVersion: os === 'web' ? 'Browser' : String(Platform.Version),
    androidApiLevel: os === 'android' ? Number(Platform.Version) : null,
    model: os === 'web' ? 'Web preview' : 'My phone',
    languages: ['en'],
  };
}

/** A settings section: the heading with its fading rule, then the section's card (board: gap 12, 30 between sections). */
function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <SectionHeader title={title} rule />
      {children}
    </View>
  );
}

function DeviceForm() {
  const { user, refreshUser } = useSession();
  const qc = useQueryClient();
  const initial = user?.device ?? guessDevice();
  const [platform, setPlatform] = useState<DeviceProfile['platform']>(initial.platform);
  const [osVersion, setOs] = useState(initial.osVersion);
  const [api_, setApi] = useState(initial.androidApiLevel ? String(initial.androidApiLevel) : '');
  const [model, setModel] = useState(initial.model);
  const [langs, setLangs] = useState(initial.languages.join(', '));
  const save = useMutation({
    mutationFn: () =>
      api('putDevice', {
        body: {
          platform,
          osVersion: osVersion.trim(),
          androidApiLevel: platform === 'android' && api_ ? Number(api_) : null,
          model: model.trim(),
          languages: langs.split(',').map((l) => l.trim()).filter(Boolean),
        },
      }),
    onSuccess: () => {
      void refreshUser();
      // Eligibility depends on the device profile.
      void qc.invalidateQueries({ queryKey: ['eligible'] });
    },
  });
  const android = platform === 'android';
  const modelField = <Field label="Device model" value={model} onChangeText={setModel} testID="device-model" />;
  return (
    // Matching sits nearest the light (k = 1).
    <Card testID="device-form" k={1} style={styles.card}>
      <CardHead glyph="device" title="Device profile" />
      <Text variant="small" tone="muted" style={styles.lead}>Self-reported and not verified. Used only to match you with studies.</Text>
      <View style={styles.platform}>
        <Segmented
          testID="device-platform"
          value={platform}
          onChange={setPlatform}
          options={[
            { value: 'android', label: 'Android' },
            { value: 'ios', label: 'iOS' },
            { value: 'web', label: 'Web' },
          ]}
        />
      </View>
      {/* The board's two-column field grid: OS beside API level on Android (model below), else OS beside model. */}
      <View style={styles.grid}>
        <View style={styles.gridRow}>
          <View style={styles.cell}>
            <Field label="OS version" value={osVersion} onChangeText={setOs} testID="device-os" />
          </View>
          {android ? (
            <LateEnter style={styles.cell}>
              <Field label="Android API level" value={api_} onChangeText={setApi} keyboardType="number-pad" hint="Android 14 is API 34." testID="device-api" />
            </LateEnter>
          ) : (
            <View style={styles.cell}>{modelField}</View>
          )}
        </View>
        {android ? modelField : null}
        <Field label="Languages" value={langs} onChangeText={setLangs} hint="Comma-separated, e.g. en, es" testID="device-languages" />
      </View>
      {save.error ? (
        <View style={styles.notice}>
          <Notice tone="danger" title="Couldn’t save">{(save.error as ApiError).message}</Notice>
        </View>
      ) : null}
      {save.isSuccess ? (
        <View style={styles.notice}>
          <Notice tone="success" title="Device profile saved" testID="device-saved" />
        </View>
      ) : null}
      <View style={styles.save}>
        <Button label="Save device profile" icon="save" onPress={() => save.mutate()} loading={save.isPending} testID="device-save" />
      </View>
    </Card>
  );
}

function AccountData() {
  const { signOut } = useSession();
  const { colors } = useTheme();
  const [confirm, setConfirm] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [exported, setExported] = useState<string | null>(null);
  const exp = useMutation({
    mutationFn: () => api('exportMe'),
    onSuccess: (bundle) => {
      const json = JSON.stringify(bundle, null, 2);
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
        a.download = 'pocket-qa-export.json';
        a.click();
        URL.revokeObjectURL(a.href);
      }
      const transfers = bundle.payments.received.length + bundle.payments.fundings.length + bundle.payments.refunds.length + bundle.payments.studyPayments.length;
      setExported(
        `${bundle.participations.length} participations, ${bundle.studies.length} studies, ${bundle.evidence.length} evidence items, ${bundle.ledger.length} ledger entries, ${transfers} wallet escrow records (each labelled with its settlement), ${bundle.reputation.events.length} reputation events.`,
      );
    },
  });
  const del = useMutation({
    mutationFn: () => api('deleteMe', { body: { confirm: 'DELETE MY ACCOUNT' } }),
    onSuccess: () => signOut(),
  });
  // The rose hairline between keeping your data and deleting it, lit at its near end.
  const roseRule = [
    { offset: 0, color: colors.danger, opacity: 0.26 },
    { offset: 0.55, color: colors.danger, opacity: 0.06 },
    { offset: 1, color: colors.danger, opacity: 0 },
  ];
  return (
    // Furthest from the light (k = 0.64).
    <Card k={0.64} style={styles.card}>
      <CardHead glyph="download" title="Your data" />
      <Text variant="bodySm" tone="muted" style={styles.lead}>Export everything you own, or delete your account. Deletion removes your media and personal details; anonymous test-credit records stay so other people’s balances remain correct.</Text>
      <View style={styles.actions}>
        <Button label="Export my data" icon="download" variant="secondary" onPress={() => exp.mutate()} loading={exp.isPending} testID="export-data" />
        {exported ? <Notice tone="success" title="Export ready" testID="export-done">{exported}</Notice> : null}
        <GradientRule stops={roseRule} style={styles.roseRule} />
        <Button label="Delete account" icon="remove" variant="danger" onPress={() => setConfirm(true)} testID="delete-account" />
      </View>
      <ConfirmSheet
        visible={confirm}
        title="Delete your account?"
        body="This can’t be undone. Type DELETE MY ACCOUNT to confirm."
        confirmLabel="Delete forever"
        destructive
        confirmDisabled={phrase !== 'DELETE MY ACCOUNT'}
        loading={del.isPending}
        onCancel={() => setConfirm(false)}
        onConfirm={() => del.mutate()}
      >
        <Field label="Confirmation" value={phrase} onChangeText={setPhrase} autoCapitalize="none" testID="delete-phrase" />
        {/* C4's failure notice: role alert, announced, the server's reason under the title. */}
        {del.error ? <SheetFailure title="Couldn’t delete" message={(del.error as ApiError).message} /> : null}
      </ConfirmSheet>
    </Card>
  );
}

/** AI analysis: an unlit readout on the ground, not a card (the provider is switched off in this build). */
function AiStatus() {
  const { colors, type } = useTheme();
  const ai = useAiStatus();
  return (
    <View testID="ai-status" style={[styles.section, styles.ai]}>
      <View style={styles.aiHead}>
        <View style={styles.aiTitles}>
          <RNText accessibilityRole="header" style={[type.heading, { color: colors.text }]}>AI analysis</RNText>
          <Text variant="small" tone="muted">Analysis provider</Text>
        </View>
        <View style={styles.aiPill}>
          <StatusPill status={ai.data?.available ? 'ok' : 'expired'} label={ai.data?.available ? 'Available' : 'Unavailable'} />
        </View>
      </View>
      <Text variant="bodySm" tone="muted" style={styles.aiBody}>Analysis unavailable: no AI provider is configured in this build. Findings are written by people only.</Text>
    </View>
  );
}

export function SettingsScreen() {
  const { user, signOut } = useSession();
  const { colors, type, preference, setPreference } = useTheme();
  return (
    <Screen title="Settings" subtitle={user ? `${user.displayName} · ${user.role}` : undefined} testID="settings-screen">
      {/* Appearance: an instrument control on the ground, no card. A preference: only the tile slides. */}
      <View style={styles.appearance}>
        <RNText accessibilityRole="header" style={[type.heading, styles.appearanceTitle, { color: colors.text }]}>Appearance</RNText>
        <View style={styles.themeControl}>
          <Segmented<ThemePreference>
            testID="theme"
            value={preference}
            onChange={setPreference}
            options={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
          />
        </View>
      </View>
      {user?.role === 'tester' ? (
        <SettingsSection title="Matching">
          <DeviceForm />
        </SettingsSection>
      ) : null}
      {user?.role !== 'admin' ? (
        <SettingsSection title="Wallet">
          <WalletSection />
        </SettingsSection>
      ) : null}
      <AiStatus />
      <SettingsSection title="Account">
        <AccountData />
        <Button label="Sign out" icon="signOut" variant="secondary" onPress={() => void signOut()} testID="sign-out" style={styles.signOut} />
      </SettingsSection>
    </Screen>
  );
}

// The Screen column puts 14 between steps; sections add 16 for the board's 30.
const SECTION_GAP = 16;

const styles = StyleSheet.create({
  appearance: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16, paddingLeft: 4, marginTop: 8 },
  appearanceTitle: { flexShrink: 0 },
  // The board's 240dp three-way control; it gives way on a narrow phone rather than overflow.
  themeControl: { flexBasis: 240, flexGrow: 0, flexShrink: 1, minWidth: 0 },
  section: { gap: 12, marginTop: SECTION_GAP },
  // Board card: 18 all round; children carry the board's own spacing instead of the kit's 8dp gap.
  card: { gap: 0, paddingBottom: 18, paddingLeft: 18 },
  lead: { marginTop: 12 },
  platform: { marginTop: 18 },
  grid: { marginTop: 16, gap: 14 },
  gridRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  cell: { flex: 1, minWidth: 0 },
  notice: { marginTop: 16 },
  save: { marginTop: 18 },
  actions: { marginTop: 16, gap: 10 },
  roseRule: { marginVertical: 6, marginHorizontal: 2 },
  ai: { gap: 10, paddingLeft: 4 },
  aiHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  aiTitles: { flexShrink: 1, minWidth: 0, gap: 2 },
  aiPill: { flexShrink: 0 },
  aiBody: { maxWidth: 330 },
  // Sign out on the ground under Account: hugs its label (board: padding 0 24 0 18, 2 below the gap).
  signOut: { alignSelf: 'flex-start', paddingLeft: 18, paddingRight: 24, marginTop: 2 },
});
