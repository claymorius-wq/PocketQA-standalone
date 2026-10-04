import { useEffect, useState } from 'react';
import { StyleSheet, Text as RNText, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';
import Svg, { Defs, Rect } from 'react-native-svg';
import { GlassSurface } from '../../glass';
import { GradientDef, HIDDEN, PASS_THROUGH, useSvgId } from '../../glass/paint';
import { GlassTile, type GlyphName, type GlyphVariant } from '../../icons';
import { when } from '../../lib/format';
import { DUR, STAGGER } from '../../theme/motion';
import { useTheme } from '../../theme/ThemeProvider';
import type { LinearGradientSpec, Tone } from '../../theme/tokens';
import { Hairline } from './ListRow';
import { Meta } from './type';

// The timeline groove (A-Audit; Direction A §13 "Audit: a timeline", §11.5 S9). One L1 card; a
// 2dp groove runs from node to node (its near half lit, its far half violet, a 1px shadow
// down-right); every entry has a 36dp glyph tile as its node. Entries are grouped under a DM Mono
// day label. AuditGroove and StatusTimeline are the two uses; both draw through this one Timeline.
//
// S9 "groove draws": on mount each segment reveals top to bottom over 320ms ease-lens, 40ms apart
// (at most five steps, from +120), and each node's key-light rim lights as the groove reaches it
// (0 → 1 → 0 over 560ms). RN adaptation: the board's clip-path inset becomes a scaleY from the
// segment's top edge (transform only; the groove is a vertical bar, so nothing visibly
// stretches). The lit rims mount only while the draw plays. Reduced motion: drawn, no rims.

/** One entry. Its key line is either the mono action key (`keyPrefix` + `keyVerb`) or a sans `title`. */
export type TimelineEntry = {
  id: string;
  glyph: GlyphName;
  /** Meaning rides on the node's rim tint. */
  tint?: Tone;
  glyphVariant?: GlyphVariant;
  /** "participation." in muted mono, then the verb ("approve") in 500 text. */
  keyPrefix?: string;
  keyVerb?: string;
  /** A sans 600 title instead of the mono key (status timelines). */
  title?: string;
  /** Right-aligned on the key line, the bare date (C6); under a day label, the time alone. */
  iso?: string | null;
  /** The reason sentence, Instrument Sans 15/22. */
  body?: string;
  /** A short mono tag after the sentence ("[stuck: overdue]"). */
  bodyTag?: string;
  /** The target reference, mono ("participation 7f3a9c1e"). */
  reference?: string;
  testID?: string;
};

export type TimelineGroup = { key: string; label?: string; entries: readonly TimelineEntry[] };

// The groove and node geometry: row padding 12 / 16, node 36, so node centres sit 30 below a row's
// top and the groove is centred on x = 16 + 18.
const NODE = 36;
const ROW_TOP = 12;
const ROW_LEFT = 16;
const GROOVE_TOP = ROW_TOP + NODE / 2;
const DAY_LABEL = 32; // padding 16 + one 16dp label line
const CONTENT_LEFT = ROW_LEFT + NODE + 12;
const DRAW_FROM = 120; // the signature starts once the host is half visible (§11.3)
/** Entries past this index render drawn: their segments are off screen when the draw plays. */
const DRAW_LIMIT = 12;

const NODE_RIM: LinearGradientSpec = {
  kind: 'linear',
  angle: 135,
  stops: [
    { offset: 0, color: '#EEF2FF', opacity: 1 },
    { offset: 0.34, color: '#8DB0FF', opacity: 0.62 },
    { offset: 0.72, color: '#8DB0FF', opacity: 0 },
  ],
};

export function Timeline({ groups, testID, draw = true }: { groups: readonly TimelineGroup[]; testID?: string; draw?: boolean }) {
  const { glass, motion } = useTheme();
  const play = draw && glass.enabled && !motion.reduced;
  // The lit rims exist only while the draw plays, then unmount (hidden layers stay cheap).
  const [drawing, setDrawing] = useState(play);
  useEffect(() => {
    if (!drawing) return;
    const t = setTimeout(() => setDrawing(false), DRAW_FROM + STAGGER.step * (STAGGER.maxSteps - 1) + DUR.rise);
    return () => clearTimeout(t);
  }, [drawing]);

  let index = 0;
  const total = groups.reduce((n, g) => n + g.entries.length, 0);
  return (
    <GlassSurface level="card" testID={testID} role="list" style={styles.card}>
      {groups.map((g, gi) => (
        <View key={g.key} role="listitem">
          {g.label ? <DayLabel text={g.label} /> : null}
          <View role="list">
            {g.entries.map((e, ei) => {
              const i = index++;
              const last = i === total - 1;
              const nextInGroup = ei < g.entries.length - 1;
              const nextHasLabel = !nextInGroup && !!groups[gi + 1]?.label;
              return (
                <Entry
                  key={e.id}
                  entry={e}
                  index={i}
                  divided={ei > 0}
                  groove={last ? null : GROOVE_TOP + (nextHasLabel ? DAY_LABEL : 0)}
                  animate={play && i < DRAW_LIMIT}
                  lit={drawing && i < DRAW_LIMIT}
                  timeOnly={!!g.label}
                />
              );
            })}
          </View>
        </View>
      ))}
    </GlassSurface>
  );
}

function DayLabel({ text }: { text: string }) {
  const { colors, type } = useTheme();
  return (
    <RNText accessibilityRole="header" style={[type.label, styles.day, { color: colors.textMuted }]}>
      {text.toUpperCase()}
    </RNText>
  );
}

/** The time of day alone ("2:05 PM"), for an entry under its day label (A-Audit). */
export function timeOfDay(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function Entry({ entry: e, index, divided, groove, animate, lit, timeOnly }: { entry: TimelineEntry; index: number; divided: boolean; groove: number | null; animate: boolean; lit: boolean; timeOnly: boolean }) {
  const { colors, glass, type, motion } = useTheme();
  const delay = DRAW_FROM + STAGGER.step * Math.min(index, STAGGER.maxSteps - 1);
  const reveal = useSharedValue(animate ? 0 : 1);
  const ring = useSharedValue(0);
  useEffect(() => {
    if (!animate) return;
    reveal.value = withDelay(delay, withTiming(1, motion.timing.enter));
    const peak = Math.round(DUR.rise * 0.3);
    ring.value = withDelay(delay, withSequence(withTiming(1, { ...motion.timing.settle, duration: peak }), withTiming(0, { ...motion.timing.settle, duration: DUR.rise - peak })));
    // Mount only: the draw never replays on re-render.
  }, []);
  const grooveStyle = useAnimatedStyle(() => ({ transform: [{ scaleY: reveal.value }] }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ring.value }));
  const label = [e.keyPrefix && e.keyVerb ? `${e.keyPrefix}${e.keyVerb}` : e.title, e.iso ? when(e.iso) : null, e.body, e.reference].filter(Boolean).join(', ');
  return (
    <View testID={e.testID} role="listitem" accessible accessibilityLabel={label} style={styles.entry}>
      {divided ? <Hairline inset={CONTENT_LEFT} /> : null}
      {groove !== null ? (
        <Animated.View {...HIDDEN} style={[styles.groove, PASS_THROUGH, { bottom: -groove }, grooveStyle]}>
          {glass.enabled ? (
            <>
              <View style={[styles.grooveHalf, styles.grooveLit]} />
              <View style={[styles.grooveHalf, styles.grooveFar]} />
            </>
          ) : (
            <View style={[styles.grooveFlat, { backgroundColor: colors.border }]} />
          )}
        </Animated.View>
      ) : null}
      <View style={styles.node}>
        <GlassTile name={e.glyph} size="notice" tint={e.tint} variant={e.glyphVariant} />
        {lit ? (
          <Animated.View {...HIDDEN} style={[StyleSheet.absoluteFill, PASS_THROUGH, ringStyle]}>
            <NodeRing />
          </Animated.View>
        ) : null}
      </View>
      <View style={styles.content}>
        <View style={styles.keyRow}>
          {e.keyPrefix !== undefined || e.keyVerb !== undefined ? (
            <RNText numberOfLines={1} style={[type.meta, styles.key, { color: colors.textMuted }]}>
              {e.keyPrefix}
              <RNText style={[type.label, styles.verb, { color: colors.text }]}>{e.keyVerb}</RNText>
            </RNText>
          ) : (
            <RNText style={[type.heading, styles.title, { color: colors.text }]}>{e.title}</RNText>
          )}
          {/* Under a day label the date is already said: the key row carries the time alone; the entry's accessibility label keeps the full date. */}
          {e.iso ? <Meta style={styles.date}>{timeOnly ? timeOfDay(e.iso) : when(e.iso)}</Meta> : null}
        </View>
        {e.body || e.bodyTag ? (
          <RNText style={[type.body, styles.body, { color: colors.text }]}>
            {e.body}
            {e.bodyTag ? <RNText style={[type.meta, { color: colors.textMuted }]}>{` ${e.bodyTag}`}</RNText> : null}
          </RNText>
        ) : null}
        {e.reference ? <Meta style={styles.reference}>{e.reference}</Meta> : null}
      </View>
    </View>
  );
}

/** The node's key-light rim (1dp, lit top-left), drawn once per lit node while the groove passes. */
function NodeRing() {
  const id = useSvgId('nr');
  return (
    <Svg width={NODE} height={NODE}>
      <Defs>
        <GradientDef id={id} spec={NODE_RIM} box={{ x: 0, y: 0, w: NODE, h: NODE }} />
      </Defs>
      <Rect x={0.5} y={0.5} width={NODE - 1} height={NODE - 1} rx={11.5} fill="none" stroke={`url(#${id})`} strokeWidth={1} />
    </Svg>
  );
}

// ---------- Audit ----------

/** An audit log entry as the API returns it (useAudit items). */
export type AuditEntryData = { id: string; action: string; reason: string; targetType: string; targetId: string; createdAt: string };

/** Node glyph and rim tint for an audit action, by its verb (the part after the last dot). */
export function auditGlyph(action: string): { glyph: GlyphName; tint?: Tone; variant?: GlyphVariant } {
  const verb = action.slice(action.lastIndexOf('.') + 1);
  switch (verb) {
    case 'approve':
    case 'approved':
      return { glyph: 'approve', tint: 'success' };
    case 'reject':
    case 'rejected':
      return { glyph: 'reject', tint: 'danger', variant: 'rose' };
    case 'overturn':
    case 'overturned':
      return { glyph: 'disputes', tint: 'success' };
    case 'uphold':
    case 'upheld':
    case 'resolve':
    case 'resolved':
      return { glyph: 'disputes' };
    case 'suspend':
    case 'suspended':
      return { glyph: 'moderation', tint: 'danger' };
    case 'reinstate':
    case 'reinstated':
      return { glyph: 'consent', tint: 'success' };
    case 'delete':
    case 'deleted':
      return { glyph: 'remove', tint: 'danger', variant: 'rose' };
    default:
      return { glyph: 'audit' };
  }
}

/** "participation.approve" → ["participation.", "approve"]; "[stuck: overdue]" split off the reason. */
export function auditParts(a: AuditEntryData): Pick<TimelineEntry, 'keyPrefix' | 'keyVerb' | 'body' | 'bodyTag' | 'reference'> {
  const dot = a.action.lastIndexOf('.');
  const tag = /\s*(\[[^\]]+\])\s*$/.exec(a.reason);
  return {
    keyPrefix: dot >= 0 ? a.action.slice(0, dot + 1) : '',
    keyVerb: dot >= 0 ? a.action.slice(dot + 1) : a.action,
    body: tag ? a.reason.slice(0, tag.index) : a.reason,
    bodyTag: tag?.[1],
    reference: `${a.targetType} ${a.targetId.slice(0, 8)}`,
  };
}

