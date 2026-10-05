import { useMutation, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Plus, Save, Trash2 } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { CreateStudyBody, type Platform as P } from '@pocket-qa/contracts';
import { lintCopy } from '@pocket-qa/domain';
import { api, ApiError } from '../../src/api/client';
import { useSession } from '../../src/auth/SessionProvider';
import { formatUnits, parseUnits, PILOT_DISCLOSURE, unitName } from '../../src/lib/money';
import { GlassBlur, GlassSurface, useSweepOnEnable, Well } from '../../src/glass';
import { GradientRule, PASS_THROUGH, useSvgId } from '../../src/glass/paint';
import { useCrossfade } from '../../src/motion';
import { RequireRole } from '../../src/screens/RequireRole';
import { DUR } from '../../src/theme/motion';
import { useTheme } from '../../src/theme/ThemeProvider';
import { layout, radius, type GlassSurface as GlassRecipe } from '../../src/theme/tokens';
import { Button, Card, Checkbox, Field, Notice, Screen, Segmented, Text } from '../../src/ui';
import { SectionHeader } from '../../src/ui/patterns';

// A-NewStudy (Direction A v2). Layout rule from the board: grouped inputs sit in an L1 card
// (Basics, Reward and budget, Consent); repeating or tile inputs float on the ground (Tasks, the
// platform chips), so glass never stacks three deep. Save draft lives in the L3 bottom dock (the
// screen's one blur) with the one status line above it: the server's "Couldn’t save" notice, else
// the schema's "To save: …" hint; nothing while the wording notice is up (it already says why).
//
// Signature (§13): the wording notice enters and leaves in place, and S4 plays when "Save draft"
// enables (the Button's own sweep, plus the dock's lens-blue flash under it). No Uplight: a draft
// commits nothing, so nothing on this screen is ever lit from below.
//
// Motion: a new task rises in (320ms ease-lens), a removed task fades out left (180ms ease-exit)
// before it leaves the list, Minimum Android API rises 6dp when Android is switched on, the budget
// numeral ticks (240ms) when reward or slots change. Reduced motion: 120ms fades, no travel.

const DEFAULT_CONSENT =
  'I agree to record my screen only while doing the tasks in this study. I will review every clip before upload and remove anything private. Recordings are used only to improve this app.';

type TaskDraft = { key: number; text: string };

/** The board's dock clearance: the content ends 22dp above whatever floats at the bottom. */
const DOCK_CLEARANCE = 22;
/** The ground scrim behind the Save dock (board: 200dp), from the screen's bottom edge. */
const SCRIM_HEIGHT = 200;
const CHIP_RADIUS = 14;
const TASK_EXIT_SHIFT = -12;
const NOTICE_SHIFT = 6;

