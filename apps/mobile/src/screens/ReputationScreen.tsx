import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { BadgeProgress, Leaderboard, Reputation } from '@pocket-qa/contracts';
import { router } from 'expo-router';
import { Trophy } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api, ApiError } from '../api/client';
import { useSession } from '../auth/SessionProvider';
import { GlassBlur } from '../glass';
import { arcShare, BADGES, keyBadge, medalLabel, progressText, useNewBadges, type BadgeId } from '../lib/badges';
import { useLeaderboard, useReputation } from '../lib/queries';
import { DemoShowcaseSection } from './DemoShowcase';
import { useTheme } from '../theme/ThemeProvider';
import { radius } from '../theme/tokens';
import { Button, Card, Checkbox, EmptyState, Field, Notice, QueryState, Screen, Text } from '../ui';
import { Hairline, KeyValue, KeyValueList, Medallion, plural, SectionHeader } from '../ui/patterns';

// Tester reputation (plan workstreams E/F; the Lens design in docs/design/reputation-layer.md, on
// the rules that are live): points for accepted work, the four badges as medallions, and the
// opt-in leaderboard. Points have no cash value, aren't tradeable and aren't a token; the screen
// says so. Earned glass is lit, a badge still ahead sits unlit in its socket with its count
// written beside it; nothing here is lit by an Uplight, celebrated or animated.

const KIND_LABEL: Record<Reputation['events'][number]['kind'], string> = { accepted: 'Accepted test', helpful: 'Feedback marked helpful', reversal: 'Reversed after review' };
const signedPoints = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US')} ${Math.abs(n) === 1 ? 'point' : 'points'}`;

export function ReputationScreen() {
  const q = useReputation();
  return (
    <Screen title="Reputation" subtitle="Points have no cash value and can’t be traded." testID="reputation-screen">
      <QueryState query={q}>{(r) => <ReputationBody r={r} />}</QueryState>
    </Screen>
  );
}

/**
 * A badge as the screens show it: its name (an earned badge's own), its line, whether it is new,
 * and whether its count is known (`counted`: an API before 0.6.1 sends no counts).
 */
type BadgeView = { id: BadgeId; name: string; line: string; p: BadgeProgress; isNew: boolean; counted: boolean };

function badgeViews(r: Reputation, fresh: ReadonlySet<BadgeId>): BadgeView[] {
  const counted = r.progress.length > 0;
  const progress = counted ? r.progress : (Object.keys(BADGES) as BadgeId[]).map((id) => ({ id, earned: r.badges.some((b) => b.id === id), current: 0, target: 1 }));
  return progress.map((p) => {
    const earned = r.badges.find((b) => b.id === p.id);
    return {
      id: p.id,
      name: earned?.label ?? BADGES[p.id].name,
      line: earned?.description ?? BADGES[p.id].rule,
      p,
      isNew: !!earned && fresh.has(p.id),
      counted,
    };
  });
}

