import { Link } from 'expo-router';
import { KeyRound, LogIn, Mail, ShieldCheck, UserPlus, Wallet } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { API_BASE_URL, ApiError } from '../../src/api/client';
import { isLoopbackApi, signInFooter } from '../../src/auth/footer';
import { useSession } from '../../src/auth/SessionProvider';
import { useTheme } from '../../src/theme/ThemeProvider';
import { space } from '../../src/theme/tokens';
import { loadDemoAccounts, PREVIEW_BUILD, type DemoAccount, type DemoRole } from '../../src/preview/demoAccounts';
import { Button, Card, Field, Notice, Row, Screen, Segmented, Text } from '../../src/ui';
import type { StandardWallet } from '../../src/wallet/standard';
import { useWallets } from '../../src/wallet/useWallets';

const ROLE_LABEL: Record<DemoRole, string> = { tester: 'Tester', builder: 'Builder', admin: 'Admin' };

export default function SignIn() {
  const { signIn, authMode, storage, walletLogin, features, needsAccount, pendingProfile, signInWithGoogle, signInWithWallet, completeAccount, unverifiedEmail, resendVerification, discardUnverified, sendPasswordReset } = useSession();
  const web = Platform.OS === 'web';
  // Wallet sign-in when the server enables it: web with Wallet Standard extensions (one button
  // per wallet, ledger W1), or Android through Mobile Wallet Adapter (ledger W3). Never on the
  // shared preview. iOS has no wallet path.
  const wallets = useWallets();
  const android = Platform.OS === 'android';
  const canWallet = walletLogin && !PREVIEW_BUILD && ((web && wallets.length > 0) || android);
  const [chosenWallet, setChosenWallet] = useState<StandardWallet | undefined>(undefined);
  const [role, setRole] = useState<'tester' | 'builder'>('tester');
  const [displayName, setDisplayName] = useState('');
  // Wallet sign-in found no account for this wallet: offer to create one (a second signature).
  const [walletNew, setWalletNew] = useState(false);
  // Prefill "Finish your account" with what was typed at sign-up.
  useEffect(() => {
    if (!pendingProfile) return;
    setRole(pendingProfile.role);
    setDisplayName(pendingProfile.displayName);
  }, [pendingProfile]);
  const { colors } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Firebase mode: "Forgot password?" and "Resend verification email".
  const [resetOpen, setResetOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
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

  // Leaving sign-in after an unverified refusal signs that Firebase user out (inc2 review P3-1).
  // Refs, not deps: the session object changes on every update, and only unmount should discard.
  const unverifiedRef = useRef(unverifiedEmail);
  unverifiedRef.current = unverifiedEmail;
  const discardRef = useRef(discardUnverified);
  discardRef.current = discardUnverified;
  useEffect(
    () => () => {
      if (unverifiedRef.current) void discardRef.current();
    },
    [],
  );

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      // Show the real cause (e.g. this device couldn't store the session) instead of a generic line.
      setError(e instanceof Error && e.message ? e.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }
  const submit = () => run(() => signIn(email.trim(), password));

  return (
    <Screen testID="sign-in-screen">
      <View style={{ gap: space.xs, marginTop: space.xl }}>
        <Row>
          <ShieldCheck size={28} color={colors.primary} />
          <Text variant="label" tone="primary">POCKET QA</Text>
        </Row>
        <Text variant="display">Real-device usability tests</Text>
        <Text tone="muted">
          {features.testCredits
            ? 'Builders fund studies with test credits. Testers record consented sessions. Every reward needs approval.'
            : 'Builders run usability studies. Testers record consented sessions on their own devices. Every result is reviewed.'}
        </Text>
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
        {notice ? <Notice tone="success" title="Check your inbox" testID="sign-in-notice">{notice}</Notice> : null}
        {authMode === 'firebase' && unverifiedEmail ? (
          <Button
            label="Resend verification email"
            icon={Mail}
            variant="secondary"
            onPress={() => run(async () => {
              await resendVerification();
              setNotice('We sent a new verification link. Open it, then sign in again.');
            })}
            disabled={busy}
            testID="resend-verification"
          />
        ) : null}
        <Button label="Sign in" icon={LogIn} onPress={submit} loading={busy} disabled={!email || !password} testID="sign-in-submit" />
        {authMode === 'firebase' ? (
          <Button
            label={resetOpen ? 'Send password reset link' : 'Forgot password?'}
            icon={KeyRound}
            variant="ghost"
            onPress={() =>
              resetOpen
                ? run(async () => {
                    await sendPasswordReset(email.trim());
                    // Same answer whether or not an account uses this email.
                    setNotice('If an account uses this email, a reset link is on its way.');
                    setResetOpen(false);
                  })
                : setResetOpen(true)
            }
            disabled={busy || (resetOpen && !email.trim())}
            testID="forgot-password"
          />
        ) : null}
        {resetOpen ? <Text variant="small" tone="muted" testID="reset-hint">Enter your email above, then send the link.</Text> : null}
        {authMode === 'firebase' && web ? <Button label="Continue with Google" variant="secondary" onPress={() => run(signInWithGoogle)} disabled={busy} testID="sign-in-google" /> : null}
        {canWallet
          ? // Sign In With Solana: the wallet shows where the request comes from; nothing is paid or sent.
            (android ? [undefined] : wallets).map((w, i) => (
              <Button
                key={w?.name ?? 'mwa'}
                label={w && wallets.length > 1 ? `Continue with ${w.name}` : 'Continue with wallet'}
                icon={Wallet}
                variant="secondary"
                onPress={() =>
                  run(async () => {
                    setChosenWallet(w);
                    try {
                      await signInWithWallet(undefined, w);
                    } catch (e) {
                      if (e instanceof ApiError && e.code === 'NOT_FOUND') return setWalletNew(true);
                      throw e;
                    }
                  })
                }
                disabled={busy}
                testID={i === 0 ? 'sign-in-wallet' : `sign-in-wallet-${i}`}
              />
            ))
          : null}
      </Card>
      {needsAccount || walletNew ? (
        <Card testID="finish-account">
          <Text variant="heading">{walletNew ? 'Create an account with this wallet' : 'Finish your account'}</Text>
          <Text variant="small" tone="muted">
            {walletNew
              ? 'No Pocket QA account uses this wallet yet. Choose how you’ll use Pocket QA; your wallet will ask you to sign in once more.'
              : 'You’re signed in, but no Pocket QA account uses this sign-in yet. Choose how you’ll use Pocket QA.'}
          </Text>
          <Segmented
            testID="finish-role"
            value={role}
            onChange={setRole}
            options={[
              { value: 'tester', label: 'I test apps' },
              { value: 'builder', label: 'I build apps' },
            ]}
          />
          <Field label="Display name" value={displayName} onChangeText={setDisplayName} testID="finish-name" autoCapitalize="words" />
          <Button
            label="Create account"
            icon={UserPlus}
            onPress={() => run(() => (walletNew ? signInWithWallet({ role, displayName: displayName.trim() }, chosenWallet) : completeAccount({ role, displayName: displayName.trim() })))}
            loading={busy}
            disabled={!displayName.trim()}
            testID="finish-submit"
          />
        </Card>
      ) : null}
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
        {signInFooter({ preview: PREVIEW_BUILD, authMode, storage, apiLocal: isLoopbackApi(API_BASE_URL) })}
      </Text>
    </Screen>
  );
}
