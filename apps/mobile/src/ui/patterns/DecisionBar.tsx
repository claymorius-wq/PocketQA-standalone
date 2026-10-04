import { useEffect, useRef, type RefObject } from 'react';
import { AccessibilityInfo, StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { GlassBlur, type Uplight } from '../../glass';
import { HIDDEN, PASS_THROUGH } from '../../glass/paint';
import { UPLIGHT } from '../../theme/motion';
import { radius } from '../../theme/tokens';
import { Button } from '../button';
import type { KitIcon } from '../icon';
import { Notice } from '../status';
import { Text } from '../text';

export type DecisionAction = {
  label: string;
  onPress: () => void;
  icon?: KitIcon;
  testID?: string;
  disabled?: boolean;
  /** Busy: the spinner replaces the icon and the label stays. */
  loading?: boolean;
};

export type DecisionBarProps = {
  /** The left action: Reject, Close (destructive by default), or a secondary Cancel. */
  negative: DecisionAction & { variant?: 'danger' | 'secondary' };
  /** The right action, under the right thumb: Approve, Publish, Resume. Primary. */
  positive: DecisionAction;
  /** `even` splits the row 1 : 1 (Review, Stuck); `lead` gives the confirm 1.45 (A-BStudy dock). */
  ratio?: 'even' | 'lead';
  /** A heading over the row ("Decision"). */
  title?: string;
  /** Float the bar as the L3 overlay dock (the screen's one blur), 12dp in from the edges. */
  docked?: boolean;
  /**
   * Docked, Android: the BlurTargetView holding the content behind the dock. Without one Android
   * takes GlassBlur's opaque fallback (never a see-through panel over scrolled content).
   */
  blurTarget?: RefObject<View | null>;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * The page-level decision pair (A-Review "Decision" dock, A-Stuck focus card, A-BStudy dock):
 * the destructive or secondary action on the left and the confirm on the right, the same order
 * as every sheet (C4). It only opens the sheet that asks; it never commits anything itself, so it
 * is never lit.
 */
export function DecisionBar({ negative, positive, ratio = 'even', title, docked = false, blurTarget, testID, style }: DecisionBarProps) {
  const row = (
    <View style={styles.row}>
      <Button {...negative} variant={negative.variant ?? 'danger'} style={styles.even} />
      <Button {...positive} variant="primary" style={ratio === 'lead' ? styles.lead : styles.even} />
    </View>
  );
  const heading = title ? (
    <Text variant="heading" style={docked ? styles.dockTitle : styles.title}>
      {title}
    </Text>
  ) : null;
  if (docked) {
    return (
      // §4: L3 is the only real blur (the stack screens' bottom dock).
      <GlassBlur radius={radius.overlay} blurTarget={blurTarget} testID={testID} style={[styles.dock, style]}>
        {heading}
        {row}
      </GlassBlur>
    );
  }
  return (
    <View testID={testID} style={style}>
      {heading}
      {row}
    </View>
  );
}

export type SheetActionsProps = {
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  cancelLabel?: string;
  confirmIcon?: KitIcon;
  /** Reject, Withdraw, Close, Suspend, Delete: dark rose glass, never lit. */
  destructive?: boolean;
  /** The request is in flight: both actions are disabled, the confirm shows the spinner. */
  pending?: boolean;
  /**
   * Overrides Cancel's lock (default: `pending`). ConfirmSheet unlocks Cancel again when a request
   * has hung for a long time, so a stuck request can always be escaped.
   */
  cancelDisabled?: boolean;
  /** A required field is not filled yet: unlit glass that wakes with a 240ms crossfade. */
  confirmDisabled?: boolean;
  /**
   * The Commit pass is playing (U7, after success): both actions ignore presses and the confirm is
   * announced busy, with no spinner and its lit look kept, until the sheet leaves (C4).
   */
  locked?: boolean;
  /**
   * U7 only (Approve and credit…, Publish): the sheet's commit light (useCommitUplight). The
   * confirm then carries the commit spill, which follows the light: it holds with the pilot,
   * peaks with the pass and is cut with a failure.
   */
  light?: Uplight;
  /**
   * Where the confirm's centre is across this row (dp from its left edge), for the sheet's
   * CommitUplight floor: the floor belongs to the sheet surface, painted first, under the title
   * and body, so it is placed by the sheet, not by this row.
   */
  onConfirmCenter?: (x: number, rowWidth: number) => void;
  cancelTestID?: string;
  confirmTestID?: string;
};

/**
 * A sheet's one action row (CONSISTENCY C4): Cancel (secondary) on the left, the confirm on the
 * right, each in a slot of exactly half the row, 12 apart. Pending keeps the confirm's label and swaps its glyph for
 * the spinner, and disables both actions; the light never rises while it waits. Pair with
 * SheetFailure for the failure branch and useCommitUplight + CommitUplight for U7 sheets.
 */
export function SheetActions({
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel = 'Cancel',
  confirmIcon,
  destructive = false,
  pending = false,
  cancelDisabled = pending,
  confirmDisabled = false,
  locked = false,
  light,
  onConfirmCenter,
  cancelTestID = 'confirm-cancel',
  confirmTestID = 'confirm-ok',
}: SheetActionsProps) {
  const commit = !!light && light.enabled && !destructive;
  const spill = useAnimatedStyle(() => ({ opacity: light ? Math.min(1, light.u.value / UPLIGHT.pilot.sheet) : 0 }));
  const rowWidth = useRef(0);
  const center = useRef<number | null>(null);
  const report = () => {
    if (center.current !== null && rowWidth.current > 0) onConfirmCenter?.(center.current, rowWidth.current);
  };
  const onRow = (e: LayoutChangeEvent) => {
    rowWidth.current = e.nativeEvent.layout.width;
    report();
  };
  const onConfirmBox = (e: LayoutChangeEvent) => {
    const { x, width } = e.nativeEvent.layout;
    center.current = x + width / 2;
    report();
  };
  return (
    <View style={[styles.row, styles.sheetRow]} onLayout={onRow}>
      {/* Both actions sit in equal unpadded slots (C4 1 : 1): a padded button on a 0 basis keeps its padding on top of its share on web. */}
      <View style={[styles.even, styles.slot]}>
        <Button label={cancelLabel} variant="secondary" onPress={onCancel} disabled={cancelDisabled || locked} testID={cancelTestID} style={styles.fill} />
      </View>
      <View style={[styles.even, styles.slot]} onLayout={onConfirmBox}>
        {commit ? <Animated.View {...HIDDEN} style={[styles.spill, PASS_THROUGH, spill]} /> : null}
        <Button
          label={confirmLabel}
          icon={confirmIcon}
          variant={destructive ? 'danger' : 'primary'}
          onPress={onConfirm}
          disabled={confirmDisabled}
          loading={pending}
          locked={locked}
          // S4 never plays on the fire of a confirm a Commit pass follows (C4); it still plays when it enables.
          sweepOnFire={!light}
          testID={confirmTestID}
          style={styles.fill}
        />
      </View>
    </View>
  );
}

/**
 * The sheet's failure branch (C4): the danger notice "Action failed" with the server's brief
 * error, announced when it appears. The sheet stays open and the confirm comes back enabled
 * (retry); the commit light has already been cut.
 */
export function SheetFailure({ message, title = 'Action failed', testID }: { message: string; title?: string; testID?: string }) {
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(`${title}. ${message}`);
  }, [title, message]);
  return (
    <View accessibilityRole="alert" style={styles.failure}>
      <Notice tone="danger" title={title} testID={testID}>
        {message}
      </Notice>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  sheetRow: { gap: 12 },
  // CSS `flex: 1 1 0` in long form: react-native-web resolves `flex: 1` as a shorthand under its
  // View default `flex-basis: auto`, so without the 0 basis the split followed the labels' widths.
  even: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  lead: { flexGrow: 1.45, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  // A sheet action's slot (the confirm's also holds the commit spill); its button fills it. The
  // slots carry no padding, so on a 0 basis they split the row exactly (C4: 1 : 1).
  slot: { alignItems: 'stretch' },
  fill: { alignSelf: 'stretch', width: '100%' },
  title: { marginBottom: 10, marginLeft: 4 },
  dockTitle: { marginTop: 2, marginBottom: 10, marginLeft: 6 },
  dock: { padding: 12, borderRadius: radius.overlay },
  // The commit-sheet confirm's fourth shadow (§10.3), on its own layer so only its opacity moves.
  spill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: radius.button, boxShadow: '0 14px 30px -10px rgba(141,176,255,0.6)' },
  failure: { marginTop: 16 },
});
