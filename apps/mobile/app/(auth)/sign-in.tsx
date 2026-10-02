import { Link } from 'expo-router';
import { LogIn, ShieldCheck } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';
import { ApiError } from '../../src/api/client';
import { useSession } from '../../src/auth/SessionProvider';
import { useTheme } from '../../src/theme/ThemeProvider';
import { space } from '../../src/theme/tokens';
import { Button, Card, Field, Notice, Row, Screen, Text } from '../../src/ui';

export default function SignIn() {
  const { signIn } = useSession();
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sign-in failed.');
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
      <Card>
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" testID="sign-in-email" />
        <Field label="Password" value={password} onChangeText={setPassword} secure testID="sign-in-password" />
        {error ? <Notice tone="danger" title="Couldn’t sign in" testID="sign-in-error">{error}</Notice> : null}
        <Button label="Sign in" icon={LogIn} onPress={submit} loading={busy} disabled={!email || !password} testID="sign-in-submit" />
      </Card>
      <Row style={{ justifyContent: 'center' }}>
        <Text tone="muted">New here?</Text>
        <Link href="/sign-up" testID="go-sign-up">
          <Text tone="primary" variant="heading">Create an account</Text>
        </Link>
      </Row>
      <Text variant="small" tone="muted" style={{ textAlign: 'center' }}>Local build · data stays on this machine</Text>
    </Screen>
  );
}
