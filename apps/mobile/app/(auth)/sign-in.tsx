import { Link } from 'expo-router';
import { LogIn, ShieldCheck } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSession } from '../../src/auth/SessionProvider';
import { useTheme } from '../../src/theme/ThemeProvider';
import { space } from '../../src/theme/tokens';
import { loadDemoAccounts, PREVIEW_BUILD, type DemoAccount, type DemoRole } from '../../src/preview/demoAccounts';
import { Button, Card, Field, Notice, Row, Screen, Segmented, Text } from '../../src/ui';

const ROLE_LABEL: Record<DemoRole, string> = { tester: 'Tester', builder: 'Builder', admin: 'Admin' };

export default function SignIn() {
  const { signIn } = useSession();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Shared demo preview only: fill (never submit) a synthetic demo sign-in.
  const [demo, setDemo] = useState<DemoAccount[]>([]);
  const [demoRole, setDemoRole] = useState<DemoRole>('tester');

  function fillDemo(role: DemoRole, list = demo) {
    const a = list.find((x) => x.role === role);
    if (!a) return;
    setDemoRole(role);
    setEmail(a.email);
    setPassword(a.password);
    setError(null);
  }

  useEffect(() => {
    let live = true;
    void loadDemoAccounts().then((list) => {
      const first = list[0];
      if (!live || !first) return;
      setDemo(list);
      fillDemo(first.role, list);
    });
    return () => {
      live = false;
    };
  }, []); // load once on mount

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      // Show the real cause (e.g. this device couldn't store the session) instead of a generic line.
      setError(e instanceof Error && e.message ? e.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen testID="sign-in-screen">
      <View style={{ gap: space.xs, marginTop: space.xl }}>
        <Row>
          <ShieldCheck size={28} color={colors.primary} />
          <Text variant="label" tone="primary">POCKET QA</Text>
        </Row>
        <Text variant="display">Real-device usability tests</Text>
        <Text tone="muted">Builders fund studies with test credits. Testers record consented sessions. Every reward needs approval.</Text>
      </View>
      {demo.length ? (
        <Card testID="demo-accounts">
          <Text variant="heading">Shared demo preview</Text>
          <Text variant="small" tone="muted">Pick a role and press Sign in. Demo accounts are shared with every visitor; data is synthetic, devnet and test credits only.</Text>
          <Segmented
            options={demo.map((a) => ({ value: a.role, label: ROLE_LABEL[a.role] }))}
            value={demoRole}
            onChange={(r) => fillDemo(r)}
            testID="demo-role"
          />
        </Card>
      ) : null}
      <Card>
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" testID="sign-in-email" />
        <Field label="Password" value={password} onChangeText={setPassword} secure testID="sign-in-password" />
        {error ? <Notice tone="danger" title="Couldn’t sign in" testID="sign-in-error">{error}</Notice> : null}
        <Button label="Sign in" icon={LogIn} onPress={submit} loading={busy} disabled={!email || !password} testID="sign-in-submit" />
      </Card>
      {PREVIEW_BUILD ? null : (
        // The shared preview has no self-registration (the gate refuses it).
        <Row style={{ justifyContent: 'center' }}>
          <Text tone="muted">New here?</Text>
          <Link href="/sign-up" testID="go-sign-up">
            <Text tone="primary" variant="heading">Create an account</Text>
          </Link>
        </Row>
      )}
      <Text variant="small" tone="muted" style={{ textAlign: 'center' }}>
        {PREVIEW_BUILD ? 'Public demo preview · synthetic data · devnet and test credits only' : 'Local build · data stays on this machine'}
      </Text>
    </Screen>
  );
}