/** The local calendar day an ISO time falls on, as the day label shows it ("Oct 3"). */
export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Groups entries by local day, keeping their order (the log is newest first). */
export function groupByDay<T extends { createdAt: string }>(items: readonly T[]): { day: string; items: T[] }[] {
  const out: { day: string; items: T[] }[] = [];
  for (const it of items) {
    const day = dayLabel(it.createdAt);
    const last = out[out.length - 1];
    if (last && last.day === day) last.items.push(it);
    else out.push({ day, items: [it] });
  }
  return out;
}

/**
 * The admin Audit log (A-Audit): the timeline grouped by day, each entry the action key with the
 * bare date right-aligned on its line, the reason sentence, then `{targetType} {id8}`. Every
 * entry keeps the screen's `audit-entry` testID.
 */
export function AuditGroove({ entries, entryTestID = 'audit-entry', testID, glyphFor = auditGlyph }: { entries: readonly AuditEntryData[]; entryTestID?: string; testID?: string; glyphFor?: typeof auditGlyph }) {
  const groups = groupByDay(entries).map((g) => ({
    key: g.day,
    label: g.day,
    entries: g.items.map((a) => {
      const look = glyphFor(a.action);
      return { id: a.id, glyph: look.glyph, tint: look.tint, glyphVariant: look.variant, iso: a.createdAt, testID: entryTestID, ...auditParts(a) };
    }),
  }));
  return <Timeline groups={groups} testID={testID} />;
}