function ReputationBody({ r }: { r: Reputation }) {
  const { user } = useSession();
  const { type } = useTheme();
  const fresh = useNewBadges(user?.id, r.badges.map((b) => b.id));
  const views = badgeViews(r, fresh);
  const lead = keyBadge(r.badges.map((b) => b.id));
  // The hero shows the hardest badge earned, or the first one to earn.
  const hero = views.find((v) => v.id === (lead ?? 'first_accepted'))!;
  return (
    <View style={styles.page}>
      <Card k={1} style={styles.hero} testID="reputation-hero">
        {/* One announcement for the badge: the block speaks for its medallion and its text. */}
        <View
          style={styles.heroTop}
          accessible
          accessibilityLabel={`${lead ? 'Top badge' : 'First badge'}: ${medalLabel(hero.name, hero.p, { isNew: hero.isNew, qualityScore: r.stats.qualityScore, counted: hero.counted })}`}
          testID="reputation-hero-badge"
        >
          <Medallion
            glyph={BADGES[hero.id].glyph}
            size="hero"
            state={hero.p.earned ? (hero.isNew ? 'new' : 'earned') : 'locked'}
            progress={hero.counted ? arcShare(hero.p, r.stats.qualityScore) : 0}
            testID="reputation-hero-medal"
          />
          <View style={styles.heroText}>
            <Text variant="label" tone="muted">
              {lead ? 'TOP BADGE' : 'FIRST BADGE'}
            </Text>
            {/* The title's face, not a heading: the badge is content, under the screen's own title. */}
            <Text variant="heading" style={type.title}>
              {hero.name}
            </Text>
            <BadgeState view={hero} qualityScore={r.stats.qualityScore} />
          </View>
        </View>
        <Hairline inset={0} style={styles.rule} />
        <View style={styles.pointsRow} accessible accessibilityLabel={`${r.points.toLocaleString('en-US')} points`}>
          <Text variant="numeral" testID="reputation-points">
            {r.points.toLocaleString('en-US')}
          </Text>
          <Text tone="muted">points</Text>
        </View>
        <Text variant="small" tone="muted">
          Earned only when a builder accepts your work. Points are reputation, not cash: they can’t be withdrawn, sold or turned into credits.
        </Text>
      </Card>

      <View>
        <SectionHeader title="Track record" rule />
        <Card k={0.8} style={styles.card}>
          <KeyValueList testID="reputation-stats">
            <KeyValue label={`Accepted (last ${r.stats.windowDays} days)`} value={`${r.stats.accepted} of ${r.stats.decided}`} />
            <KeyValue label="Quality score" value={`${r.stats.qualityScore} / 100`} valueTestID="reputation-score" />
          </KeyValueList>
          <Text variant="small" tone="muted">
            The quality score is a cautious estimate of how often your work is accepted. Opening a dispute or reporting honest problems never lowers it.
          </Text>
        </Card>
      </View>

      <View>
        <SectionHeader title="Badges" count={r.badges.length} rule />
        {r.badges.length ? null : (
          <Text variant="bodySm" tone="muted" style={styles.lead} testID="reputation-no-badges">
            No badges yet. Your first accepted test earns one.
          </Text>
        )}
        <Card k={0.8} style={styles.badgeCard} testID="reputation-badges">
          {views.map((v, i) => (
            <BadgeRow key={v.id} view={v} first={i === 0} qualityScore={r.stats.qualityScore} />
          ))}
        </Card>
      </View>

      <LeaderboardSettings r={r} />

      <View>
        <SectionHeader title="History" rule />
        {r.events.length ? (
          <KeyValueList testID="reputation-events">
            {r.events.map((e, i) => (
              <KeyValue key={i} label={`${KIND_LABEL[e.kind]} · ${e.studyTitle}`} value={signedPoints(e.points)} />
            ))}
          </KeyValueList>
        ) : (
          <Text variant="bodySm" tone="muted">
            No points yet.
          </Text>
        )}
      </View>
    </View>
  );
}

/** "Earned", "Earned · New" (New in primary DM Mono, so it never rides on colour alone), or the count. */
function BadgeState({ view, qualityScore, newTestID }: { view: BadgeView; qualityScore: number; newTestID?: string }) {
  if (!view.p.earned) {
    return (
      <Text variant="small" tone="muted">
        {view.counted ? progressText(view.p, qualityScore) : 'Not earned yet'}
      </Text>
    );
  }
  return (
    <View style={styles.stateRow}>
      <Text variant="small" tone="muted">
        Earned
      </Text>
      {view.isNew ? (
        <Text variant="label" tone="primary" testID={newTestID}>
          {' · NEW'}
        </Text>
      ) : null}
    </View>
  );
}

/** One badge: its medallion, name and rule (or what it was earned for), and its state. The text speaks. */
function BadgeRow({ view, first, qualityScore }: { view: BadgeView; first: boolean; qualityScore: number }) {
  const { p } = view;
  return (
    <View testID={`badge-${view.id}`} style={styles.badgeRow}>
      {first ? null : <Hairline inset={0} />}
      <Medallion glyph={BADGES[view.id].glyph} size="shelf" state={p.earned ? (view.isNew ? 'new' : 'earned') : 'locked'} progress={view.counted ? arcShare(p, qualityScore) : 0} />
      <View style={styles.badgeText}>
        <Text variant="heading" tone={p.earned ? 'default' : 'muted'}>
          {view.name}
        </Text>
        <Text variant="small" tone="muted">
          {view.line}
        </Text>
        <BadgeState view={view} qualityScore={qualityScore} newTestID={`badge-${view.id}-new`} />
      </View>
    </View>
  );
}

