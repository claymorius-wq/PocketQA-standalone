import { Link } from 'expo-router';
import { KeyRound, LogIn, LogOut, Mail, RefreshCw, UserPlus, Wallet } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { API_BASE_URL, ApiError } from '../../src/api/client';
import { isLoopbackApi, signInFooter } from '../../src/auth/footer';
import { useSession } from '../../src/auth/SessionProvider';
import { GlassSurface, useUplight } from '../../src/glass';
import { loadDemoAccounts, PREVIEW_BUILD, type DemoAccount, type DemoRole } from '../../src/preview/demoAccounts';
import { armU1, BrandHero, CardRule, disarmU1, SignInDock, signInMoment, u1PassAt, UnderlinedLink, UplitPrimary } from '../../src/screens/authParts';
import { UPLIGHT } from '../../src/theme/motion';
import type { GlyphName } from '../../src/icons';
import { layout, radius } from '../../src/theme/tokens';
import type { StandardWallet } from '../../src/wallet/standard';
import { useWallets } from '../../src/wallet/useWallets';
import { Button, Card, Field, Notice, Row, Screen, Segmented, Text, useKeyboardShown } from '../../src/ui';
import { GoogleButton } from '../../src/ui/patterns';
import { Enter } from '../../src/ui/screen';

const ROLE_LABEL: Record<DemoRole, string> = { tester: 'Tester', builder: 'Builder', admin: 'Admin' };
/** Each role's segment carries its first tab's glyph (A-SignIn). */
const ROLE_GLYPH: Record<DemoRole, GlyphName> = { tester: 'discover', builder: 'studies', admin: 'disputes' };

