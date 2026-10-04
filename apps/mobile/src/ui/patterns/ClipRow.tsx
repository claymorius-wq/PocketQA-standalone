import type { ReactNode } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import { GlassSurface } from '../../glass';
import { bytes } from '../../lib/format';
import { useTheme } from '../../theme/ThemeProvider';
import { Button } from '../button';
import { Notice, StatusPill } from '../status';
import { Clauses, Meta } from './type';

/** A local evidence segment's state (evidence/segments.ts `LocalSegment.state`). */
export type ClipState = 'recorded' | 'kept' | 'uploading' | 'uploaded' | 'failed' | 'removed' | (string & {});

/** The pill a segment state shows: tone (the kit StatusPill status) and its verbatim label. */
export function clipPill(state: ClipState): { status: string; label: string } {
  switch (state) {
    case 'recorded':
      return { status: 'awaiting_signature', label: 'Not reviewed' };
    case 'kept':
      return { status: 'confirmed', label: 'kept' };
    case 'uploading':
      return { status: 'uploading', label: 'uploading' };
    case 'failed':
      return { status: 'failed', label: 'failed' };
    default:
      return { status: 'awaiting_signature', label: state };
  }
}

export type ClipRowProps = {
  /** The file name (the board shows it in mono on its own line; long names are truncated in the middle). */
  name: string;
  mimeType: string;
  /** Bytes, or null when the picker did not report a size. */
  size: number | null;
  state: ClipState;
  /** Why the upload failed (shown in danger under the name). */
  error?: string;
  /** The local preview the tester reviews before upload (the screen passes `MediaPreview`). */
  preview?: ReactNode;
  /** Keep is offered only before review; Remove until the upload starts. */
  onKeep?: () => void;
  onRemove?: () => void;
  /** Card testID; default `segment-${state}` (the screens' and Maestro's ids). */
  testID?: string;
  keepTestID?: string;
  removeTestID?: string;
};

/**
 * One local clip or screenshot awaiting review (A-Session evidence list): an L1 card with the
 * state pill and the mono readout (type · size) on its first line, the name, the preview, then
 * Keep and Remove side by side. Nothing leaves the device until it is kept and uploaded; Remove
 * deletes it here (remove-before-upload) and is never offered while it uploads. Put rows in a
 * GlideList so a removed row fades out and the rows below glide up (FLIP).
 */
export function ClipRow({ name, mimeType, size, state, error, preview, onKeep, onRemove, testID, keepTestID = 'segment-keep', removeTestID = 'segment-remove' }: ClipRowProps) {
  const { colors, type } = useTheme();
  const pill = clipPill(state);
  const canKeep = state === 'recorded' && !!onKeep;
  const canRemove = state !== 'uploading' && state !== 'uploaded' && state !== 'removed' && !!onRemove;
  return (
    <GlassSurface level="card" k={0.8} testID={testID ?? `segment-${state}`} role="group" accessibilityLabel={name} style={styles.card}>
      <View style={styles.head}>
        <StatusPill status={pill.status} label={pill.label} />
        <Clauses parts={[<Meta key="t">{mimeType}</Meta>, size ? <Meta key="s">{bytes(size)}</Meta> : null]} style={styles.readout} numberOfLines={1} />
      </View>
      <RNText numberOfLines={1} ellipsizeMode="middle" style={[type.meta, { color: colors.text }]}>{name}</RNText>
      {error ? <RNText style={[type.small, { color: colors.danger }]}>{error}</RNText> : null}
      {preview ? <View style={styles.preview}>{preview}</View> : null}
      {canKeep || canRemove ? (
        <View style={styles.actions}>
          {canKeep ? <Button label="Keep" icon="approve" variant="secondary" onPress={onKeep!} testID={keepTestID} style={styles.action} /> : null}
          {canRemove ? <Button label="Remove" icon="remove" variant="danger" onPress={onRemove!} testID={removeTestID} style={styles.action} /> : null}
        </View>
      ) : null}
    </GlassSurface>
  );
}

/**
 * The review-before-upload promise (A-Session, A-States 01): an info notice above the local
 * segments, in the brief's words. It shows while anything is still on the device.
 */
export function ReviewNotice({ testID, children = 'Nothing leaves this device until you keep it and tap Upload. Removed items are deleted here and never uploaded.' }: { testID?: string; children?: string }) {
  return (
    <Notice tone="info" title="Review before upload" testID={testID}>
      {children}
    </Notice>
  );
}

const styles = StyleSheet.create({
  // Board: padding 14 inside the rim, 10 between lines.
  card: { padding: 14, gap: 10, borderRadius: 24 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 28 },
  readout: { flexShrink: 1, textAlign: 'right' },
  preview: { borderRadius: 16, overflow: 'hidden' },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, paddingHorizontal: 12 },
});