function LeaderboardSettings({ r }: { r: Reputation }) {
  const qc = useQueryClient();
  const [alias, setAlias] = useState(r.leaderboard.alias ?? '');
  const [optIn, setOptIn] = useState(r.leaderboard.optedIn);
  const save = useMutation({
    mutationFn: () => api('putLeaderboard', { body: { optIn, ...(alias.trim() ? { alias: alias.trim() } : {}) } }),
    onSuccess: (next) => {
      qc.setQueryData(['reputation'], next);
      void qc.invalidateQueries({ queryKey: ['leaderboard'] });
    },
  });
  return (
    <View>
      <SectionHeader title="Leaderboard" rule />
      <Card k={0.8} style={styles.card} testID="leaderboard-settings">
        <Text variant="bodySm" tone="muted">
          Off unless you opt in. Only your alias, quality score, number of decided tests and badges are shown: never your name, email, wallet or recordings. You need at least {r.leaderboard.minDecided} decided tests in the last 90 days to appear.
        </Text>
        <Checkbox checked={optIn} onChange={setOptIn} label="Show me on the leaderboard" testID="leaderboard-optin" />
        <Field label="Alias" value={alias} onChangeText={setAlias} hint="3–24 letters, digits, spaces, - or _." testID="leaderboard-alias" />
        {save.error ? (
          <Notice tone="danger" title="Couldn’t save" testID="leaderboard-error">
            {(save.error as ApiError).message}
          </Notice>
        ) : null}
        {r.leaderboard.optedIn ? (
          <Text variant="small" tone="muted" testID="leaderboard-rank">
            {r.leaderboard.rank ? `Your rank: ${r.leaderboard.rank}` : 'Not ranked yet: you need more decided tests in the window.'}
          </Text>
        ) : null}
        <View style={styles.row}>
          <Button label="Save" variant="secondary" onPress={() => save.mutate()} loading={save.isPending} testID="leaderboard-save" />
          <Button label="View leaderboard" icon={Trophy} variant="secondary" onPress={() => router.push('/leaderboard')} testID="leaderboard-open" />
        </View>
      </Card>
    </View>
  );
}

// ---------- Leaderboard ----------

/** How many rows share the first card, nearest the key light (no podium, no metals). */
const TOP = 3;

export function LeaderboardScreen() {
  const { user } = useSession();
  const q = useLeaderboard();
  // Only a tester has a place on the board: a builder or an admin may look, with no row of their own
  // (checked here too, not left to an empty cache).
  const tester = user?.role === 'tester';
  const me = useReputation({ enabled: tester });
  return (
    <Screen
      title="Leaderboard"
      subtitle="Ranked by quality over the last 90 days, never by volume or money."
      testID="leaderboard-screen"
      // Your own place, pinned: once the board and your settings are both in, and while neither
      // has failed (a failed refresh keeps old data, which the board then no longer shows).
      dock={tester && q.data && me.data && !q.error && !me.error ? <YouDock board={q.data} r={me.data} /> : null}
    >
      <QueryState query={q} empty={(d) => (d.items.length === 0 ? <EmptyState icon={Trophy} title="No one yet" body="Testers appear here after they opt in and have enough decided tests." /> : null)}>
        {(d) => (
          <View style={styles.list} testID="leaderboard-list">
            <Card k={1} style={styles.boardCard} testID="leaderboard-top">
              {d.items.slice(0, TOP).map((row, i) => (
                <BoardRow key={row.rank} row={row} first={i === 0} />
              ))}
            </Card>
            {d.items.length > TOP ? (
              <Card k={0.8} style={styles.boardCard} testID="leaderboard-rest">
                {d.items.slice(TOP).map((row, i) => (
                  <BoardRow key={row.rank} row={row} first={i === 0} />
                ))}
              </Card>
            ) : null}
          </View>
        )}
      </QueryState>
      {/* Demo examples: a separate, labelled section BELOW the real ranking, never interleaved with it. */}
      <DemoShowcaseSection />
    </Screen>
  );
}

type Row = Leaderboard['items'][number];