// ---------- Status ----------

/** One status change of a participation or dispute, as the screens hold it. */
export type StatusEvent = { id: string; status: string; label: string; iso?: string | null; body?: string };

/** Node glyph and tint per status (the pill tones of the kit's StatusPill, on the rim instead). */
export function statusGlyph(status: string): { glyph: GlyphName; tint?: Tone; variant?: GlyphVariant } {
  switch (status) {
    case 'consented':
      return { glyph: 'consent', tint: 'info' };
    case 'in_progress':
      return { glyph: 'record', tint: 'info' };
    case 'submitted':
      return { glyph: 'send', tint: 'warning' };
    case 'approved':
    case 'confirmed':
      return { glyph: 'approve', tint: 'success' };
    case 'rejected':
    case 'failed':
      return { glyph: 'reject', tint: 'danger', variant: 'rose' };
    case 'disputed':
    case 'open':
      return { glyph: 'flag', tint: 'warning' };
    case 'resolved':
      return { glyph: 'disputes' };
    case 'withdrawn':
      return { glyph: 'remove' };
    default:
      return { glyph: 'info' };
  }
}

/**
 * A participation's or dispute's history (Joined → Submitted → Decided; Open → Resolved), oldest
 * first, on the same groove as the Audit log. Titles are the status labels the screens already
 * use (lib/format `statusLabel`); dates are bare, right-aligned.
 */
