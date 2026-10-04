import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RequireRole } from '../../../src/screens/RequireRole';
import { router, useLocalSearchParams } from 'expo-router';
import { Ban, Pause, Play, Rocket, Users } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { api, ApiError } from '../../../src/api/client';
import { GlassBlur } from '../../../src/glass';
import { PASS_THROUGH, useSvgId } from '../../../src/glass/paint';
import { GlassTile } from '../../../src/icons';
import { statusLabel } from '../../../src/lib/format';
import { useStudy, useStudyDisputes, useStudyParticipations } from '../../../src/lib/queries';
import { BudgetCard } from '../../../src/screens/BuilderStudyBudget';
import { DUR } from '../../../src/theme/motion';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { layout, radius, type Tone } from '../../../src/theme/tokens';
import { Button, Card, ConfirmSheet, EmptyState, Notice, QueryState, Screen, StatusPill, Text } from '../../../src/ui';
import { DateText, Hairline, SectionHeader, TaskList } from '../../../src/ui/patterns';

// The builder's study (A-BStudy). Top to bottom: the status pills, the title and the objective;
// the Budget card (the screen's signature: its figures settle on arrival); Tasks as the numbered
// list; Participants as pressable L1 rows; Disputes. The study actions float in the L3 dock (the
// screen's one blur): Close on the left, the screen's next step on the right (Publish, Pause or
// Resume), the same order as every sheet.
//
// U7: Publish is the commit sheet. Its pilot floor rises under the confirm while the sheet is
// open and holds while the request is pending; on success the Commit pass plays, the sheet leaves
// 680ms after it starts, and the Budget card takes the tail (Mode A) while its two changed figures
// cross-fade. Pause, Resume and Close stay unlit. Reduced motion or the flat light theme: the
// sheet closes as soon as the request succeeds, and nothing is lit.
//
// Each sheet opens clean (no failure from an earlier attempt shows, or is announced, in it) and
// keeps naming its action while it plays its exit, as the admin sheets do.

type Action = 'publish' | 'pause' | 'resume' | 'close';
const ROUTE = { publish: 'publishStudy', pause: 'pauseStudy', resume: 'resumeStudy', close: 'closeStudy' } as const;

/** Participation status → the rim tint of its row's chevron tile (the pill's tone, A-BStudy TINT). */
const ROW_TINT: Record<string, Tone> = {
  consented: 'info',
  in_progress: 'info',
  submitted: 'warning',
  disputed: 'warning',
  approved: 'success',
  rejected: 'danger',
  resolved: 'neutral',
  withdrawn: 'neutral',
};
/** Light distance down the participant and dispute lists (§2 cardK): the rows sit below the Budget card. */
const ROW_K = [0.8, 0.64] as const;
const rowK = (i: number) => ROW_K[Math.min(i, ROW_K.length - 1)]!;
/** Clear ground between the last content and the dock (the board: main's 128 bottom padding over an 88 dock). */
const DOCK_CLEARANCE = 40;
/** The ground scrim's fade above the dock's top edge; below the fade it is solid to the screen's bottom. */
const SCRIM_FADE = 32;
const DECORATIVE = { accessible: false, importantForAccessibility: 'no-hide-descendants', 'aria-hidden': true } as const;

