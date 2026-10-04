import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState, type ReactNode } from 'react';
import { AccessibilityInfo, Text as RNText } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Compass } from 'lucide-react-native';
import type { Uplight } from '../../../glass';
import { ThemeProvider, useTheme, type ThemePreference } from '../../../theme/ThemeProvider';
import {
  Amount,
  AuditGroove,
  auditGlyph,
  auditParts,
  BalanceHero,
  BudgetMeter,
  ClipRow,
  clipPill,
  creditsSuffix,
  DateText,
  DecisionBar,
  EmptyPanel,
  ErrorPanel,
  GlideList,
  groupByDay,
  KeyFigure,
  KeyValue,
  KeyValueList,
  layoutPips,
  LensShimmer,
  ListCard,
  ListRow,
  planBudgetMeter,
  planMeter,
  plural,
  RecordControl,
  ReviewNotice,
  RewardWell,
  rewardPhrase,
  SectionHeader,
  SheetActions,
  SheetFailure,
  signedAmount,
  SlotMeter,
  StatusTimeline,
  StudyCard,
  TaskList,
  useCommitUplight,
  type CommitStatus,
} from '..';
import { webFigureSize } from '../KeyValue';

// Jest resolves lucide's "react-native" export to an ES-module build the jest-expo transform does
// not compile; its CommonJS build is the same set of components (as in ui.test.tsx).
jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

let reduced = false;
beforeEach(() => {
  // Live loops (the record core, the Live uplight, spinners) repeat forever: fake timers hold them.
  jest.useFakeTimers();
  reduced = false;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(reduced));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: jest.fn() })) as unknown as typeof AccessibilityInfo.addEventListener);
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };

let setPreference: ((p: ThemePreference) => void) | undefined;
function Scheme({ children }: { children: ReactNode }) {
  setPreference = useTheme().setPreference;
  return <>{children}</>;
}

