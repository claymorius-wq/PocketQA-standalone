import { Link } from 'expo-router';
import { LogIn, UserPlus, Wallet } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { API_BASE_URL, ApiError } from '../../src/api/client';
import { isLoopbackApi, signInFooter } from '../../src/auth/footer';
import { useSession } from '../../src/auth/SessionProvider';
import { GlassSurface, useUplight } from '../../src/glass';
import { loadDemoAccounts, PREVIEW_BUILD, type DemoAccount, type DemoRole } from '../../src/preview/demoAccounts';
import { armU1, BrandHero, CardRule, disarmU1, SignInDock, signInMoment, u1PassAt, UnderlinedLink, UplitPrimary } from '../../src/screens/authParts';
import { UPLIGHT } from '../../src/theme/motion';
import type { GlyphName } from '../../src/icons';
import { layout, radius } from '../../src/theme/tokens';
import { availableWallets } from '../../src/wallet/registry';
import { Button, Card, Field, Notice, Row, Screen, Segmented, Text, useKeyboardShown } from '../../src/ui';
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
  const { signIn, authMode, storage, walletLogin, needsAccount, pendingProfile, signInWithGoogle, signInWithWallet, completeAccount } = useSession();
  const web = Platform.OS === 'web';
  // Wallet sign-in: web with a Solana Wallet Standard extension, when the server enables it.
  const canWallet = walletLogin && web && availableWallets().length > 0;
  const canGoogle = authMode === 'firebase' && web;
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

  return (
    <Screen
      testID="sign-in-screen"
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
      <BrandHero key="hero" label="POCKET QA" title="Real-device usability tests" subtitle="Builders fund studies with test credits. Testers record consented sessions. Every reward needs approval." />
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
        {needsAccount || walletNew ? (
          // A sign-in with no Pocket QA account yet: choose a role (A-SignUp's role switch) and a name.
          <Enter step={1}>
            <Card testID="finish-account" style={styles.finish}>
              <View style={styles.finishHead}>
                <Text variant="heading">{walletNew ? 'Create an account with this wallet' : 'Finish your account'}</Text>
                <Text variant="small" tone="muted">
                  {walletNew
                    ? 'No Pocket QA account uses this wallet yet. Choose how you’ll use Pocket QA; your wallet will ask you to sign in once more.'
                    : 'You’re signed in, but no Pocket QA account uses this sign-in yet. Choose how you’ll use Pocket QA.'}
                </Text>
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
                onPress={() => runPlain(() => (walletNew ? signInWithWallet({ role, displayName: displayName.trim() }) : completeAccount({ role, displayName: displayName.trim() })))}
                loading={busy}
                disabled={!displayName.trim()}
                testID="finish-submit"
              />
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
                <Text variant="small" tone="muted">Pick a role and press Sign in. Demo accounts are shared with every visitor; data is synthetic, devnet and test credits only.</Text>
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
            <Field label="Password" value={password} onChangeText={setPassword} secure testID="sign-in-password" />
          </View>
          {canGoogle || canWallet ? (
            // Secondary glass under the fields, behind the card's divider: never lit (U1 is Sign in's).
            <View>
              <CardRule />
              <View style={styles.others}>
                {canGoogle ? <Button label="Continue with Google" variant="secondary" onPress={() => runPlain(signInWithGoogle)} disabled={busy} testID="sign-in-google" /> : null}
                {canWallet ? (
                  // Sign In With Solana: the wallet shows this site's address; nothing is paid or sent.
                  <Button
                    label="Continue with wallet"
                    icon={Wallet}
                    variant="secondary"
                    onPress={() =>
                      runPlain(async () => {
                        try {
                          await signInWithWallet();
                        } catch (e) {
                          if (e instanceof ApiError && e.code === 'NOT_FOUND') return setWalletNew(true);
                          throw e;
                        }
                      })
                    }
                    disabled={busy}
                    testID="sign-in-wallet"
                  />
                ) : null}
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