function BuilderStudyInner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { glass, motion } = useTheme();
  const q = useStudy(id);
  const parts = useStudyParticipations(id);
  const disputes = useStudyDisputes(id);
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState<Action | null>(null);
  // The sheet keeps the last action's copy, confirm and tone while it animates out (confirm is
  // already null then), so Close never blanks or turns into a primary confirm as it leaves.
  const [shown, setShown] = useState(confirm);
  if (confirm && confirm !== shown) setShown(confirm);
  const sheetAction = confirm ?? shown;
  // U7: the Commit pass is playing in the Publish sheet (the request has succeeded).
  const [passing, setPassing] = useState(false);
  // Bumped when the Publish sheet leaves: the Budget card takes the tail, the figures cross-fade, the dock fades in.
  const [landed, setLanded] = useState(0);
  const lit = glass.enabled && motion.play.uplightCommit;
  const act = useMutation({
    mutationFn: (a: Action) => api(ROUTE[a], { params: { id } }),
    onSuccess: (s, a) => {
      // A lit Publish keeps its sheet for the Commit pass; the sheet's onLeave closes it.
      if (a === 'publish' && lit) setPassing(true);
      else setConfirm(null);
      qc.setQueryData(['study', id], s);
      qc.invalidateQueries({ queryKey: ['studies'] });
      qc.invalidateQueries({ queryKey: ['credits'] });
      qc.invalidateQueries({ queryKey: ['studyParticipations', id] });
    },
  });
  const onLeave = () => {
    setPassing(false);
    setConfirm(null);
    setLanded((n) => n + 1);
  };
  // A sheet starts clean: an earlier failure (shown over the dock until now) never reappears in it.
  const open = (a: Action) => {
    act.reset();
    setConfirm(a);
  };
  const copy: Record<Action, { title: string; body: string; label: string }> = {
    publish: { title: 'Publish this study?', body: 'Reward × slots is reserved from your test credits, and matching testers can join.', label: 'Publish' },
    pause: { title: 'Pause this study?', body: 'No new testers can join. Testers already in progress can finish.', label: 'Pause' },
    resume: { title: 'Resume this study?', body: 'Matching testers can join again.', label: 'Resume' },
    close: { title: 'Close this study?', body: 'Testers who haven’t submitted are withdrawn, and unused credits return to your balance.', label: 'Close study' },
  };
  const errorMessage = act.error ? (act.error as ApiError).message : null;
  // The commit sheet's light follows the request (C4, U7); the other sheets pass no status and stay unlit.
  const commitStatus = passing ? 'success' : act.isPending ? 'pending' : act.isError ? 'error' : 'idle';
  const study = q.data;
  // No dock while QueryState shows the error panel (cached data and a failed refetch): the sheet
  // lives inside QueryState, so an action tapped then would open nothing until Retry succeeds.
  const docked = !!study && study.status !== 'closed' && !q.error;

  return (
    <Screen
      testID="builder-study-screen"
      // The study actions float in the Screen's dock (L3, blurring the content); none once closed.
      // Edge placement so the dock can paint the ground scrim (as New study does) from just above
      // its top edge to the screen's bottom: nothing scrolled shows in the strip around it.
      dockPlacement="edge"
      dockClearance={DOCK_CLEARANCE}
      dock={
        study && docked ? (
          <StudyDock fadeRun={landed}>
            {errorMessage !== null ? (
              <Notice tone="danger" title="Action failed" testID="study-action-error">
                {errorMessage}
              </Notice>
            ) : null}
            <View style={styles.actions}>
              <Button label="Close" icon={Ban} variant="danger" onPress={() => open('close')} testID="study-close" style={styles.negative} />
              {study.status === 'draft' ? <Button label="Publish" icon={Rocket} onPress={() => open('publish')} testID="study-publish" style={styles.positive} /> : null}
              {study.status === 'published' ? <Button label="Pause" icon={Pause} variant="secondary" onPress={() => open('pause')} testID="study-pause" style={styles.positive} /> : null}
              {study.status === 'paused' ? <Button label="Resume" icon={Play} onPress={() => open('resume')} testID="study-resume" style={styles.positive} /> : null}
            </View>
          </StudyDock>
        ) : null
      }
    >
          <QueryState query={q}>
            {(s) => (
              <>
                <View style={styles.page}>
                  <View style={styles.intro}>
                    <View style={styles.pills}>
                      <StatusPill status={s.status} testID="study-status" />
                      {s.moderation === 'suspended' ? <StatusPill status="suspended" label="Suspended by moderation" /> : null}
                    </View>
                    <Text variant="display">{s.title}</Text>
                    <Text tone="muted" style={styles.objective}>{s.objective}</Text>
                  </View>
                  <BudgetCard study={s} landing={landed} settled={landed} />
                  <View>
                    <SectionHeader title="Tasks" />
                    <View style={styles.tasks}>
                      <TaskList variant="numbered" tasks={s.tasks} stepTestID={() => undefined} />
                    </View>
                  </View>
                  <View>
                    <SectionHeader title="Participants" />
                    <View style={styles.list}>
                      <QueryState
                        query={parts}
                        empty={(d) => (d.items.length === 0 ? <EmptyState icon={Users} title="No testers yet" body={s.status === 'draft' ? 'Publish the study so matching testers can join.' : 'Matching testers will appear here when they consent.'} /> : null)}
                      >
                        {(d) => (
                          <View style={styles.rows}>
                            {d.items.map((p, i) => (
                              <Card key={p.id} k={rowK(i)} onPress={() => router.push(`/builder/review/${p.id}`)} testID={`builder-participation-${p.id}`} accessibilityLabel={`Review ${p.testerDisplayName ?? 'tester'}`} style={styles.rowCard}>
                                <View style={styles.row}>
                                  <View style={styles.rowText}>
                                    <View style={styles.rowHead}>
                                      <PersonName>{p.testerDisplayName ?? 'Tester'}</PersonName>
                                      <StatusPill status={p.status} label={statusLabel[p.status]} />
                                    </View>
                                    {p.submittedAt ? <DateText verb="Submitted" iso={p.submittedAt} /> : <DateText verb="Joined" iso={p.consentedAt} />}
                                  </View>
                                  <GlassTile name="chevron" size="notice" tint={ROW_TINT[p.status]} />
                                </View>
                              </Card>
                            ))}
                          </View>
                        )}
                      </QueryState>
                    </View>
                  </View>
                  <View testID="study-disputes">
                    <SectionHeader title="Disputes" />
                    {disputes.data?.items.length ? (
                      <View style={[styles.list, styles.rows]}>
                        {disputes.data.items.map((d, i) => (
                          <Card key={d.id} k={rowK(i + 1)} onPress={() => router.push(`/builder/review/${d.participationId}`)} testID={`study-dispute-${d.status}`} accessibilityLabel="Open disputed participation" style={styles.disputeCard}>
                            <View style={styles.disputeHead}>
                              <GlassTile name="disputes" size="notice" tint={d.status === 'open' ? 'warning' : undefined} />
                              <StatusPill status={d.status} />
                              <DateText iso={d.createdAt} style={styles.disputeDate} />
                            </View>
                            <Text variant="bodySm">{d.reason}</Text>
                            <View style={styles.outcome}>
                              <Hairline inset={0} />
                              {d.outcome ? (
                                <Text variant="bodySm" tone="muted">
                                  <Strong>{d.outcome === 'overturned' ? 'Overturned: the tester was credited.' : 'Upheld: your rejection stands.'}</Strong> {d.resolutionNote}
                                </Text>
                              ) : (
                                <Text variant="bodySm" tone="muted">Waiting for an admin.</Text>
                              )}
                            </View>
                          </Card>
                        ))}
                      </View>
                    ) : (
                      <Text variant="bodySm" tone="muted" testID="study-disputes-empty" style={styles.disputesEmpty}>No disputes on this study.</Text>
                    )}
                  </View>
                </View>
                <ConfirmSheet
                  visible={confirm !== null}
                  title={sheetAction ? copy[sheetAction].title : ''}
                  body={sheetAction ? copy[sheetAction].body : ''}
                  confirmLabel={sheetAction ? copy[sheetAction].label : ''}
                  destructive={sheetAction === 'close'}
                  // The sheet locks both actions through the Commit pass itself (C4), without a spinner.
                  loading={act.isPending}
                  status={sheetAction === 'publish' ? commitStatus : act.isError ? 'error' : undefined}
                  error={errorMessage}
                  errorTestID="study-action-sheet-error"
                  onLeave={onLeave}
                  onCancel={() => setConfirm(null)}
                  onConfirm={() => confirm && act.mutate(confirm)}
                />
              </>
            )}
          </QueryState>
    </Screen>
  );
}

