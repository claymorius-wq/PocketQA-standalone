import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, LogOut, Save, Smartphone, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { Platform } from 'react-native';
import type { DeviceProfile } from '@pocket-qa/contracts';
import { api, ApiError } from '../api/client';
import { useSession } from '../auth/SessionProvider';
import { useAiStatus } from '../lib/queries';
import { useTheme, type ThemePreference } from '../theme/ThemeProvider';
import { Button, Card, ConfirmSheet, Field, Notice, Row, Screen, Section, Segmented, StatusPill, Text } from '../ui';
import { WalletSection } from '../wallet/WalletSection';

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

function DeviceForm() {
  const { user, refreshUser } = useSession();
  const { colors } = useTheme();
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
  return (
    <Card testID="device-form">
      <Row>
        <Smartphone size={20} color={colors.text} />
        <Text variant="heading">Device profile</Text>
      </Row>
      <Text variant="small" tone="muted">Self-reported and not verified. Used only to match you with studies.</Text>
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
      <Field label="OS version" value={osVersion} onChangeText={setOs} testID="device-os" />
      {platform === 'android' ? <Field label="Android API level" value={api_} onChangeText={setApi} keyboardType="number-pad" hint="Android 14 is API 34." testID="device-api" /> : null}
      <Field label="Device model" value={model} onChangeText={setModel} testID="device-model" />
      <Field label="Languages" value={langs} onChangeText={setLangs} hint="Comma-separated, e.g. en, es" testID="device-languages" />
      {save.error ? <Notice tone="danger" title="Couldn’t save">{(save.error as ApiError).message}</Notice> : null}
      {save.isSuccess ? <Notice tone="success" title="Device profile saved" testID="device-saved" /> : null}
      <Button label="Save device profile" icon={Save} onPress={() => save.mutate()} loading={save.isPending} testID="device-save" />
    </Card>
  );
}

function AccountData() {
  const { signOut } = useSession();
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
      setExported(`${bundle.participations.length} participations, ${bundle.studies.length} studies, ${bundle.evidence.length} evidence items, ${bundle.ledger.length} ledger entries.`);
    },
  });
  const del = useMutation({
    mutationFn: () => api('deleteMe', { body: { confirm: 'DELETE MY ACCOUNT' } }),
    onSuccess: () => signOut(),
  });
  return (
    <Card>
      <Text variant="heading">Your data</Text>
      <Text variant="small" tone="muted">Export everything you own, or delete your account. Deletion removes your media and personal details; anonymous test-credit records stay so other people’s balances remain correct.</Text>
      {exported ? <Notice tone="success" title="Export ready" testID="export-done">{exported}</Notice> : null}
      <Row>
        <Button label="Export my data" icon={Download} variant="secondary" onPress={() => exp.mutate()} loading={exp.isPending} testID="export-data" />
        <Button label="Delete account" icon={Trash2} variant="danger" onPress={() => setConfirm(true)} testID="delete-account" />
      </Row>
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
        {del.error ? <Notice tone="danger" title="Couldn’t delete">{(del.error as ApiError).message}</Notice> : null}
      </ConfirmSheet>
    </Card>
  );
}

export function SettingsScreen() {
  const { user, signOut } = useSession();
  const { preference, setPreference } = useTheme();
  const ai = useAiStatus();
  return (
    <Screen title="Settings" subtitle={user ? `${user.displayName} · ${user.role}` : undefined} testID="settings-screen">
      <Section title="Appearance">
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
      </Section>
      {user?.role === 'tester' ? (
        <Section title="Matching">
          <DeviceForm />
        </Section>
      ) : null}
      {user?.role !== 'admin' ? (
        <Section title="Wallet">
          <WalletSection />
        </Section>
      ) : null}
      <Section title="AI analysis">
        <Card testID="ai-status">
          <Row style={{ justifyContent: 'space-between' }}>
            <Text variant="heading">Analysis provider</Text>
            <StatusPill status={ai.data?.available ? 'ok' : 'expired'} label={ai.data?.available ? 'Available' : 'Unavailable'} />
          </Row>
          <Text variant="small" tone="muted">Analysis unavailable: no AI provider is configured in this build. Findings are written by people only.</Text>
        </Card>
      </Section>
      <Section title="Account">
        <AccountData />
        <Button label="Sign out" icon={LogOut} variant="secondary" onPress={() => void signOut()} testID="sign-out" />
      </Section>
    </Screen>
  );
}