/** One ranked tester, read as one sentence: rank, alias, the key badge, quality and decided tests. */
function BoardRow({ row, first }: { row: Row; first: boolean }) {
  const { type } = useTheme();
  const lead = keyBadge(row.badges);
  const badges = plural(row.badges.length, 'badge', 'badges');
  const name = lead ? BADGES[lead].name : null;
  return (
    <View
      testID={`leaderboard-row-${row.rank}`}
      accessible
      accessibilityLabel={`Rank ${row.rank}: ${row.alias}. Quality ${row.qualityScore} of 100, ${row.decided} decided tests, ${badges}${name ? `, the top one ${name}` : ''}.`}
      style={styles.boardRow}
    >
      {first ? null : <Hairline inset={0} />}
      <Text variant="meta" tone="muted" style={styles.rank}>
        {row.rank}
      </Text>
      <Medallion glyph={lead ? BADGES[lead].glyph : 'accepted'} size="row" state={lead ? 'earned' : 'locked'} />
      <View style={styles.flex}>
        <Text variant="heading" numberOfLines={1}>
          {row.alias}
        </Text>
        <Text variant="small" tone="muted">{`${row.decided} decided · ${badges}`}</Text>
      </View>
      <View style={styles.score}>
        {/* The title's face, not a heading (the web would make every score an h1). */}
        <Text variant="heading" style={type.title}>
          {row.qualityScore}
        </Text>
        <Text variant="small" tone="muted">
          quality
        </Text>
      </View>
    </View>
  );
}

/** Your own row, pinned under the board: your place, or why you aren't on it yet. */
function YouDock({ board, r }: { board: Leaderboard; r: Reputation }) {
  const lb = r.leaderboard;
  const lead = keyBadge(r.badges.map((b) => b.id));
  const line = !lb.optedIn
    ? 'You’re hidden. Your points and badges still count.'
    : lb.rank
      ? `Rank ${lb.rank} of ${board.items.length} · Quality ${r.stats.qualityScore}`
      : `Not ranked yet: ${Math.min(r.stats.decided, lb.minDecided)} of ${lb.minDecided} decided tests in the last ${board.windowDays} days`;
  return (
    <GlassBlur radius={radius.overlay} style={styles.dock} testID="leaderboard-you">
      <View style={styles.dockRow}>
        {/* Your place reads as one sentence; Show me stays a button of its own beside it (inside an
            accessible view, VoiceOver could never reach it). */}
        <View style={styles.dockPlace} accessible accessibilityLabel={`You. ${line}`} testID="leaderboard-you-place">
          {lb.optedIn && lb.rank ? (
            <Text variant="meta" tone="muted" style={styles.rank}>
              {lb.rank}
            </Text>
          ) : null}
          <Medallion glyph={lead ? BADGES[lead].glyph : 'accepted'} size="row" state={lead ? 'earned' : 'locked'} />
          <View style={styles.flex}>
            <Text variant="heading">{lb.optedIn && lb.alias ? `You · ${lb.alias}` : 'You'}</Text>
            <Text variant="small" tone="muted">
              {line}
            </Text>
          </View>
        </View>
        {/* Back to the settings it was opened from; with no history (a refresh, a new tab, a deep
            link) Reputation opens in this screen's place, at its top. */}
        {lb.optedIn ? null : <Button label="Show me" size="compact" variant="secondary" onPress={() => router.dismissTo('/reputation')} testID="leaderboard-show-me" accessibilityHint="Opens Reputation, with your leaderboard settings" />}
      </View>
    </GlassBlur>
  );
}

const styles = StyleSheet.create({
  page: { gap: 24 },
  card: { padding: 16, gap: 10 },
  hero: { padding: 18, gap: 14 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  heroText: { flex: 1, minWidth: 0, gap: 4 },
  rule: { position: 'relative' },
  pointsRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
  lead: { marginBottom: 10 },
  badgeCard: { paddingHorizontal: 16, paddingVertical: 4 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12 },
  badgeText: { flex: 1, minWidth: 0, gap: 2 },
  stateRow: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  list: { gap: 14 },
  boardCard: { paddingHorizontal: 14, paddingVertical: 4 },
  boardRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingVertical: 10 },
  // Three digits fit; a longer rank widens its own row rather than wrapping.
  rank: { minWidth: 22, textAlign: 'center' },
  score: { alignItems: 'flex-end' },
  dock: { paddingHorizontal: 14, paddingVertical: 10 },
  dockRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dockPlace: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
});