/** A participant's name: Instrument Sans 600 15/22 (C6 list / card row title). */
function PersonName({ children }: { children: ReactNode }) {
  const { colors, type } = useTheme();
  return <RNText style={[type.heading, styles.name, { color: colors.text }]}>{children}</RNText>;
}

/** The lead clause of a dispute outcome: 600 in the text colour inside the muted line. */
function Strong({ children }: { children: ReactNode }) {
  const { colors, type } = useTheme();
  return <RNText style={{ color: colors.text, fontFamily: type.heading.fontFamily, fontWeight: type.heading.fontWeight }}>{children}</RNText>;
}

/**
 * The study actions dock: the L3 overlay (the Screen's `dock`, 12 in from the edges and above the
 * bottom inset, moving with the screen's arrival; a dock that mounts once the study has loaded
 * rises in by itself), with the ground scrim behind it so no scrolled content shows around it.
 * After a Publish its new row waits while the sheet drops away (120ms), then fades in over 240ms.
 */
function StudyDock({ fadeRun, children }: { fadeRun: number; children: ReactNode }) {
  const { motion } = useTheme();
  const fade = useSharedValue(1);
  useEffect(() => {
    if (fadeRun === 0 || motion.reduced) return;
    fade.value = withSequence(withTiming(0, { duration: 0 }), withDelay(DUR.tick, withTiming(1, motion.timing.swap)));
  }, [fadeRun]);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: fade.value }));
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.boxNone}>
      <DockScrim />
      {/* Same structure as Screen's float frame: the gutters sit on an outer view and the
          centred 744-wide column inside it, so width 100% never adds to the margins. */}
      <View style={[styles.boxNone, { marginLeft: layout.tabBarInset + insets.left, marginRight: layout.tabBarInset + insets.right, marginBottom: layout.tabBarInset + insets.bottom }]}>
        <View style={[styles.dockColumn, styles.boxNone]}>
          <GlassBlur radius={radius.overlay} role="group" aria-label="Study actions" style={styles.dock}>
            <Animated.View style={[styles.dockBody, fadeStyle]}>{children}</Animated.View>
          </GlassBlur>
        </View>
      </View>
    </View>
  );
}