// A-SignIn (Direction A v2 §13): the only screen that plays the launch entrance (the light dip and
// the staggered steps; the auth layout gives it `launch`) and the front door's Uplight, U1: the
// pilot floor rises under Sign in once both fields are filled, and the Commit pass plays only when
// the session is accepted. The auth layout holds this screen until the pass peaks, then replaces it
// with the role's first tab, which finishes the pass's tail (§M3 hand-off `u1`).
//
// Managed identity and wallet login (ADR 0005, cloud identity) add Google and wallet sign-in under
// the fields, and "Finish your account" when a sign-in has no Pocket QA account yet. Those paths
// land with the plain `replace`, as Sign up does: U1 belongs to the Sign in primary alone.
export default function SignIn() {
  const {
    signIn,
    authMode,
    storage,
    walletLogin,
    features,
    needsAccount,
    signedInEmail,
    googleSignIn,
    signOut,
    pendingProfile,
    signInWithGoogle,
    signInWithWallet,
    completeAccount,
    unverifiedEmail,
    resendVerification,
    discardUnverified,
    sendPasswordReset,
    unreachable,
    retryConnection,
  } = useSession();
  const web = Platform.OS === 'web';
  // Wallet sign-in when the server enables it: web with Wallet Standard extensions (one button
  // per wallet, ledger W1), or Android through Mobile Wallet Adapter (ledger W3). Never on the
  // shared preview. iOS has no wallet path.
  const wallets = useWallets();
  const android = Platform.OS === 'android';
  const canWallet = walletLogin && !PREVIEW_BUILD && ((web && wallets.length > 0) || android);
  const [chosenWallet, setChosenWallet] = useState<StandardWallet | undefined>(undefined);
  // Firebase mode: "Forgot password?" (ledger I4) and "Resend verification email".
  const canReset = authMode === 'firebase';
  const [resetOpen, setResetOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // Google only where the deployment has the provider enabled (/config firebase.googleSignIn).
  const canGoogle = authMode === 'firebase' && web && googleSignIn;
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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Shared demo preview only: fill (never submit) a synthetic demo sign-in.
  const [demo, setDemo] = useState<DemoAccount[]>([]);
  const [demoRole, setDemoRole] = useState<DemoRole>('tester');
  // Drawing only: the session accepted the sign-in, so U1 plays its Commit pass. The auth layout
  // keeps this screen up until the pass peaks (+680), then replaces it with the role's first tab.
  const [signedIn, setSignedIn] = useState(false);
  // The pass starts at max(280ms after the press, the response) (C4), so the motes ride the rise.
  const passTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // The session is accepted: a second press while the pass plays never signs in again.
  const accepted = useRef(false);
  // Counts Sign in responses; the effect below reads each one's outcome once it has rendered.
  const [answered, setAnswered] = useState(0);
  useEffect(() => () => clearTimeout(passTimer.current), []);
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

  function submit() {
    if (accepted.current) return;
    armU1();
    void run(async () => {
      try {
        await signIn(email.trim(), password);
      } catch (e) {
        disarmU1();
        throw e;
      }
      accepted.current = true;
      setAnswered((n) => n + 1);
    });
  }

  // A managed (Firebase) sign-in can be accepted with no Pocket QA account yet (`needsAccount`):
  // then "Finish your account" follows, U1 stands down (no Commit pass, nothing armed) and Sign in
  // works again. Read after the response has rendered, so the session's state is current here.
  useEffect(() => {
    if (!answered) return;
    if (needsAccount) {
      accepted.current = false;
      disarmU1();
      return;
    }
    const wait = Math.max(0, (u1PassAt() ?? 0) - Date.now());
    if (wait > 0) passTimer.current = setTimeout(() => setSignedIn(true), wait);
    else setSignedIn(true);
    // Each response once; needsAccount is read as that response left it.
  }, [answered]);

  /**
   * "Use another account" on Finish your account (QA P2): a managed sign-in that no Pocket QA
   * account uses may simply be the wrong identity, so leaving must be as easy as creating a new
   * account. Signs out of the app only (API logout, Firebase sign-out here, local session cleared;
   * never the Google account itself) and returns to an empty sign-in form. A wallet with no account
   * has no session yet: leaving just closes the card.
   */
  function useAnotherAccount() {
    void run(async () => {
      if (walletNew) setWalletNew(false);
      else await signOut();
      setDisplayName('');
      setRole('tester');
      setEmail('');
      setPassword('');
    });
  }

  /** Google, the wallet and "Create account": the plain `replace` once signed in, never U1. */
  function runPlain(action: () => Promise<void>) {
    if (accepted.current) return;
    disarmU1();
    void run(action);
  }

  const ready = !!email && !!password;
  const moment = signInMoment(ready, signedIn);
  const light = useUplight(moment.grade, moment.active, { level: UPLIGHT.pilot.signIn });
  // Local build (A-SignIn sp.top 1): the content fills the screen and the form card sits low, just
  // above "New here?". While the keyboard is up (native) the card goes back under the hero, so the
  // fields stay above the keyboard (the content then fits and cannot scroll them into view).
  const keyboard = useKeyboardShown(!PREVIEW_BUILD);
  const anchored = !PREVIEW_BUILD && !keyboard;
  // With the keyboard up, Sign in rides on it (dockKeyboard "ride"); bring the form's end into view
  // so neither field sits under it. On iOS the password field was covered and could not be tapped.
  const scroller = useRef<ScrollView>(null);
  useEffect(() => {
    if (!keyboard) return;
    const t = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [keyboard]);

  // Production build, /config unreadable: say so instead of assuming local accounts (inc4).
  if (unreachable) {
    return (
      <Screen testID="sign-in-screen">
        <Notice tone="danger" title="Can’t reach Pocket QA" testID="unreachable">
          The Pocket QA server isn’t answering right now, so sign-in isn’t available. Check your connection and try again.
        </Notice>
        <Button label="Try again" icon={RefreshCw} onPress={retryConnection} testID="unreachable-retry" />
      </Screen>
    );
  }

  return (
    <Screen
      testID="sign-in-screen"
      scrollRef={scroller}
      fill={anchored}
      // The small print sits above Sign in, so the primary is the last thing on the screen (Mode B).
      dockPlacement="edge"
      dockKeyboard="ride"
      dockClearance={layout.listGap}
      dock={
        <SignInDock
          light={light}
          footer={
            <Enter step={3} style={styles.footer}>
              {PREVIEW_BUILD ? null : (
                // The shared preview has no self-registration (the gate refuses it).
                <Row gap={6} style={styles.center}>
                  <Text variant="bodySm" tone="muted">New here?</Text>
                  <UnderlinedLink height={48}>
                    <Link href="/sign-up" testID="go-sign-up" style={styles.linkHit}>
                      <Text tone="primary" variant="heading">Create an account</Text>
                    </Link>
                  </UnderlinedLink>
                </Row>
              )}
              {/* Where data actually lives, from the server's public config (never a local-only claim on a cloud deployment). */}
              <Text variant="disclaimer" tone="muted" style={[styles.smallPrint, PREVIEW_BUILD ? null : styles.smallPrintLocal]}>
                {signInFooter({ preview: PREVIEW_BUILD, authMode, storage, apiLocal: isLoopbackApi(API_BASE_URL) })}
              </Text>
            </Enter>
          }
        >
          <Enter step={4}>
            <UplitPrimary light={light}>
              {/* U1's Commit pass follows a successful fire, so Sign in never sweeps on fire (S4, §11.5). */}
              <Button label="Sign in" icon={LogIn} onPress={submit} loading={busy} disabled={!email || !password} sweepOnFire={false} testID="sign-in-submit" />
            </UplitPrimary>
          </Enter>
        </SignInDock>
      }
    >
      <BrandHero key="hero" label="POCKET QA" title="Real-device usability tests" subtitle={
          features.testCredits
            ? 'Builders fund studies with test credits. Testers record consented sessions. Every reward needs approval.'
            : 'Builders run usability studies. Testers record consented sessions on their own devices. Every result is reviewed.'
        }
      />
      {/* The last step takes the free room (Screen fill) and holds the card at its bottom; the
          error Notice and "Finish your account" rise into that room above it, so the card never
          moves (A-SignIn-Error). */}
      <View key="form" style={[styles.form, anchored ? styles.formAnchored : null]}>
        {error ? (
          // Its own step, as before: it rises in when it mounts.
          <Enter step={1}>
            <Notice tone="danger" title="Couldn’t sign in" testID="sign-in-error">
              {error}
            </Notice>
          </Enter>
        ) : null}
        {notice ? (
          <Enter step={1}>
            <Notice tone="success" title="Check your inbox" testID="sign-in-notice">
              {notice}
            </Notice>
          </Enter>
        ) : null}
        {canReset && unverifiedEmail ? (
          <Enter step={1}>
            <Button
              label="Resend verification email"
              icon={Mail}
              variant="secondary"
              onPress={() =>
                runPlain(async () => {
                  await resendVerification();
                  setNotice('We sent a new verification link. Open it, then sign in again.');
                })
              }
              disabled={busy}
              testID="resend-verification"
            />
          </Enter>
        ) : null}
        {needsAccount || walletNew ? (
          // A sign-in with no Pocket QA account yet: choose a role (A-SignUp's role switch) and a name.
          <Enter step={1}>
            <Card testID="finish-account" style={styles.finish}>
              <View style={styles.finishHead}>
                <Text variant="heading">{walletNew ? 'Create an account with this wallet' : 'Finish your account'}</Text>
                {walletNew ? (
                  <Text variant="small" tone="muted">
                    No Pocket QA account uses this wallet yet. Choose how you’ll use Pocket QA; your wallet will ask you to sign in once more.
                  </Text>
                ) : (
                  <>
                    <Text variant="small" tone="muted" testID="finish-identity">
                      {`No Pocket QA account uses ${signedInEmail ?? 'this sign-in'} yet. If you already have an account, sign in with the email it uses.`}
                    </Text>
                    <Text variant="small" tone="muted">
                      To create a new account, choose how you’ll use Pocket QA.
                    </Text>
                  </>
                )}
              </View>
              <Segmented
                testID="finish-role"
                value={role}
                onChange={setRole}
                options={[
                  { value: 'tester', label: 'I test apps', glyph: 'discover' },
                  { value: 'builder', label: 'I build apps', glyph: 'studies' },
                ]}
              />
              <Field label="Display name" value={displayName} onChangeText={setDisplayName} testID="finish-name" autoCapitalize="words" />
              <Button
                label="Create account"
                icon={UserPlus}
                onPress={() => runPlain(() => (walletNew ? signInWithWallet({ role, displayName: displayName.trim() }, chosenWallet) : completeAccount({ role, displayName: displayName.trim() })))}
                loading={busy}
                disabled={!displayName.trim()}
                testID="finish-submit"
              />
              <Button label="Use another account" icon={LogOut} variant="secondary" onPress={useAnotherAccount} disabled={busy} testID="finish-sign-out" />
            </Card>
          </Enter>
        ) : null}
        {/* The one form card (A-SignIn): the demo role switch, when the preview has one, then the
            fields, then any other way in the deployment offers. Lit from below by U1. */}
        <GlassSurface level="card" k={1} uplight={light.u} style={styles.card}>
          {demo.length ? (
            <View testID="demo-accounts">
              <View style={styles.demoHead}>
                <Text variant="heading">Shared demo preview</Text>
                <Text variant="small" tone="muted">Pick a role, then sign in. These accounts are shared with every visitor.</Text>
              </View>
              <Segmented
                options={demo.map((a) => ({ value: a.role, label: ROLE_LABEL[a.role], glyph: ROLE_GLYPH[a.role] }))}
                value={demoRole}
                onChange={(r) => fillDemo(r)}
                testID="demo-role"
              />
              <CardRule />
            </View>
          ) : null}
          <View style={styles.fields}>
            <Field label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" testID="sign-in-email" />
            {/* Return submits too: Sign in lives in the bottom dock, which a phone browser's keyboard can cover. */}
            <Field label="Password" value={password} onChangeText={setPassword} secure returnKeyType="go" onSubmitEditing={() => (ready && !busy ? submit() : undefined)} testID="sign-in-password" />
          </View>
          {canGoogle || canWallet || canReset ? (
            // Secondary glass under the fields, behind the card's divider: never lit (U1 is Sign in's).
            <View>
              <CardRule />
              <View style={styles.others}>
                {canReset ? (
                  // Sends a reset link to the email above; the answer is the same whether or not an account uses it.
                  <Button
                    label={resetOpen ? 'Send password reset link' : 'Forgot password?'}
                    icon={KeyRound}
                    variant="ghost"
                    onPress={() =>
                      resetOpen
                        ? runPlain(async () => {
                            await sendPasswordReset(email.trim());
                            setNotice('If an account uses this email, a reset link is on its way.');
                            setResetOpen(false);
                          })
                        : setResetOpen(true)
                    }
                    disabled={busy || (resetOpen && !email.trim())}
                    testID="forgot-password"
                  />
                ) : null}
                {resetOpen ? (
                  <Text variant="small" tone="muted" testID="reset-hint">
                    Enter your email above, then send the link.
                  </Text>
                ) : null}
                {canGoogle ? <GoogleButton intent="continue" onPress={() => runPlain(signInWithGoogle)} disabled={busy} testID="sign-in-google" /> : null}
                {canWallet
                  ? // Sign In With Solana: the wallet shows where the request comes from; nothing is paid or sent.
                    (android ? [undefined] : wallets).map((w, i) => (
                      <Button
                        key={w?.name ?? 'mwa'}
                        label={w && wallets.length > 1 ? `Continue with ${w.name}` : 'Continue with wallet'}
                        icon={Wallet}
                        variant="secondary"
                        onPress={() =>
                          runPlain(async () => {
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
              </View>
            </View>
          ) : null}
        </GlassSurface>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    paddingTop: layout.cardPadding.top,
    paddingRight: layout.cardPadding.right,
    paddingBottom: layout.cardPadding.bottom,
    paddingLeft: layout.cardPadding.left,
  },
  // The Notice and the cards, the screen's gap apart.
  form: { flexGrow: 1, gap: layout.listGap },
  formAnchored: { justifyContent: 'flex-end' },
  demoHead: { gap: 4, marginBottom: 12 },
  fields: { gap: 14 },
  // The other ways in: full-width secondaries, 12 apart (the sheets' action gap).
  others: { gap: 12 },
  // "Finish your account": the heading block, then the role switch, the name and Create account, 12 apart (A-SignUp's form rhythm).
  finish: { gap: 12 },
  finishHead: { gap: 4 },
  footer: { marginBottom: 14 },
  center: { justifyContent: 'center' },
  // The link's 48dp touch row (A-SignIn: min-height 48, 0 4 padding).
  linkHit: { paddingVertical: 13, paddingHorizontal: 4 },
  smallPrint: { alignSelf: 'center', maxWidth: 300, textAlign: 'center', paddingHorizontal: 4 },
  smallPrintLocal: { marginTop: 2 },
});
