import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RequireRole } from '../../src/screens/RequireRole';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowRight } from 'lucide-react-native';
import { useState, type ReactNode } from 'react';
import { Platform, StyleSheet, Text as RNText, View } from 'react-native';
import { REWARD_DISCLAIMER } from '@pocket-qa/contracts';
import { api, ApiError } from '../../src/api/client';
import { useSession } from '../../src/auth/SessionProvider';
import { formatUnits, tokenAmount, unitName, type Settlement } from '../../src/lib/money';
import { GlassSurface, Well } from '../../src/glass';
import { GlassTile } from '../../src/icons';
import { recordingCapability } from '../../src/lib/capability';
import { webRecordingCapability } from '../../src/evidence/webScreenRecorder';
import { useTesterStudy } from '../../src/lib/queries';
import { stampArrival } from '../../src/motion/entrance';
import { useTheme } from '../../src/theme/ThemeProvider';
import { Button, Checkbox, Notice, QueryState, Screen, Text } from '../../src/ui';
import { Hairline, SectionHeader, TaskList } from '../../src/ui/patterns';

// Study detail (A-Study board, Direction A v2; CONSISTENCY.md round 4). The study's header, the
// reward card (the reward recessed in its lens well, the slots readout, the disclaimer), the task
// steps, the recording notice, then the consent card or "Open your session".
//
// U2 (§10.2, CONSISTENCY §U): nothing lights here. When consent and join succeed the screen is
// replaced by the session at once (a push arrival) with the §M3 hand-off `u2`; the Commit pass
// plays there, in Mode A on the session's "You consented on…" card. "Consent and join" is busy only
// while the request is pending (§10.1 rule 7: no light on a pending control), and a failed join
// stays unlit. The mutation, its cache invalidation and the destination are unchanged.

/**
 * The board's reward readout: the numeral with its unit stacked under it in a narrow lens well
 * (padding 6 18 9 14), read as one phrase. The shared RewardWell only lays out in a row.
 */
function StudyReward({ amount, units, settlement }: { amount: number; units?: number; settlement?: Settlement }) {
  const { colors, type } = useTheme();
  const value = units !== undefined ? formatUnits(units) : amount.toLocaleString('en-US');
  const unit = units !== undefined ? unitName(settlement) : amount === 1 ? 'test credit' : 'test credits';
  return (
    <Well style={styles.well} accessible accessibilityRole="text" accessibilityLabel={`${value} ${unit}`}>
      <RNText style={[type.numeral, { color: colors.numeral }]}>{value}</RNText>
      <RNText style={[type.small, { color: colors.textMuted }]} numberOfLines={1}>{unit}</RNText>
    </Well>
  );
}

/** A section as on the board: the heading with its fading rule, 10 above the content. */
function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.block}>
      <SectionHeader title={title} rule />
      {children}
    </View>
  );
}

function StudyDetailInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useTesterStudy(id);
  const qc = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  // Wallet-funded studies: the tester confirms which wallet this study's reward goes to; it is
  // frozen at consent and can't be redirected later (ADR 0007).
  const { user } = useSession();
  const wallet = user?.wallet?.address ?? null;
  const [walletOk, setWalletOk] = useState(false);
  const token = q.data?.reward.kind === 'token' ? q.data.reward : null;
  const cap = recordingCapability();
  const web = Platform.OS === 'web' ? webRecordingCapability() : ({ available: false, reason: '' } as const);
  const consent = useMutation({
    mutationFn: (v: number) => api('consent', { params: { id }, body: { consentVersion: v, accepted: true, ...(token && wallet ? { payoutAddress: wallet } : {}) } }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['eligible'] });
      qc.invalidateQueries({ queryKey: ['participations'] });
      // U2 is the session's: its consent card takes the Commit pass (Mode A) on arrival.
      stampArrival('push', { handoff: 'u2' });
      router.replace(`/participation/${p.id}`);
    },
  });
  return (
    <Screen testID="study-detail-screen">
      <QueryState query={q}>
        {(s) => (
          <>
            <View style={styles.header}>
              <Text variant="display">{s.title}</Text>
              <Text tone="muted">{s.objective}</Text>
            </View>
            <GlassSurface level="card" style={styles.reward}>
              <View style={styles.rewardRow}>
                <StudyReward amount={s.rewardCredits} units={s.reward.kind === 'token' ? s.reward.units : undefined} settlement={s.reward.kind === 'token' ? s.reward.settlement : undefined} />
                <Text variant="meta" tone="muted" style={styles.slots}>{s.slotsRemaining} slot{s.slotsRemaining === 1 ? '' : 's'} left</Text>
              </View>
              <View style={styles.disclaimer}>
                <Hairline inset={0} />
                <Text variant="disclaimer" tone="muted" testID="reward-disclaimer">
                  {s.reward.kind === 'token'
                    ? `${REWARD_DISCLAIMER}. Wallet-funded study: the reward is held in the study escrow and released after the builder approves. Simulation in this build: no funds move.`
                    : `${REWARD_DISCLAIMER}. Test credits have no cash value.`}
                </Text>
              </View>
            </GlassSurface>
            {s.buildUnderTest ? (
              <Text variant="small" tone="muted" style={styles.build}>
                Build under test: <Text variant="meta">{s.buildUnderTest}</Text>
              </Text>
            ) : null}
            <Block title="Tasks">
              <TaskList tasks={s.tasks} />
            </Block>
            <Block title="Recording on this device">
              {cap.available ? (
                <Notice tone="info" title="Screen recording available">Android asks for permission every session. You review every clip and choose what to upload.</Notice>
              ) : web.available ? (
                // Desktop browsers: the local-only recorder in the session (docs/plans/web-screen-audio-recording.md).
                <Notice tone="info" title="Browser recording available" testID="web-recording-available">
                  In your session you can record a tab, window or screen you choose, with your microphone narration. It stays on this device: you replay it, then download or discard it.
                </Notice>
              ) : (
                <Notice tone="warning" title="Recording unavailable" testID="recording-unavailable">{Platform.OS === 'web' ? web.reason : cap.reason}</Notice>
              )}
            </Block>
            {s.myParticipationId ? (
              <Button label="Open your session" icon={ArrowRight} onPress={() => router.replace(`/participation/${s.myParticipationId}`)} testID="open-session" style={styles.open} />
            ) : (
              <Block title="Consent">
                <GlassSurface level="card" testID="consent-card" style={styles.consent}>
                  <View style={styles.consentHead}>
                    <GlassTile name="consent" size="notice" />
                    <Text variant="heading" style={styles.flex}>Consent (version {s.consentVersion})</Text>
                  </View>
                  <Text testID="consent-text" style={styles.consentText}>{s.consentText}</Text>
                  <View style={styles.agree}>
                    <Checkbox checked={agreed} onChange={setAgreed} label="I have read and agree to this consent text." testID="consent-checkbox" />
                  </View>
                  {token ? (
                    wallet ? (
                      <View style={styles.agree}>
                        <Checkbox
                          checked={walletOk}
                          onChange={setWalletOk}
                          label={`Send this study’s reward (${tokenAmount(token.units, token.settlement)}) only to my wallet ${wallet.slice(0, 4)}…${wallet.slice(-4)}. It can’t be changed after I join.`}
                          testID="consent-reward-wallet"
                        />
                      </View>
                    ) : (
                      <View style={styles.error}>
                        <Notice tone="warning" title="Link a wallet first" testID="consent-needs-wallet">
                          This study sends its reward to a wallet you link in Settings. Link one, then come back to join.
                        </Notice>
                      </View>
                    )
                  ) : null}
                  {consent.error ? (
                    <View style={styles.error}>
                      <Notice tone="danger" title="Couldn’t join" testID="consent-error">{(consent.error as ApiError).message}</Notice>
                    </View>
                  ) : null}
                  <Button
                    label="Consent and join"
                    onPress={() => consent.mutate(s.consentVersion)}
                    disabled={!agreed || (!!token && (!wallet || !walletOk))}
                    loading={consent.isPending}
                    // S4 only when it enables: the U2 Commit pass follows the fire, on the session (§11.5).
                    sweepOnFire={false}
                    testID="consent-submit"
                    style={styles.submit}
                  />
                </GlassSurface>
              </Block>
            )}
          </>
        )}
      </QueryState>
    </Screen>
  );
}

export default function StudyDetail() {
  return (
    <RequireRole role="tester">
      <StudyDetailInner />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  // The board's study header: title (display-stack under the stack header) and objective, 6 apart.
  header: { gap: 6, paddingHorizontal: 4 },
  // Reward card: board padding 12 16 12 12; the well on the left, the slots readout on the right.
  reward: { paddingTop: 12, paddingRight: 16, paddingBottom: 12, paddingLeft: 12 },
  rewardRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  // The well stacks the unit under the numeral (board padding 6 18 9 14).
  well: { alignSelf: 'flex-start', justifyContent: 'center', paddingTop: 6, paddingRight: 18, paddingBottom: 9, paddingLeft: 14 },
  slots: { flexShrink: 0, paddingRight: 2 },
  // The disclaimer sits 10 under the row, with the fading hairline on its top edge and 10 above the text.
  disclaimer: { marginTop: 10, paddingTop: 10 },
  // "Build under test" hangs 10 under the reward card (the board's −6 on its 16 gap).
  build: { marginTop: -4, paddingHorizontal: 4 },
  // Sections: heading 10 above the content; +2 on the screen's 14 gap makes the board's 16.
  block: { gap: 10, marginTop: 2 },
  open: { marginTop: 4 },
  consent: { padding: 16 },
  consentHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  consentText: { marginTop: 12 },
  agree: { marginTop: 4 },
  error: { marginTop: 8 },
  submit: { marginTop: 12 },
});