/**
 * The ground behind the dock (New study's scrim, static): clear SCRIM_FADE above the dock's top
 * edge, solid from there to the screen's bottom, ending on the ground's base colour (flat theme:
 * the background throughout).
 */
function DockScrim() {
  const { colors, glass } = useTheme();
  const id = useSvgId('bs-scrim');
  const [height, setHeight] = useState(0);
  const base = glass.ground.base.stops;
  const top = colors.background;
  const end = glass.enabled ? (base[base.length - 1]?.color ?? colors.background) : colors.background;
  return (
    <View {...DECORATIVE} onLayout={(e) => setHeight(e.nativeEvent.layout.height)} style={[styles.scrim, PASS_THROUGH]}>
      {height > 0 ? (
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <Stop offset={0} stopColor={top} stopOpacity={0} />
              <Stop offset={Math.min(1, SCRIM_FADE / height)} stopColor={top} stopOpacity={1} />
              <Stop offset={1} stopColor={end} stopOpacity={1} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
        </Svg>
      ) : null}
    </View>
  );
}

export default function BuilderStudy() {
  return (
    <RequireRole role="builder">
      <BuilderStudyInner />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  // The board's main column: 24 between blocks.
  page: { gap: 24 },
  intro: { gap: 10, paddingHorizontal: 4 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  objective: { maxWidth: 330 },
  tasks: { marginTop: 6 },
  list: { marginTop: 12 },
  rows: { gap: 14 },
  // Board row: min 64, padding 16 16 16 18, 14 between the text and the chevron tile.
  rowCard: { minHeight: 64, paddingTop: 16, paddingRight: 16, paddingBottom: 16, paddingLeft: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  rowText: { flex: 1, minWidth: 0, gap: 8 },
  rowHead: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 8 },
  name: { fontSize: 15 },
  // Board dispute card: padding 16 18 16 16, 10 between its parts.
  disputeCard: { paddingTop: 16, paddingRight: 18, paddingBottom: 16, paddingLeft: 16, gap: 10 },
  disputeHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  disputeDate: { marginLeft: 'auto' },
  outcome: { paddingTop: 10 },
  disputesEmpty: { marginTop: 8, paddingHorizontal: 4 },
  boxNone: { pointerEvents: 'box-none' },
  // The Screen's float column (edge placement leaves it to the dock).
  dockColumn: { width: '100%', maxWidth: 744, alignSelf: 'center' },
  scrim: { position: 'absolute', left: 0, right: 0, top: -SCRIM_FADE, bottom: 0 },
  dock: { padding: 12, borderRadius: radius.overlay },
  dockBody: { gap: 12 },
  // Close takes one share, the next step 1.45 (A-BStudy dock), 10 apart.
  actions: { flexDirection: 'row', gap: 10 },
  negative: { flex: 1, minWidth: 0 },
  positive: { flex: 1.45, minWidth: 0 },
});