function NewStudyInner() {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [build, setBuild] = useState('');
  // Each task keeps a stable key so add/remove can animate the right row; the body is unchanged.
  const [tasks, setTasks] = useState<TaskDraft[]>([{ key: 0, text: '' }]);
  const nextKey = useRef(1);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [platforms, setPlatforms] = useState<P[]>(['android']);
  const [minApi, setMinApi] = useState('29');
  const [langs, setLangs] = useState('en');
  const [reward, setReward] = useState('50');
  const [slots, setSlots] = useState('5');
  // Wallet escrow is offered only where the server runs settlement (ADR 0007): the simulation, or
  // the Squads devnet pilot (§10, devnet test USDC with no value).
  const { features } = useSession();
  const escrowOffered = features.settlement !== 'off';
  const pilot = features.settlement === 'squads_devnet';
  const unit = unitName(pilot ? 'squads_devnet' : 'simulated');
  const [mode, setMode] = useState<'test_credits' | 'escrow'>('test_credits');
  const escrow = escrowOffered && mode === 'escrow';
  const [rewardUsdc, setRewardUsdc] = useState('1.00');
  const rewardUnits = parseUnits(rewardUsdc);
  const [consent, setConsent] = useState(DEFAULT_CONSENT);
  const { motion } = useTheme();
  // A task fading out has already left the form: it is never saved or linted.
  const live = tasks.filter((t) => t.key !== leaving);
  const body = {
    title,
    objective,
    ...(build.trim() ? { buildUnderTest: build } : {}),
    tasks: live.filter((t) => t.text.trim()).map((t) => ({ instruction: t.text })),
    deviceCriteria: { platforms, minAndroidApi: platforms.includes('android') && minApi ? Number(minApi) : null, languages: langs.split(',').map((l) => l.trim()).filter(Boolean) },
    ...(escrow ? { payment: { mode: 'escrow' as const, rewardUnits: rewardUnits ?? 0 } } : { rewardCredits: Number(reward) }),
    slots: Number(slots),
    consentText: consent,
  };
  const parsed = CreateStudyBody.safeParse(body);
  const copyIssues = [title, objective, consent, ...live.map((t) => t.text)].flatMap((t) => lintCopy(t, 'study'));
  const create = useMutation({
    mutationFn: () => api('createStudy', { body }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['studies'] });
      router.replace(`/builder/study/${s.id}`);
    },
  });
  const firstIssue = parsed.success ? null : parsed.error.issues[0];
  // §8 input error (board `flagged || linted`): a field takes the danger rim and label when the
  // linter flags its wording, or when the schema rejects a value that is not empty (an empty field
  // is only "not done yet": the dock's "To save" hint names it). Drawing only; the body is unchanged.
  const issuePaths = parsed.success ? [] : parsed.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code }));
  const linted = (v: string) => lintCopy(v, 'study').length > 0;
  const schemaBad = (prefix: string, v: string) => v.trim() !== '' && issuePaths.some((i) => i.path === prefix || i.path.startsWith(`${prefix}.`));
  const bad = (prefix: string, v: string) => linted(v) || schemaBad(prefix, v);
  // Saved tasks are the non-empty live ones, so schema paths index that list, not the rows on screen.
  const saved = live.filter((t) => t.text.trim());
  const taskBad = (t: TaskDraft) => {
    if (t.key === leaving) return false;
    if (linted(t.text)) return true;
    const at = saved.indexOf(t);
    if (at < 0) return false;
    // More than 20 tasks: the board marks the 21st (the first one over the limit).
    return schemaBad(`tasks.${at}`, t.text) || (at === 20 && issuePaths.some((i) => i.path === 'tasks' && i.code === 'too_big'));
  };
  const togglePlatform = (p: P) => setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  const canSave = parsed.success && copyIssues.length === 0;
  const budget = (Number(reward) * Number(slots) || 0).toLocaleString('en-US');

  // Anything that appears after the screen's own arrival enters by itself.
  const arrived = useRef(false);
  useEffect(() => {
    arrived.current = true;
  }, []);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const addTask = () => setTasks((l) => [...l, { key: nextKey.current++, text: '' }]);
  const removeTask = (key: number) => {
    if (leaving !== null) return;
    setLeaving(key);
    // Fade out in place, then leave the list.
    timers.current.push(
      setTimeout(() => {
        setTasks((l) => l.filter((t) => t.key !== key));
        setLeaving(null);
      }, motion.reduced ? DUR.tick : DUR.release),
    );
  };

  // The dock's one status line (board: server notice, else the schema hint, never with the wording notice).
  const status: 'error' | 'hint' | null = create.error ? 'error' : copyIssues.length || create.isPending ? null : firstIssue ? 'hint' : null;
  const [fired, setFired] = useState(0);
  const flashKey = useSweepOnEnable(canSave) + fired;
  const save = () => {
    setFired((n) => n + 1);
    create.mutate();
  };

  return (
    <Screen
      testID="new-study-screen"
      title="New study"
      subtitle={escrow ? pilot ? 'Saved as a draft. You fund it with devnet test USDC (no value) from your wallet before publishing.' : 'Saved as a draft. You fund it from your wallet (simulated) before publishing.' : 'Saved as a draft. Publishing reserves reward × slots from your test credits.'}
      // The Screen's dock: it ends the form above the dock, blurs it, moves with the arrival and steps
      // aside while the keyboard is up (so it never covers the field being typed in).
      dockPlacement="edge"
      dockKeyboard="hide"
      dockClearance={DOCK_CLEARANCE}
      // Keyboard focus clears the whole ground scrim behind the dock, not only the dock (web).
      focusFloor={SCRIM_HEIGHT}
      dock={
        <SaveDock
          lifted={status !== null}
          status={
            <>
              {/* Inside the Screen a late Notice rises in by itself (lq-up, 320ms). */}
              {status === 'error' ? (
                <Notice tone="danger" title="Couldn’t save" testID="create-error">{(create.error as ApiError).message}</Notice>
              ) : null}
              <Presence show={status === 'hint'} enter>
                {firstIssue ? <FormHint path={firstIssue.path.join('.') || 'form'} message={firstIssue.message} /> : null}
              </Presence>
            </>
          }
        >
          <SaveFlash playKey={canSave ? flashKey : 0} />
          <Button label="Save draft" icon={Save} onPress={save} disabled={!canSave} loading={create.isPending} testID="study-save" />
        </SaveDock>
      }
    >
          <Card k={1} style={styles.basics}>
            <Field label="Title" value={title} onChangeText={setTitle} invalid={bad('title', title)} testID="study-title" />
            <Field label="Objective" value={objective} onChangeText={setObjective} multiline invalid={bad('objective', objective)} hint="What should testers help you learn?" testID="study-objective" />
            <Field label="Build under test (optional)" value={build} onChangeText={setBuild} invalid={schemaBad('buildUnderTest', build)} hint="A link or version label. The server never fetches it." testID="study-build" />
          </Card>
          {/* The wording notice sits under the fields it is about; it leaves in place (180ms ease-exit). */}
          <Presence show={copyIssues.length > 0} enter={false}>
            <Notice tone="danger" title="Wording not allowed" testID="copy-issue">
              <WordingBody ids={copyIssues.join(', ')} />
            </Notice>
          </Presence>
          <View style={styles.section}>
            <SectionHeader title="Tasks" rule right={<Button label="Add task" icon={Plus} variant="secondary" onPress={addTask} testID="study-add-task" />} />
            <View style={styles.tasks}>
              {tasks.map((t, i) => (
                <TaskRow
                  key={t.key}
                  index={i}
                  value={t.text}
                  appear={t.key > 0}
                  leaving={t.key === leaving}
                  canRemove={tasks.length > 1}
                  invalid={taskBad(t)}
                  onChange={(v) => setTasks((list) => list.map((x) => (x.key === t.key ? { ...x, text: v } : x)))}
                  onRemove={() => removeTask(t.key)}
                />
              ))}
            </View>
          </View>
          <View style={styles.section}>
            <SectionHeader title="Device criteria" rule />
            <Text variant="small" tone="muted" style={styles.inset}>Matched against testers’ self-reported devices.</Text>
            <View style={styles.chips}>
              <PlatformChip label="Android" checked={platforms.includes('android')} onChange={() => togglePlatform('android')} testID="crit-android" />
              <PlatformChip label="iOS" checked={platforms.includes('ios')} onChange={() => togglePlatform('ios')} testID="crit-ios" />
              <PlatformChip label="Web" checked={platforms.includes('web')} onChange={() => togglePlatform('web')} testID="crit-web" />
            </View>
            <View style={styles.criteriaFields}>
              {platforms.includes('android') ? (
                <Appear animate={arrived.current} rise={NOTICE_SHIFT} style={styles.half}>
                  <Field label="Minimum Android API" value={minApi} onChangeText={setMinApi} keyboardType="number-pad" invalid={schemaBad('deviceCriteria.minAndroidApi', minApi)} testID="crit-min-api" />
                </Appear>
              ) : null}
              <View style={styles.half}>
                <Field label="Languages" value={langs} onChangeText={setLangs} invalid={schemaBad('deviceCriteria.languages', langs)} hint="Comma-separated; leave empty for any." testID="crit-langs" />
              </View>
            </View>
          </View>
          <View style={styles.section}>
            <SectionHeader title="Reward and budget" rule />
            {escrowOffered ? (
              <View style={styles.inset}>
                <Segmented
                  testID="payment-mode"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'test_credits', label: 'Test credits' },
                    { value: 'escrow', label: 'Wallet escrow' },
                  ]}
                />
              </View>
            ) : null}
            {escrow ? (
              pilot ? (
                <Notice tone="info" title="Devnet pilot" testID="escrow-pilot-notice">
                  {`You fund the study before publishing, from your linked wallet to the study’s Squads vault on Solana devnet; each approved test sends its reward from the vault to the tester’s saved wallet. ${PILOT_DISCLOSURE}`}
                </Notice>
              ) : (
                <Notice tone="info" title="Simulation" testID="escrow-sim-notice">
                  Wallet funding and rewards are simulated in this build: no wallet is charged and no funds move. You fund the study before publishing; each approved test sends its reward from the study escrow to the tester’s saved wallet.
                </Notice>
              )
            ) : null}
            <Card k={0.8} style={styles.rewardCard}>
              <View style={styles.rewardRow}>
                <View style={styles.rewardCell}>
                  {escrow ? (
                    <Field label={`Reward per accepted test (${unit})`} value={rewardUsdc} onChangeText={setRewardUsdc} numeral invalid={rewardUsdc.trim() !== '' && rewardUnits === null} testID="study-reward-usdc" />
                  ) : (
                    <Field label="Reward per tester" value={reward} onChangeText={setReward} keyboardType="number-pad" numeral invalid={schemaBad('rewardCredits', reward)} testID="study-reward" />
                  )}
                </View>
                <View {...DECORATIVE} style={styles.times}>
                  <Text variant="numeral" tone="muted" style={styles.timesGlyph}>×</Text>
                </View>
                <View style={styles.slotsCell}>
                  <Field label="Slots" value={slots} onChangeText={setSlots} keyboardType="number-pad" numeral invalid={schemaBad('slots', slots)} testID="study-slots" />
                </View>
              </View>
              <BudgetRule />
              {escrow ? (
                <View style={styles.budget} accessibilityLiveRegion="polite">
                  <Text variant="bodySm" tone="muted">
                    Reward pool: <Text variant="meta" testID="study-pool">{rewardUnits && Number(slots) > 0 ? `${formatUnits(rewardUnits * Number(slots))} ${unit}` : '—'}</Text>
                  </Text>
                  <Text variant="small" tone="muted">Plus the disclosed platform fee per approved test. The exact amount to fund is shown on the study before you fund it. Unused rewards and their fees are returned to your wallet when the study closes.</Text>
                </View>
              ) : (
                <BudgetLine budget={budget} />
              )}
            </Card>
          </View>
          <View style={styles.section}>
            <SectionHeader title="Consent text" rule />
            <Card k={0.64} style={styles.consentCard}>
              <Field label="Testers must accept this" value={consent} onChangeText={setConsent} multiline rows={5} invalid={bad('consentText', consent)} testID="study-consent" />
            </Card>
          </View>
    </Screen>
  );
}

