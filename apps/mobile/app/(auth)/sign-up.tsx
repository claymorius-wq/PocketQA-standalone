import { Link } from 'expo-router';
import { UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { useSession } from '../../src/auth/SessionProvider';
import { Button, Card, Field, Notice, Row, Screen, Segmented, Text } from '../../src/ui';

export default function SignUp() {
  const { signUp } = useSession();
  const [role, setRole] = useState<'tester' | 'builder'>('tester');
  const [displayName, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pwError = password && password.length < 12 ? 'Use at least 12 characters.' : null;

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signUp({ email: email.trim(), password, displayName: displayName.trim(), role });
    } catch (e) {
      // Show the real cause (e.g. this device couldn't store the session) instead of a generic line.
      setError(e instanceof Error && e.message ? e.message : 'Sign-up failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Create account" subtitle="Choose how you’ll use Pocket QA." testID="sign-up-screen">
      <Card>
        <Segmented
          testID="role"
          value={role}
          onChange={setRole}
          options={[
            { value: 'tester', label: 'I test apps' },
            { value: 'builder', label: 'I build apps' },
          ]}
        />
        <Text variant="small" tone="muted">
          {role === 'tester'
            ? 'Find studies that match your device, record consented sessions, and earn test credits when your work is approved.'
            : 'Create studies, fund them with local test credits, and review testers’ evidence.'}
        </Text>
        <Field label="Display name" value={displayName} onChangeText={setName} testID="sign-up-name" autoCapitalize="words" />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" testID="sign-up-email" />
        <Field label="Password" value={password} onChangeText={setPassword} secure error={pwError} hint="At least 12 characters." testID="sign-up-password" />
        {error ? <Notice tone="danger" title="Couldn’t create account" testID="sign-up-error">{error}</Notice> : null}
        <Button label="Create account" icon={UserPlus} onPress={submit} loading={busy} disabled={!displayName || !email || password.length < 12} testID="sign-up-submit" />
      </Card>
      <Row style={{ justifyContent: 'center' }}>
        <Text tone="muted">Already have an account?</Text>
        <Link href="/sign-in" testID="go-sign-in">
          <Text tone="primary" variant="heading">Sign in</Text>
        </Link>
      </Row>
    </Screen>
  );
}
