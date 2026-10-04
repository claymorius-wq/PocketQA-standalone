import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Reputation } from '@pocket-qa/contracts';
import { router } from 'expo-router';
import { Award, BadgeCheck, Smartphone, Sparkles, Trophy } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { api, ApiError } from '../api/client';
import { useLeaderboard, useReputation } from '../lib/queries';
import { useTheme } from '../theme/ThemeProvider';
import { Button, Card, Checkbox, EmptyState, Field, Notice, QueryState, Screen, Text } from '../ui';
import { KeyValue, KeyValueList, SectionHeader } from '../ui/patterns';

// Tester reputation (plan workstreams E/F): points for accepted work, badges and the opt-in
// leaderboard. Points have no cash value, aren't tradeable and aren't a token; the screen says so.
// The badge glyphs are the visual proposal for this phase (Lucide; production assets come later).

const BADGE_ICON = { first_accepted: BadgeCheck, reliable_tester: Award, helpful_feedback: Sparkles, device_specialist: Smartphone } as const;
const KIND_LABEL: Record<Reputation['events'][number]['kind'], string> = { accepted: 'Accepted test', helpful: 'Feedback marked helpful', reversal: 'Reversed after review' };

export function ReputationScreen() {
  const q = useReputation();
  return (
    <Screen title="Reputation" subtitle="Points have no cash value and can’t be traded." testID="reputation-screen">
      <QueryState query={q}>{(r) => <ReputationBody r={r} />}</QueryState>
    </Screen>
  );
}

function ReputationBody({ r }: { r: Reputation }) {
  const { colors } = useTheme();
  return (
    <View style={styles.page}>
      <Card k={1} style={styles.card}>
        <Text variant="numeral" testID="reputation-points">{r.points.toLocaleString('en-US')}</Text>
        <Text variant="small" tone="muted">points · earned only when a builder accepts your work</Text>
        <KeyValueList testID="reputation-stats">
          <KeyValue label={`Accepted (last ${r.stats.windowDays} days)`} value={r.stats.accepted} />
          <KeyValue label="Decided" value={r.stats.decided} />
          <KeyValue label="Quality score" value={`${r.stats.qualityScore} / 100`} valueTestID="reputation-score" />
        </KeyValueList>
        <Text variant="small" tone="muted">The quality score is a cautious estimate of how often your work is accepted. Opening a dispute or reporting honest problems never lowers it.</Text>
      </Card>
      <View>
        <SectionHeader title="Badges" />
        {r.badges.length ? (
          <View style={styles.badges} testID="reputation-badges">
            {r.badges.map((b) => {
              const Icon = BADGE_ICON[b.id];
              return (
                <Card key={b.id} k={0.8} style={styles.badge} testID={`badge-${b.id}`}>
                  <Icon size={22} color={colors.primary} />
                  <View style={styles.flex}>
                    <Text variant="heading">{b.label}</Text>
                    <Text variant="small" tone="muted">{b.description}</Text>
                  </View>
                </Card>
              );
            })}
          </View>
        ) : (
          <Text variant="bodySm" tone="muted" testID="reputation-no-badges">No badges yet. Your first accepted test earns one.</Text>
        )}
      </View>
      <LeaderboardSettings r={r} />
      <View>
        <SectionHeader title="History" />
        {r.events.length ? (
          <KeyValueList testID="reputation-events">
            {r.events.map((e, i) => (
              <KeyValue key={i} label={`${KIND_LABEL[e.kind]} · ${e.studyTitle}`} value={e.points > 0 ? `+${e.points}` : `${e.points}`} />
            ))}
          </KeyValueList>
        ) : (
          <Text variant="bodySm" tone="muted">No points yet.</Text>
        )}
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
      <SectionHeader title="Leaderboard" />
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

export function LeaderboardScreen() {
  const q = useLeaderboard();
  return (
    <Screen title="Leaderboard" subtitle="Ranked by quality over the last 90 days, never by volume or money." testID="leaderboard-screen">
      <QueryState query={q} empty={(d) => (d.items.length === 0 ? <EmptyState icon={Trophy} title="No one yet" body="Testers appear here after they opt in and have enough decided tests." /> : null)}>
        {(d) => (
          <View style={styles.list} testID="leaderboard-list">
            {d.items.map((row) => (
              <Card key={row.alias} k={0.8} style={styles.rowCard} testID={`leaderboard-row-${row.rank}`}>
                <Text variant="numeral">{row.rank}</Text>
                <View style={styles.flex}>
                  <Text variant="heading">{row.alias}</Text>
                  <Text variant="small" tone="muted">{`Quality ${row.qualityScore} / 100 · ${row.decided} decided · ${row.badges.length} badge${row.badges.length === 1 ? '' : 's'}`}</Text>
                </View>
              </Card>
            ))}
          </View>
        )}
      </QueryState>
    </Screen>
  );
}

const styles = StyleSheet.create({
  page: { gap: 24 },
  card: { padding: 16, gap: 10 },
  badges: { gap: 10 },
  badge: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1, minWidth: 0 },
  row: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  list: { gap: 10 },
  rowCard: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 14 },
});