/** The same provider tree for render and rerender, so a rerender keeps component state and the scheme. */
function wrap(ui: ReactNode) {
  return (
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider fonts="system">
        <Scheme>{ui}</Scheme>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

async function renderIn(scheme: ThemePreference, ui: ReactNode) {
  const result = await render(wrap(ui));
  await act(async () => setPreference?.(scheme));
  return result;
}

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

const svgCount = (json: unknown) => (JSON.stringify(json).match(/"type":"RNSVGSvgView[A-Za-z]*"/g) ?? []).length;
const SCHEMES: ThemePreference[] = ['dark', 'light'];

describe('pattern data rules', () => {
  it('slot meter: one pip per slot up to 10, materials by share and status', () => {
    expect(planMeter({ slots: 5, filled: 2, awarded: 1, status: 'published' })).toEqual({
      kind: 'pips',
      width: 116,
      cells: ['awarded', 'filled', 'socket', 'socket', 'socket'],
    });
    // Draft and closed sockets are unlit; a closed study's taken pips are dimmed.
    expect(planMeter({ slots: 3, filled: 0, awarded: 0, status: 'draft' })).toMatchObject({ cells: ['socketUnlit', 'socketUnlit', 'socketUnlit'] });
    expect(planMeter({ slots: 3, filled: 2, awarded: 1, status: 'closed' })).toMatchObject({ cells: ['closed', 'closed', 'socketUnlit'] });
    // The row grows past 7 slots: max(116, 16n − 6).
    expect(planMeter({ slots: 10, filled: 0, awarded: 0, status: 'published' })).toMatchObject({ width: 154 });
  });

  it('slot meter: past 10 slots one bar whose shares never round to nothing', () => {
    expect(planMeter({ slots: 500, filled: 1, awarded: 1, status: 'published' })).toEqual({ kind: 'bar', width: 116, filledWidth: 8, awardedWidth: 6, unlit: false });
    // Filled stays 4dp clear of awarded when some slots are held for review.
    expect(planMeter({ slots: 500, filled: 2, awarded: 1, status: 'paused' })).toMatchObject({ filledWidth: 10, awardedWidth: 6 });
    expect(planMeter({ slots: 20, filled: 0, awarded: 0, status: 'draft' })).toMatchObject({ filledWidth: 0, awardedWidth: 0, unlit: true });
  });

  it('pips lay out with 6dp gaps and at least 10dp each', () => {
    expect(layoutPips(['filled', 'socket'], 116)).toEqual([
      { x: 0, w: 55, material: 'filled' },
      { x: 61, w: 55, material: 'socket' },
    ]);
    expect(layoutPips(Array(10).fill('socket'), 60)[1]!.w).toBe(10);
  });

  it('budget meter: awarded, committed, released (bare), available', () => {
    expect(planBudgetMeter({ slots: 5, awarded: 1, committed: 1, available: 2 })).toEqual(['awarded', 'filled', 'bare', 'socket', 'socket']);
  });

  it('amounts, plurals and the credits suffix read like the ledger', () => {
    expect(signedAmount(50)).toBe('+50');
    expect(signedAmount(-1250)).toBe('−1,250');
    expect(plural(1, 'task', 'tasks')).toBe('1 task');
    expect(plural(5, 'slot', 'slots')).toBe('5 slots');
    expect(creditsSuffix(1)).toBe(' test credit');
    expect(creditsSuffix(0)).toBe(' test credits');
  });

  it('audit entries split into key, reason, tag and reference; days group in order', () => {
    const a = { id: '1', action: 'participation.approve', reason: 'Notes cover the task. [stuck: builder_inactive]', targetType: 'participation', targetId: '7f3a9c1e-aaaa', createdAt: '2026-10-03T14:05:00' };
    expect(auditParts(a)).toEqual({
      keyPrefix: 'participation.',
      keyVerb: 'approve',
      body: 'Notes cover the task.',
      bodyTag: '[stuck: builder_inactive]',
      reference: 'participation 7f3a9c1e',
    });
    expect(auditGlyph('participation.reject')).toEqual({ glyph: 'reject', tint: 'danger', variant: 'rose' });
    expect(auditGlyph('something.else').glyph).toBe('audit');
    const days = groupByDay([
      { createdAt: '2026-10-03T14:05:00' },
      { createdAt: '2026-10-03T09:00:00' },
      { createdAt: '2026-10-02T16:18:00' },
    ]);
    expect(days.map((d) => [d.day, d.items.length])).toEqual([
      ['Oct 3', 2],
      ['Oct 2', 1],
    ]);
  });

  it('clip pills keep the screen labels', () => {
    expect(clipPill('recorded')).toEqual({ status: 'awaiting_signature', label: 'Not reviewed' });
    expect(clipPill('kept')).toEqual({ status: 'confirmed', label: 'kept' });
    expect(clipPill('uploading').status).toBe('uploading');
  });
});

describe.each(SCHEMES)('patterns in %s', (scheme) => {
  it('StudyCard is one labelled button with the reward well, meta and disclaimer', async () => {
    const onPress = jest.fn();
    await renderIn(scheme, <StudyCard title="Demo: onboarding screens" objective="Find where first-time users hesitate." rewardCredits={30} taskCount={1} slotsRemaining={5} onPress={onPress} testID="study-card-s1" />);
    const card = screen.getByTestId('study-card-s1');
    expect(card.props.accessibilityRole).toBe('button');
    expect(card.props.accessibilityLabel).toBe('Open study Demo: onboarding screens');
    expect(screen.getByText('1 task')).toBeTruthy();
    expect(screen.getByText('5 slots left')).toBeTruthy();
    // One stop: the hint reads the reward, the disclaimer and the meta.
    expect(card.props.accessibilityHint).toBe('30 test credits. Reward if approved. Not guaranteed. 1 task, 5 slots left.');
    expect(screen.getByText(/Reward if approved/)).toBeTruthy();
    await fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('RewardWell is no stop of its own; rewardPhrase reads it as one phrase, stacked units included', async () => {
    await renderIn(scheme, <RewardWell amount={1500} unit={['test credits', 'if approved']} testID="rw" />);
    // It sits inside a pressable card, which carries the phrase in its hint (no inert second stop on Android).
    expect(screen.getByTestId('rw').props.accessible).toBeFalsy();
    expect(screen.getByTestId('rw').props.accessibilityLabel).toBeUndefined();
    expect(rewardPhrase(1500, ['test credits', 'if approved'])).toBe('1,500 test credits if approved');
    expect(screen.getByText('1,500')).toBeTruthy();
  });

  it('BalanceHero keeps the credit-balance text and the balance-card id', async () => {
    await renderIn(scheme, <BalanceHero balance={1000} disclaimer="Test credits · no cash value. Credits can’t be withdrawn or exchanged." />);
    expect(screen.getByTestId('balance-card')).toBeTruthy();
    expect(screen.getByTestId('credit-balance')).toHaveTextContent('1,000 test credits');
    expect(screen.getByTestId('credit-balance').props.accessibilityLabel).toBe('1,000 test credits');
    expect(screen.getByText('BALANCE')).toBeTruthy();
  });

  it('ListCard divides rows after the first; a pressable row is a button', async () => {
    const onPress = jest.fn();
    const r = await renderIn(
      scheme,
      <ListCard testID="ledger">
        <ListRow glyph="approve" tint="success" title="Approved work" meta={<DateText iso="2026-10-03T16:40:00" />} trailing={<Amount value={50} />} testID="ledger-reward_credit" />
        <ListRow glyph="stuck" title="Demo: checkout flow" meta="8 days" onPress={onPress} testID="queue-1" />
      </ListCard>,
    );
    expect(screen.getByTestId('ledger').props.role).toBe('list');
    expect(screen.getByText('+50').props.accessibilityLabel).toBe('plus 50 test credits');
    expect(screen.getByText('Oct 3, 4:40 PM')).toBeTruthy();
    const row = screen.getByTestId('queue-1');
    expect(row.props.accessibilityRole).toBe('button');
    await fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
    // One hairline: on the second row's top edge only.
    expect(JSON.stringify(r.toJSON()).split('"position":"absolute","right":0,"top":0,"height":1}').length - 1).toBe(1);
  });

  it('SectionHeader is a header; the label variant uppercases and carries the count', async () => {
    await renderIn(
      scheme,
      <>
        <SectionHeader title="History" rule testID="h1" />
        <SectionHeader title="Visible" count={2} variant="label" />
      </>,
    );
    expect(screen.getByText('History').props.accessibilityRole).toBe('header');
    expect(screen.getByText('VISIBLE · 2')).toBeTruthy();
  });

  it('KeyValue rows and the lead figure read as term and value', async () => {
    await renderIn(
      scheme,
      <>
        <KeyFigure label="Reserved" value={150} valueTestID="budget-reserved" />
        <KeyValueList>
          <KeyValue label="Awarded" value={1000} swatch="awarded" valueTestID="budget-awarded" />
          <KeyValue label="Available" value={0} swatch="socket" valueTestID="budget-available" />
        </KeyValueList>
        <BudgetMeter slots={5} awarded={1} committed={1} available={3} testID="budget-meter" />
      </>,
    );
    expect(screen.getByTestId('budget-reserved')).toHaveTextContent('150');
    expect(screen.getByTestId('budget-awarded')).toHaveTextContent('1,000');
    expect(screen.getByLabelText('Awarded: 1,000')).toBeTruthy();
    expect(screen.getByLabelText('Reserved: 150')).toBeTruthy();
  });

  it('the lead figure fits its 104dp column on web (no adjustsFontSizeToFit there): 44 while it fits, smaller after, never below 16', () => {
    expect(webFigureSize('250', 104)).toBe(44);
    expect(webFigureSize('250', 0)).toBe(44);
    const tenThousands = webFigureSize('12,500', 104);
    expect(tenThousands).toBeLessThan(44);
    expect(tenThousands).toBeGreaterThan(30);
    // 0.6em per figure and 0.27em per comma, less the −1.4 tracking: the text fits the column.
    expect(5 * 0.6 * tenThousands + 0.27 * tenThousands - 1.4 * 5).toBeLessThanOrEqual(104);
    expect(webFigureSize('500,000,000', 104)).toBeGreaterThanOrEqual(16);
    expect(webFigureSize('500,000,000', 104)).toBeLessThan(tenThousands);
  });

  it('TaskList keeps per-step ids, labels the steps and renders step content', async () => {
    const tasks = [
      { id: 't1', instruction: 'Add any item to the cart', successCriteria: 'The cart shows one item' },
      { id: 't2', instruction: 'Reach the receipt screen' },
    ];
    await renderIn(
      scheme,
      <>
        <TaskList tasks={tasks} renderStep={(t) => <RNText>{`notes for ${t.id}`}</RNText>} />
        <TaskList tasks={tasks} variant="numbered" stepTestID={(i) => `num-${i}`} />
      </>,
    );
    expect(screen.getByTestId('task-0')).toBeTruthy();
    expect(screen.getByTestId('task-1')).toBeTruthy();
    expect(screen.getByText('TASK 2')).toBeTruthy();
    expect(screen.getByText('Done when: The cart shows one item')).toBeTruthy();
    expect(screen.getByText('notes for t2')).toBeTruthy();
    expect(screen.getAllByText('Add any item to the cart')[0]!.props.accessibilityHint).toBe('Task 1 of 2');
    expect(screen.getByTestId('num-1')).toHaveTextContent('2.Reach the receipt screen');
  });

  it('AuditGroove groups by day and keeps the audit-entry ids', async () => {
    const entries = [
      { id: 'a', action: 'participation.approve', reason: 'Notes cover the task.', targetType: 'participation', targetId: '7f3a9c1e99', createdAt: '2026-10-03T14:05:00' },
      { id: 'b', action: 'user.suspend', reason: 'Builder stopped responding', targetType: 'user', targetId: '2b81d04f00', createdAt: '2026-10-03T13:48:00' },
      { id: 'c', action: 'dispute.overturned', reason: 'The note documents the wallet step.', targetType: 'dispute', targetId: 'c90e57a2ff', createdAt: '2026-10-02T16:18:00' },
    ];
    await renderIn(scheme, <AuditGroove entries={entries} testID="audit" />);
    expect(screen.getAllByTestId('audit-entry')).toHaveLength(3);
    expect(screen.getByText('OCT 3')).toBeTruthy();
    expect(screen.getByText('OCT 2')).toBeTruthy();
    expect(screen.getByText('participation 7f3a9c1e')).toBeTruthy();
    expect(screen.getAllByTestId('audit-entry')[0]!.props.accessibilityLabel).toContain('participation.approve');
  });

  it('StatusTimeline titles each status change', async () => {
    await renderIn(
      scheme,
      <StatusTimeline
        events={[
          { id: '1', status: 'open', label: 'Open', iso: '2026-10-03T16:30:00' },
          { id: '2', status: 'resolved', label: 'Resolved', iso: '2026-10-03T18:05:00', body: 'Overturned: the tester was credited.' },
        ]}
      />,
    );
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('Overturned: the tester was credited.')).toBeTruthy();
  });

  it('SlotMeter reads "n of m slots filled"', async () => {
    await renderIn(
      scheme,
      <>
        <SlotMeter slots={5} filled={1} status="published" testID="meter" />
        <SlotMeter slots={50} filled={10} awarded={4} status="closed" testID="bar" />
      </>,
    );
    expect(screen.getByTestId('meter').props.accessibilityLabel).toBe('1 of 5 slots filled');
    expect(screen.getByTestId('bar').props.accessibilityLabel).toBe('10 of 50 slots filled');
  });

  it('RecordControl swaps Start for Stop and announces the start', async () => {
    const onStart = jest.fn();
    const onStop = jest.fn();
    function Harness() {
      const [live, setLive] = useState(false);
      return (
        <RecordControl
          live={live}
          help="Android asks for screen-capture permission each time."
          onStart={() => {
            onStart();
            setLive(true);
          }}
          onStop={() => {
            onStop();
            setLive(false);
          }}
        />
      );
    }
    await renderIn(scheme, <Harness />);
    expect(screen.getByTestId('recorder-card')).toBeTruthy();
    expect(screen.queryByTestId('record-stop')).toBeNull();
    await fireEvent.press(screen.getByTestId('record-start'));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Pocket QA is recording your screen');
    await advance(600);
    await fireEvent.press(screen.getByTestId('record-stop'));
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('record-start')).toBeTruthy();
  });

  it('RecordControl can disable Start', async () => {
    await renderIn(scheme, <RecordControl live={false} help="x" onStart={jest.fn()} onStop={jest.fn()} startDisabled />);
    expect(screen.getByTestId('record-start').props.accessibilityState).toEqual({ disabled: true, busy: false });
  });

  it('ClipRow offers Keep before review and Remove until the upload starts', async () => {
    const onKeep = jest.fn();
    const onRemove = jest.fn();
    const { rerender } = await renderIn(
      scheme,
      <ClipRow name="recording-1.mp4" mimeType="video/mp4" size={2_400_000} state="recorded" onKeep={onKeep} onRemove={onRemove} preview={<RNText>preview</RNText>} />,
    );
    expect(screen.getByTestId('segment-recorded')).toBeTruthy();
    expect(screen.getByText('NOT REVIEWED')).toBeTruthy();
    expect(screen.getByText('2.3 MB')).toBeTruthy();
    expect(screen.getByText('preview')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('segment-keep'));
    await fireEvent.press(screen.getByTestId('segment-remove'));
    expect(onKeep).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
    await rerender(wrap(<ClipRow name="recording-1.mp4" mimeType="video/mp4" size={null} state="uploading" onKeep={onKeep} onRemove={onRemove} />));
    expect(screen.getByTestId('segment-uploading')).toBeTruthy();
    expect(screen.queryByTestId('segment-keep')).toBeNull();
    expect(screen.queryByTestId('segment-remove')).toBeNull();
    await rerender(wrap(<ClipRow name="clip.webm" mimeType="video/webm" size={10} state="failed" error="Upload failed" onKeep={onKeep} onRemove={onRemove} />));
    expect(screen.getByText('Upload failed')).toBeTruthy();
    expect(screen.queryByTestId('segment-keep')).toBeNull();
    expect(screen.getByTestId('segment-remove')).toBeTruthy();
  });

  it('ReviewNotice states the review-before-upload promise', async () => {
    await renderIn(scheme, <ReviewNotice testID="review-notice" />);
    expect(screen.getByText('Review before upload')).toBeTruthy();
    expect(screen.getByText(/Nothing leaves this device/)).toBeTruthy();
  });

  it('DecisionBar puts the negative action left of the confirm', async () => {
    const reject = jest.fn();
    const approve = jest.fn();
    await renderIn(scheme, <DecisionBar title="Decision" docked negative={{ label: 'Reject', onPress: reject, testID: 'review-reject' }} positive={{ label: 'Approve', onPress: approve, testID: 'review-approve' }} />);
    const ids = screen.getAllByTestId(/^review-(reject|approve)$/).map((n) => n.props.testID as string);
    expect(ids).toEqual(['review-reject', 'review-approve']);
    await fireEvent.press(screen.getByTestId('review-approve'));
    expect(approve).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Decision')).toBeTruthy();
  });

  it('SheetActions: Cancel left, confirm right; pending disables both and keeps the label', async () => {
    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    const center = jest.fn();
    const { rerender } = await renderIn(scheme, <SheetActions confirmLabel="Publish" onConfirm={onConfirm} onCancel={onCancel} onConfirmCenter={center} />);
    expect(screen.getAllByTestId(/^confirm-(cancel|ok)$/).map((n) => n.props.testID as string)).toEqual(['confirm-cancel', 'confirm-ok']);
    await fireEvent.press(screen.getByTestId('confirm-ok'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    await rerender(wrap(<SheetActions confirmLabel="Publish" onConfirm={onConfirm} onCancel={onCancel} pending />));
    expect(screen.getByTestId('confirm-ok').props.accessibilityState).toEqual({ disabled: true, busy: true });
    expect(screen.getByTestId('confirm-cancel').props.accessibilityState).toEqual({ disabled: true, busy: false });
    expect(screen.getByText('Publish')).toBeTruthy();
    // ConfirmSheet's escape from a hung request: Cancel unlocks while the confirm stays busy.
    await rerender(wrap(<SheetActions confirmLabel="Publish" onConfirm={onConfirm} onCancel={onCancel} pending cancelDisabled={false} />));
    expect(screen.getByTestId('confirm-cancel').props.accessibilityState).toEqual({ disabled: false, busy: false });
    expect(screen.getByTestId('confirm-ok').props.accessibilityState).toEqual({ disabled: true, busy: true });
  });

  it('SheetFailure is an alert that announces the error', async () => {
    await renderIn(scheme, <SheetFailure message="Publishing needs 150 test credits; you have 100." testID="sheet-error" />);
    expect(screen.getByText('Action failed')).toBeTruthy();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith('Action failed. Publishing needs 150 test credits; you have 100.');
  });

  it('EmptyPanel: the lens with the glyph in front, in card, row and page variants', async () => {
    const r = await renderIn(
      scheme,
      <>
        <EmptyPanel icon={Compass} title="No matching studies right now" body="Check back later." testID="e1" />
        <EmptyPanel icon="credits" variant="row" title="No activity yet" body="Credits appear here when a builder approves your work." testID="e2" />
        <EmptyPanel icon="ring" variant="page" title="You withdrew" body="This session is closed." testID="e3" />
      </>,
    );
    expect(screen.getByText('No matching studies right now').props.accessibilityRole).toBe('header');
    expect(screen.getByTestId('e2')).toBeTruthy();
    expect(screen.getByTestId('e3')).toBeTruthy();
    expect(svgCount(r.toJSON())).toBeGreaterThan(0);
  });

  it('ErrorPanel: retry only when offered', async () => {
    const onRetry = jest.fn();
    await renderIn(
      scheme,
      <>
        <ErrorPanel glyph="offline" tint="warning" title="You’re offline" body="Can’t reach the local Pocket QA server." onRetry={onRetry} testID="offline-state" />
        <ErrorPanel glyph="lock" title="Not allowed" body="This account is suspended." testID="forbidden-state" retryTestID="none" />
      </>,
    );
    await fireEvent.press(screen.getByTestId('retry-button'));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('none')).toBeNull();
    expect(screen.getByText('You’re offline').props.accessibilityRole).toBe('header');
  });

  it('LensShimmer is a busy progressbar named by its label; no placeholder cards', async () => {
    const r = await renderIn(scheme, <LensShimmer />);
    const region = screen.getByTestId('loading-state');
    expect(region.props.accessibilityRole).toBe('progressbar');
    expect(region.props.accessibilityLabel).toBe('Loading…');
    expect(region.props.accessibilityState).toEqual({ busy: true });
    // Only the spinner's own canvas: no lens unless asked, no skeleton bars.
    expect(svgCount(r.toJSON())).toBe(1);
  });
});

describe('motion and light (dark)', () => {
  it('GlideList: a removed item fades out in place, then leaves; reduced motion removes it at once', async () => {
    const list = (keys: string[]) => (
      <GlideList testID="glide">
        {keys.map((k) => (
          <RNText key={k}>{k}</RNText>
        ))}
      </GlideList>
    );
    const { rerender } = await renderIn('dark', list(['a', 'b', 'c']));
    await rerender(wrap(list(['a', 'c'])));
    // Still there while it fades (240ms ease-exit), hidden from assistive tech.
    expect(screen.queryByText('b', { includeHiddenElements: true })).toBeTruthy();
    await advance(300);
    expect(screen.queryByText('b', { includeHiddenElements: true })).toBeNull();
    await rerender(wrap(list(['a', 'c', 'd'])));
    expect(screen.getByText('d')).toBeTruthy();
  });

  it('GlideList re-renders with the same keys show the new content without a merge', async () => {
    const list = (label: string) => (
      <GlideList>
        <RNText key="a">{label}</RNText>
        <RNText key="b">b</RNText>
      </GlideList>
    );
    const { rerender } = await renderIn('dark', list('uploading'));
    await rerender(wrap(list('uploaded')));
    expect(screen.getByText('uploaded')).toBeTruthy();
    expect(screen.queryByText('uploading')).toBeNull();
  });

  it('GlideList under reduced motion drops removed items immediately', async () => {
    reduced = true;
    const list = (keys: string[]) => (
      <GlideList>
        {keys.map((k) => (
          <RNText key={k}>{k}</RNText>
        ))}
      </GlideList>
    );
    const { rerender } = await renderIn('dark', list(['a', 'b']));
    await advance(10);
    await rerender(wrap(list(['a'])));
    expect(screen.queryByText('b', { includeHiddenElements: true })).toBeNull();
  });

  it('useCommitUplight: pilot while open and pending, cut on failure, pass then leave on success', async () => {
    let light: Uplight | undefined;
    const onLeave = jest.fn();
    function Probe({ open, status }: { open: boolean; status: CommitStatus }) {
      light = useCommitUplight({ open, status, onLeave });
      return null;
    }
    const ui = (open: boolean, status: CommitStatus) => wrap(<Probe open={open} status={status} />);
    const { rerender } = await renderIn('dark', <Probe open status="idle" />);
    await advance(1000);
    expect(light!.u.value).toBeCloseTo(0.55, 2);
    await rerender(ui(true, 'pending'));
    await advance(500);
    // The light never rises while a request is pending.
    expect(light!.u.value).toBeCloseTo(0.55, 2);
    await rerender(ui(true, 'error'));
    await advance(300);
    expect(light!.u.value).toBeCloseTo(0, 2);
    // A retry on the same open stays dark; the pilot returns only on the next open.
    await rerender(ui(true, 'pending'));
    await advance(1000);
    expect(light!.u.value).toBeCloseTo(0, 2);
    await rerender(ui(false, 'idle'));
    await rerender(ui(true, 'idle'));
    await advance(1000);
    expect(light!.u.value).toBeCloseTo(0.55, 2);
    await rerender(ui(true, 'pending'));
    await rerender(ui(true, 'success'));
    expect(onLeave).not.toHaveBeenCalled();
    await advance(280 + 680 + 10);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(light!.pass).toBe(1);
    await advance(2000);
    expect(light!.u.value).toBeCloseTo(0, 2);
  });

  it('useCommitUplight under reduced motion: no pass, and the sheet leaves at once', async () => {
    reduced = true;
    const onLeave = jest.fn();
    let light: Uplight | undefined;
    function Probe({ status }: { status: CommitStatus }) {
      light = useCommitUplight({ open: true, status, onLeave });
      return null;
    }
    const { rerender } = await renderIn('dark', <Probe status="pending" />);
    await advance(200);
    await rerender(wrap(<Probe status="success" />));
    await advance(1);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(light!.pass).toBe(0);
  });

  it('BalanceHero lights only while earned, and its lit numeral copy follows the light', async () => {
    const r = await renderIn('dark', <BalanceHero balance={50} earned />);
    await advance(2000);
    // The lit copy carries the one text shadow RN draws (§10.3).
    expect(JSON.stringify(r.toJSON())).toContain('"textShadowRadius":18');
    expect(screen.getByTestId('credit-balance')).toHaveTextContent('50 test credits');
  });

  it('light theme: the under-glow and the lit numeral are not drawn', async () => {
    const r = await renderIn('light', <BalanceHero balance={50} earned />);
    await advance(2000);
    expect(JSON.stringify(r.toJSON())).not.toContain('"textShadowRadius":18');
  });
});
