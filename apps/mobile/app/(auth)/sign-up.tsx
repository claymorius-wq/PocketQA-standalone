import { Link, router } from 'expo-router';
import { UserPlus } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSession } from '../../src/auth/SessionProvider';
import { disarmU1, RoleNote, UnderlinedLink } from '../../src/screens/authParts';
import { Button, Card, Field, Notice, Row, Screen, Segmented, Text } from '../../src/ui';
import { GoogleButton } from '../../src/ui/patterns';

const ROLE_NOTES = [
  { value: 'tester', text: 'Find studies that match your device, record consented sessions, and earn test credits when your work is approved.' },
  { value: 'builder', text: 'Create studies, fund them with local test credits, and review testers’ evidence.' },
] as const;

// A-SignUp (Direction A v2 §13): a stack screen (Sign in pushes it), so it arrives with the push and
// never plays the light dip. Its signature is the role switch (the violet tile slides; the role's
// description crossfades in place) and S4 when "Create account" enables and when it fires. Sign up
// is not a key moment: no Uplight.
export default function SignUp() {
  const { signUp, signInWithGoogle, authMode, googleSignIn } = useSession();
  // The same rule as Sign in: Google only on web where the deployment enables it.
  const canGoogle = authMode === 'firebase' && Platform.OS === 'web' && googleSignIn;
  const [role, setRole] = useState<'tester' | 'builder'>('tester');
  const [displayName, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Managed sign-in: the account is created after the email address is verified.
  const [verification, setVerification] = useState<'sent' | 'unsent' | 'none'>('none');
  const pwError = password && password.length < 12 ? 'Use at least 12 characters.' : null;

  async function submit() {
    setBusy(true);
    setError(null);
    setVerification('none');
    // A new account lands with the plain `replace` (no Uplight on Sign up), even if a Sign in press
    // under this screen is still waiting.
    disarmU1();
    try {
      const r = await signUp({ email: email.trim(), password, displayName: displayName.trim(), role });
      setVerification(r.verification);
    } catch (e) {
      // Show the real cause (e.g. this device couldn't store the session) instead of a generic line.
      setError(e instanceof Error && e.message ? e.message : 'Sign-up failed.');
    } finally {
      setBusy(false);
    }
  }

  /**
   * "Sign up with Google" is the same Google sign-in as Sign in's (no new flow): an identity that
   * already has an account is signed in, and a new one finishes its account on Sign in ("Finish
   * your account" there: role and name), so this screen goes back to Sign in once Google answers.
   * The role switch above applies to the email form only. No Uplight, as for "Create account".
   */
  async function google() {
    setBusy(true);
    setError(null);
    setVerification('none');
    disarmU1();
    try {
      await signInWithGoogle();
      router.replace('/sign-in');
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Google sign-in didn’t complete.');
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
        {verification === 'sent' ? (
          // One string: the notice sets it as its muted body text.
          <Notice tone="info" title="Check your email" testID="sign-up-verify">
            {`We sent a verification link to ${email.trim()}. Open it, then sign in to finish creating your account.`}
          </Notice>
        ) : null}
        {verification === 'unsent' ? (
          // The account exists, so "couldn't create" would be false; sign-in offers the resend.
          <Notice tone="warning" title="Account created, email not sent" testID="sign-up-verify-unsent">
            {`We couldn’t send the verification link to ${email.trim()}. Sign in with this email and password to send it again.`}
          </Notice>
        ) : null}
      </Card>
      {/* The primary in flow, 24 under the form card, never lit; the way back to Sign in under it. */}
      <View style={styles.actions}>
        <Button label="Create account" icon={UserPlus} onPress={submit} loading={busy} disabled={busy || !displayName || !email || password.length < 12} testID="sign-up-submit" />
        {canGoogle ? <GoogleButton intent="signUp" onPress={() => void google()} disabled={busy} testID="sign-up-google" style={styles.google} /> : null}
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
  // 10 under Create account (the actions' 5 gap plus 5), the gap between two stacked buttons.
  google: { marginTop: 5 },
  center: { justifyContent: 'center' },
  linkHit: { paddingVertical: 11, paddingHorizontal: 4 },
});
