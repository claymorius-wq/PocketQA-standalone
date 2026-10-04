import { Link } from 'expo-router';
import { UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../../src/auth/SessionProvider';
import { disarmU1, RoleNote, UnderlinedLink } from '../../src/screens/authParts';
import { Button, Card, Field, Notice, Row, Screen, Segmented, Text } from '../../src/ui';

const ROLE_NOTES = [
  { value: 'tester', text: 'Find studies that match your device, record consented sessions, and earn test credits when your work is approved.' },
  { value: 'builder', text: 'Create studies, fund them with local test credits, and review testers’ evidence.' },
] as const;

// A-SignUp (Direction A v2 §13): a stack screen (Sign in pushes it), so it arrives with the push and
// never plays the light dip. Its signature is the role switch (the violet tile slides; the role's
// description crossfades in place) and S4 when "Create account" enables and when it fires. Sign up
// is not a key moment: no Uplight.
export default function SignUp() {
  const { signUp } = useSession();
  const [role, setRole] = useState<'tester' | 'builder'>('tester');
  const [displayName, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Managed sign-in: the account is created after the email address is verified.
  const [verificationSent, setVerificationSent] = useState(false);
  const pwError = password && password.length < 12 ? 'Use at least 12 characters.' : null;

  async function submit() {
    setBusy(true);
    setError(null);
    // A new account lands with the plain `replace` (no Uplight on Sign up), even if a Sign in press
    // under this screen is still waiting.
    disarmU1();
    try {
      const r = await signUp({ email: email.trim(), password, displayName: displayName.trim(), role });
      setVerificationSent(r.verificationSent);
    } catch (e) {
      // Show the real cause (e.g. this device couldn't store the session) instead of a generic line.
      setError(e instanceof Error && e.message ? e.message : 'Sign-up failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Create account" subtitle="Choose how you’ll use Pocket QA." testID="sign-up-screen">
      {/* The role switch and what the chosen role does, above the form (A-SignUp). */}
      <View style={styles.roles}>
        <Segmented
          testID="role"
          value={role}
          onChange={setRole}
          options={[
            { value: 'tester', label: 'I test apps', glyph: 'discover' },
            { value: 'builder', label: 'I build apps', glyph: 'studies' },
          ]}
        />
        <RoleNote value={role} notes={ROLE_NOTES} />
      </View>
      <Card style={styles.form}>
        <Field label="Display name" value={displayName} onChangeText={setName} testID="sign-up-name" autoCapitalize="words" />
        <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" testID="sign-up-email" />
        <Field label="Password" value={password} onChangeText={setPassword} secure error={pwError} hint="At least 12 characters." testID="sign-up-password" />
        {error ? <Notice tone="danger" title="Couldn’t create account" testID="sign-up-error">{error}</Notice> : null}
        {verificationSent ? (
          // One string, so the notice sets it as its muted body text (the kit only wraps a string).
          <Notice tone="info" title="Check your email" testID="sign-up-verify">
            {`We sent a verification link to ${email.trim()}. Open it, then sign in to finish creating your account.`}
          </Notice>
        ) : null}
      </Card>
      {/* The primary in flow, 24 under the form card, never lit; the way back to Sign in under it. */}
      <View style={styles.actions}>
        <Button label="Create account" icon={UserPlus} onPress={submit} loading={busy} disabled={!displayName || !email || password.length < 12} testID="sign-up-submit" />
        <Row gap={6} style={styles.center}>
          <Text tone="muted">Already have an account?</Text>
          <UnderlinedLink>
            <Link href="/sign-in" testID="go-sign-in" style={styles.linkHit}>
              <Text tone="primary" variant="heading">Sign in</Text>
            </Link>
          </UnderlinedLink>
        </Row>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  roles: { gap: 10 },
  // A-SignUp's form card: 18 16 16 padding, 12 between fields.
  form: { gap: 12, paddingRight: 16, paddingLeft: 16 },
  // 24 under the form: the screen's 14 gap plus 10.
  actions: { marginTop: 10, gap: 5 },
  center: { justifyContent: 'center' },
  linkHit: { paddingVertical: 11, paddingHorizontal: 4 },
});