export function StatusTimeline({ events, testID, draw = false }: { events: readonly StatusEvent[]; testID?: string; draw?: boolean }) {
  const entries: TimelineEntry[] = events.map((ev) => {
    const look = statusGlyph(ev.status);
    return { id: ev.id, glyph: look.glyph, tint: look.tint, glyphVariant: look.variant, title: ev.label, iso: ev.iso, body: ev.body };
  });
  return <Timeline groups={[{ key: 'status', entries }]} testID={testID} draw={draw} />;
}

const styles = StyleSheet.create({
  card: { paddingBottom: 4 },
  day: { paddingTop: 16, paddingRight: 14, paddingLeft: CONTENT_LEFT },
  entry: { flexDirection: 'row', columnGap: 12, paddingTop: ROW_TOP, paddingRight: 14, paddingBottom: 12, paddingLeft: ROW_LEFT },
  groove: { position: 'absolute', left: ROW_LEFT + NODE / 2 - 1, top: GROOVE_TOP, width: 2, flexDirection: 'row', transformOrigin: 'top', boxShadow: '1px 1px 2px rgba(2,1,10,0.7)', borderRadius: 1 },
  grooveHalf: { width: 1, height: '100%' },
  grooveLit: { backgroundColor: 'rgba(214,224,255,0.4)' },
  grooveFar: { backgroundColor: 'rgba(110,96,210,0.3)' },
  grooveFlat: { width: 2, height: '100%' },
  node: { width: NODE, height: NODE, zIndex: 2 },
  content: { flex: 1, minWidth: 0 },
  keyRow: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 8, rowGap: 2 },
  key: { flexShrink: 1 },
  // The verb in DM Mono 500 at the meta size, without the label's tracking.
  verb: { letterSpacing: 0 },
  title: { fontSize: 15 },
  date: { marginLeft: 'auto' },
  body: { marginTop: 4 },
  reference: { marginTop: 8 },
});