const DECORATIVE = { accessible: false, importantForAccessibility: 'no-hide-descendants', 'aria-hidden': true } as const;

/** The wording notice's body: the linter's ids in DM Mono (C6: a readout of three words or fewer each). */
function WordingBody({ ids }: { ids: string }) {
  const { colors } = useTheme();
  return (
    <Text variant="bodySm" tone="muted">
      Remove promises of earnings, payment or AI analysis ({<Text variant="meta" style={{ color: colors.text }}>{ids}</Text>}).
    </Text>
  );
}

/** "To save: {path} — {message}": the path is a mono readout in primary, the rest a 13/18 hint. */
function FormHint({ path, message }: { path: string; message: string }) {
  return (
    <View style={styles.hint}>
      <Text variant="small" tone="muted" testID="study-form-hint">
        To save: <Text variant="meta" tone="primary">{path}</Text> — {message}
      </Text>
    </View>
  );
}

/**
 * Keeps its last children on screen while it leaves: opacity and 6dp of travel over 180ms
 * ease-exit, then it unmounts. `enter` rises it back in (320ms ease-lens); without it the child
 * enters by itself (Notice does). Present on mount: no motion (the screen's arrival carries it).
 */
function Presence({ show, enter, children }: { show: boolean; enter: boolean; children: ReactNode }) {
  const { motion } = useTheme();
  const kept = useRef<ReactNode>(children);
  if (show) kept.current = children;
  const [mounted, setMounted] = useState(show);
  if (show && !mounted) setMounted(true);
  const v = useSharedValue(show ? 1 : 0);
  useEffect(() => {
    if (show) {
      // A child that enters by itself (Notice) only needs the leave undone, in one tick.
      v.value = withTiming(1, enter ? motion.timing.enter : motion.timing.tick);
      return;
    }
    v.value = withTiming(0, motion.reduced ? motion.timing.tick : motion.timing.cut);
    const t = setTimeout(() => setMounted(false), motion.reduced ? DUR.tick : DUR.release);
    return () => clearTimeout(t);
  }, [show, enter, v, motion]);
  const shift = motion.reduced ? 0 : NOTICE_SHIFT;
  const style = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: (1 - v.value) * shift }] }));
  if (!mounted) return null;
  return <Animated.View style={[style, show ? null : PASS_THROUGH]}>{kept.current}</Animated.View>;
}

/** Rises in by itself when it mounts after the screen's arrival (`animate`); otherwise still. */
function Appear({ animate, rise, style, children }: { animate: boolean; rise: number; style?: ViewStyle; children: ReactNode }) {
  const { motion } = useTheme();
  const [from] = useState(animate);
  const v = useSharedValue(from ? 0 : 1);
  useEffect(() => {
    if (from) v.value = withTiming(1, motion.timing.enter);
    // Mount only, like every entrance.
  }, []);
  const travel = motion.reduced ? 0 : rise;
  const animated = useAnimatedStyle(() => ({ opacity: v.value, transform: [{ translateY: (1 - v.value) * travel }] }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}

/** One task: its label and multiline well on the ground, "Remove task" right-aligned under it. */
function TaskRow({ index, value, appear, leaving, canRemove, invalid, onChange, onRemove }: {
  index: number;
  invalid: boolean;
  value: string;
  appear: boolean;
  leaving: boolean;
  canRemove: boolean;
  onChange: (v: string) => void;
  onRemove: () => void;
}) {
  const { motion } = useTheme();
  const out = useSharedValue(0);
  useEffect(() => {
    if (leaving) out.value = withTiming(1, motion.reduced ? motion.timing.tick : motion.timing.cut);
  }, [leaving, out, motion]);
  const shift = motion.reduced ? 0 : TASK_EXIT_SHIFT;
  const exit = useAnimatedStyle(() => ({ opacity: 1 - out.value, transform: [{ translateX: out.value * shift }] }));
  return (
    <Appear animate={appear} rise={motion.entrance.rise}>
      <Animated.View style={[exit, leaving ? PASS_THROUGH : null]}>
        <Field label={`Task ${index + 1}`} value={value} onChangeText={onChange} multiline invalid={invalid} testID={`study-task-${index}`} />
        {canRemove ? (
          <Appear animate rise={0} style={styles.removeWrap}>
            <Button label="Remove task" icon={Trash2} variant="ghost" onPress={onRemove} style={styles.remove} />
          </Appear>
        ) : null}
      </Animated.View>
    </Appear>
  );
}

/**
 * A platform chip (board: three L2 raised tiles in one row): the kit Checkbox on raised glass,
 * whose violet-tile rim lights while it is checked (120ms crossfade). Light: the flat raised tile.
 */
function PlatformChip({ label, checked, onChange, testID }: { label: string; checked: boolean; onChange: (v: boolean) => void; testID: string }) {
  const { glass } = useTheme();
  const { onStyle } = useCrossfade(checked);
  const litRim = useMemo<GlassRecipe>(() => ({ radius: CHIP_RADIUS, fill: [], rim: glass.violetTile.rim, shadow: undefined }), [glass]);
  return (
    <View style={styles.chip}>
      <GlassSurface level="raised" radius={CHIP_RADIUS} grain={false} style={[styles.layer, PASS_THROUGH]} />
      {glass.enabled ? (
        <Animated.View style={[styles.layer, PASS_THROUGH, onStyle]}>
          <GlassSurface recipe={litRim} grain={false} style={styles.layer} />
        </Animated.View>
      ) : null}
      <Checkbox label={label} checked={checked} onChange={onChange} labelVariant="chip" testID={testID} />
    </View>
  );
}

function BudgetRule() {
  const { glass } = useTheme();
  return <GradientRule stops={glass.divider.stops} style={styles.rule} />;
}

/**
 * "Budget to reserve at publish: {n} test credits." The figure sits in a well as the 38/42
 * numeral and ticks (0.35 → 1, 5dp up, 240ms ease-lens) whenever reward or slots change.
 */
function BudgetLine({ budget }: { budget: string }) {
  const { motion } = useTheme();
  const tick = useSharedValue(1);
  const last = useRef(budget);
  useEffect(() => {
    if (last.current === budget) return;
    last.current = budget;
    tick.value = 0;
    tick.value = withTiming(1, motion.reduced ? motion.timing.tick : motion.timing.swap);
  }, [budget, tick, motion]);
  const rise = motion.reduced ? 0 : 5;
  const style = useAnimatedStyle(() => ({ opacity: 0.35 + 0.65 * tick.value, transform: [{ translateY: (1 - tick.value) * rise }] }));
  return (
    <View accessibilityLiveRegion="polite" style={styles.budget}>
      <View style={styles.budgetLabelCell}>
        <Text variant="bodySm" tone="muted" style={styles.budgetLabel}>Budget to reserve at publish:</Text>
      </View>
      <Well style={styles.budgetWell}>
        <View style={styles.numeralClip}>
          <Animated.View style={style}>
            <Text variant="numeral" testID="study-budget">{budget}</Text>
          </Animated.View>
        </View>
        <Text variant="small" tone="muted">test credits.</Text>
      </Well>
      <Text variant="small" tone="muted" style={styles.budgetNote}>Testers are credited only after you approve their work.</Text>
    </View>
  );
}

/** The lens-blue flash under Save draft that rides with S4 (board `ns-caus`, 560ms ease-refract, peak at 45%). */
function SaveFlash({ playKey }: { playKey: number }) {
  const { glass, motion } = useTheme();
  const v = useSharedValue(0);
  useEffect(() => {
    if (!playKey || !glass.enabled || !motion.play.causticSweep) return;
    const rise = Math.round(DUR.rise * 0.45);
    const cfg = (duration: number) => ({ duration, easing: motion.ease.refract, reduceMotion: ReduceMotion.Never });
    v.value = 0;
    v.value = withSequence(withTiming(1, cfg(rise)), withTiming(0, cfg(DUR.rise - rise)));
  }, [playKey, glass, motion, v]);
  const style = useAnimatedStyle(() => ({ opacity: v.value }));
  if (!glass.enabled) return null;
  return <Animated.View {...DECORATIVE} style={[styles.flash, PASS_THROUGH, style]} />;
}

/**
 * The bottom dock (board: L3 overlay 12dp in from the edges, padding 8, radius 26) with the status
 * line stacked on it and the ground scrim behind both, so form text never collides with the rim.
 * It is the Screen's `dock` (edge placement: the scrim spans the screen's width), so it arrives with
 * the screen and steps aside while the keyboard is up; its GlassBlur blurs the Screen's content.
 */
function SaveDock({ lifted, status, children }: { lifted: boolean; status: ReactNode; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const bottom = layout.tabBarInset + insets.bottom;
  return (
    <View style={styles.boxNone}>
      <Scrim lifted={lifted} />
      {/* The margins sit on an outer wrapper and the 744 cap on the column inside it (the Screen's
          float frame width), so on tablet and wide web the dock centres instead of stretching. */}
      <View style={[styles.boxNone, { marginLeft: layout.tabBarInset + insets.left, marginRight: layout.tabBarInset + insets.right, marginBottom: bottom }]}>
        <View style={[styles.dockColumn, styles.boxNone]}>
          {status}
          <GlassBlur style={styles.dock}>
            <View>{children}</View>
          </GlassBlur>
        </View>
      </View>
    </View>
  );
}

/**
 * The ground fading in behind the dock (board: 200dp, solid for its lower 70%). It stands at 60%
 * of its height under the dock alone and rises to full height under a status line.
 */
function Scrim({ lifted }: { lifted: boolean }) {
  const { colors, glass, motion } = useTheme();
  const id = useSvgId('ns-scrim');
  const v = useSharedValue(lifted ? 1 : 0);
  useEffect(() => {
    v.value = withTiming(lifted ? 1 : 0, lifted ? motion.timing.enter : motion.reduced ? motion.timing.tick : motion.timing.cut);
  }, [lifted, v, motion]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: 0.6 + 0.4 * v.value }] }));
  const base = glass.ground.base.stops;
  const top = colors.background;
  const end = glass.enabled ? (base[base.length - 1]?.color ?? colors.background) : colors.background;
  return (
    <Animated.View {...DECORATIVE} testID="dock-scrim" style={[styles.scrim, PASS_THROUGH, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset={0} stopColor={top} stopOpacity={0} />
            <Stop offset={0.3} stopColor={top} stopOpacity={1} />
            <Stop offset={1} stopColor={end} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

export default function NewStudy() {
  return (
    <RequireRole role="builder">
      <NewStudyInner />
    </RequireRole>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  boxNone: { pointerEvents: 'box-none' },
  inset: { paddingHorizontal: 4 },
  // Board: sections 20 apart (the screen's 14 + 6), 12 inside.
  section: { gap: 12, marginTop: 6 },
  basics: { paddingTop: 18, paddingRight: 18, paddingBottom: 18, paddingLeft: 18, gap: 14 },
  tasks: { gap: 12 },
  removeWrap: { alignSelf: 'flex-end' },
  remove: { paddingLeft: 12, paddingRight: 6 },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { flex: 1, minWidth: 0, borderRadius: CHIP_RADIUS, paddingLeft: 11, paddingRight: 10 },
  criteriaFields: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', marginTop: 4 },
  half: { flex: 1, minWidth: 0 },
  rewardCard: { paddingTop: 18, paddingRight: 18, paddingBottom: 18, paddingLeft: 18, gap: 16 },
  // Board grid: 1.2fr | 18 | 1fr, 8 apart, aligned on the wells.
  rewardRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  rewardCell: { flex: 1.2, minWidth: 0 },
  slotsCell: { flex: 1, minWidth: 0 },
  times: { width: 18, height: 52, alignItems: 'center', justifyContent: 'center' },
  timesGlyph: { fontSize: 22, lineHeight: 22 },
  rule: { height: 1 },
  budget: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 14, rowGap: 10 },
  // Board grid: the label fills 1fr (the well stays right) and its text is balanced over two
  // lines, "Budget to reserve / at publish:", which RN can only get from a measure cap. At 14/20
  // Instrument Sans "Budget to reserve" is 114.5dp and "Budget to reserve at" 130dp, so 120 breaks
  // after "reserve" with room for platform rounding.
  budgetLabelCell: { flex: 1, minWidth: 120 },
  budgetLabel: { maxWidth: 120 },
  budgetWell: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 56, paddingLeft: 13, paddingRight: 15 },
  numeralClip: { height: 42, overflow: 'hidden' },
  budgetNote: { width: '100%' },
  consentCard: { paddingTop: 14, paddingRight: 16, paddingBottom: 16, paddingLeft: 16, gap: 12 },
  hint: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: SCRIM_HEIGHT, transformOrigin: 'bottom' },
  dockColumn: { gap: 4, width: '100%', maxWidth: 744, alignSelf: 'center' },
  // GlassBlur draws a 1dp border: 7 + 1 is the board's 8dp padding.
  dock: { padding: 7, borderRadius: radius.overlay },
  flash: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: radius.button, boxShadow: '10px 14px 34px -8px rgba(111,155,255,0.8)' },
});
