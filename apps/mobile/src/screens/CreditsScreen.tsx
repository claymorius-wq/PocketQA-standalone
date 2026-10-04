import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react-native';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { CREDITS_DISCLAIMER } from '@pocket-qa/contracts';
import { api, ApiError } from '../api/client';
import { useSession } from '../auth/SessionProvider';
import { GlassSurface } from '../glass';
import type { GlyphName } from '../icons';
import { useCredits, useFocusRefetch } from '../lib/queries';
import { useTheme } from '../theme/ThemeProvider';
import { layout, radius, type Tone } from '../theme/tokens';
import { Button, Card, Notice, QueryState, Screen, Segmented, Text, useScreenFocused } from '../ui';
import { Amount, BalanceHero, DateText, EmptyPanel, GlideList, ListRow, SectionHeader } from '../ui/patterns';

// Credits (tester tab) and Budget (builder tab): A-Credits and A-Budget (Direction A v2;
// CONSISTENCY D1, C6, §U). The balance leads, directly under the header; the builder's top-up card
// follows; History is one L1 card of ledger rows. Moments:
// - S5: the balance rolls whenever it changes while the screen is in view (BalanceHero), and the
//   new ledger row arrives 600ms after the roll starts; the rows below glide down one slot.
// - U5 (tester only): approved credits landing in view light the balance (Earned, Mode A). A
//   balance that already holds approved credits this app session has not shown opens at rest
//   (0.45, no rise). A builder's top-up is local test credit and is never lit (§13).

const KIND_LABEL: Record<string, string> = {
  test_topup: 'Local test top-up',
  study_reserve: 'Reserved for a study',
  reward_credit: 'Approved work',
  study_release: 'Released from a closed study',
  dispute_credit: 'Dispute overturned',
};

/**
 * The row's glyph tile per ledger kind (A-Credits, A-Budget). Meaning rides on the rim tint: credit
 * a builder approved, or a dispute returned, carries the success rim.
 */
const KIND_TILE: Record<string, { glyph: GlyphName; tint?: Tone }> = {
  test_topup: { glyph: 'credits' },
  study_reserve: { glyph: 'studies' },
  study_release: { glyph: 'studies' },
  reward_credit: { glyph: 'credits', tint: 'success' },
  dispute_credit: { glyph: 'disputes', tint: 'success' },
};

/** Ledger kinds that are credit earned by a tester: the only ones that light the balance (U5). */
const EARNING_KINDS: ReadonlySet<string> = new Set(['reward_credit', 'dispute_credit']);

/** S5: the ledger row enters this long after the roll starts (A-Credits, A-Budget). */
export const ROW_LANDS_AFTER = 600;
/** The empty row leaves before the first row lands: at +360, over 180ms ease-exit (A-Credits). */
const EMPTY_LEAVES_AFTER = 360;

type Entry = { id: string; kind: string; amount: number; createdAt: string };

/**
 * Earned credit the screen has already shown this app session, per account. UI state only (the
 * spec's `lastSeenDecisionAt`): it decides whether U5 rises or opens at rest, never what is shown.
 */
const shownEarnings = new Map<string, Set<string>>();
const shownFor = (account: string) => {
  let set = shownEarnings.get(account);
  if (!set) shownEarnings.set(account, (set = new Set()));
  return set;
};

/** Earned entries this account has not been shown yet. */
export function unseenEarnings(entries: readonly Entry[], shown: ReadonlySet<string>): Entry[] {
  return entries.filter((e) => EARNING_KINDS.has(e.kind) && !shown.has(e.id));
}

/** Test seam: forget what the screen has shown (a new app session). */
export function resetShownEarnings() {
  shownEarnings.clear();
}

export type EarnedMoment = { earned: boolean; seen: boolean };

/**
 * U5 on the balance (CONSISTENCY §M3, Direction A §10.2). Opening on earned credit not shown yet
 * renders the light at rest; earned credit that lands while the screen is focused makes it rise.
 * Credit that lands while the tab is away is caught on the next focus (the focus refetch). Once
 * lit, it stays at rest while the screen is mounted.
 */
export function useEarnedMoment(entries: readonly Entry[], { enabled, focused, account }: { enabled: boolean; focused: boolean; account: string }): EarnedMoment {
  const [moment, setMoment] = useState<EarnedMoment>(() =>
    enabled && unseenEarnings(entries, shownFor(account)).length > 0 ? { earned: true, seen: true } : { earned: false, seen: false },
  );
  useEffect(() => {
    if (!enabled || !focused) return;
    const shown = shownFor(account);
    const fresh = unseenEarnings(entries, shown);
    if (fresh.length === 0) return;
    for (const e of fresh) shown.add(e.id);
    setMoment((m) => (m.earned ? m : { earned: true, seen: false }));
  }, [entries, enabled, focused, account]);
  return moment;
}

/**
 * The ledger as the list shows it: a change while the screen is in view reaches the list
 * `delay` ms later (S5: the row lands after the roll has started). Away, or on mount, at once.
 */
export function useLandingEntries<T>(entries: T, { live, delay }: { live: boolean; delay: number }): T {
  const [shown, setShown] = useState(entries);
  useEffect(() => {
    if (shown === entries) return;
    if (!live || delay <= 0) {
      setShown(entries);
      return;
    }
    const t = setTimeout(() => setShown(entries), delay);
    return () => clearTimeout(t);
  }, [entries, shown, live, delay]);
  return shown;
}

export function CreditsScreen({ title }: { title: string }) {
  const { user, features } = useSession();
  const q = useCredits();
  useFocusRefetch(q);
  const qc = useQueryClient();
  const [amount, setAmount] = useState<'500' | '1000' | '5000'>('1000');
  const topUp = useMutation({
    mutationFn: () => api('topUp', { body: { amount: Number(amount) } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['credits'] }),
  });
  const builder = user?.role === 'builder';
  return (
    <Screen title={title} subtitle={CREDITS_DISCLAIMER} testID="credits-screen">
      <QueryState query={q}>
        {(data) => (
          <CreditsBody
            balance={data.balance}
            disclaimer={data.disclaimer}
            entries={data.entries}
            account={user?.id ?? ''}
            tester={user?.role === 'tester'}
            topUp={
              // Production has no test credits and no real funding yet (ledger D3): say so, no button.
              builder && !features.testCredits ? (
                <View style={styles.topUp}>
                  <Notice tone="info" title="Funding isn’t available yet" testID="funding-unavailable">
                    Test credits are off on this deployment, and paying with real money isn’t enabled yet. You can draft studies; publishing needs funding.
                  </Notice>
                </View>
              ) : builder ? (
                <Card k={1} style={styles.topUp}>
                  <Text variant="title">Add local test credits</Text>
                  <Text variant="bodySm" tone="muted" style={styles.topUpBody}>Fund studies in this local build. No money changes hands.</Text>
                  <View style={styles.amounts}>
                    <Segmented
                      testID="topup-amount"
                      value={amount}
                      onChange={setAmount}
                      labelVariant="numeral"
                      options={[
                        { value: '500', label: '500' },
                        { value: '1000', label: '1,000' },
                        { value: '5000', label: '5,000' },
                      ]}
                    />
                  </View>
                  {topUp.error ? (
                    <View style={styles.topUpNext}>
                      <Notice tone="danger" title="Top-up failed">{(topUp.error as ApiError).message}</Notice>
                    </View>
                  ) : null}
                  <View style={styles.topUpNext}>
                    <Button label="Add test credits" icon={Plus} onPress={() => topUp.mutate()} loading={topUp.isPending} testID="topup-submit" />
                  </View>
                </Card>
              ) : null
            }
          />
        )}
      </QueryState>
    </Screen>
  );
}

function CreditsBody({ balance, disclaimer, entries, account, tester, topUp }: {
  balance: number;
  disclaimer: string;
  entries: Entry[];
  account: string;
  tester: boolean;
  topUp: ReactNode;
}) {
  const { motion } = useTheme();
  const focused = useScreenFocused();
  const moment = useEarnedMoment(entries, { enabled: tester, focused, account });
  const shown = useLandingEntries(entries, { live: focused, delay: motion.reduced ? 0 : ROW_LANDS_AFTER });
  // The empty row is leaving: the first entry exists but has not landed in the list yet.
  const emptyLeaving = shown.length === 0 && entries.length > 0;
  return (
    <>
      <BalanceHero
        balance={balance}
        disclaimer={`${disclaimer}. Credits can’t be withdrawn or exchanged.`}
        earned={moment.earned}
        seen={moment.seen}
        play={focused}
        // A-Budget: the top-up card sits 16 under the balance (the screen column gives 14 of it).
        style={topUp ? styles.balanceBeforeTopUp : undefined}
      />
      {topUp}
      <View style={[styles.history, topUp ? styles.historyAfterTopUp : null]}>
        <SectionHeader title="History" />
        {/* One L1 card holds the ledger (A-Credits k 1; A-Budget, third on its screen, k 0.8). */}
        <GlassSurface level="card" k={topUp ? 0.8 : 1} role={shown.length > 0 ? 'list' : undefined} style={styles.ledger}>
          {shown.length === 0 ? (
            <EmptyRow leaving={emptyLeaving}>
              <EmptyPanel
                variant="row"
                icon={topUp ? 'budget' : 'credits'}
                title="No activity yet"
                body={tester ? 'Credits appear here when a builder approves your work.' : 'Top-ups, study reserves and releases appear here.'}
                testID="empty-state"
              />
            </EmptyRow>
          ) : null}
          {/* Always mounted, so the first row to land rises in like every later one. */}
          <GlideList gap={0}>
            {shown.map((e, i) => {
              const tile = KIND_TILE[e.kind];
              return (
                <View key={e.id} role="listitem">
                  <ListRow
                    glyph={tile?.glyph ?? 'credits'}
                    tint={tile?.tint}
                    title={KIND_LABEL[e.kind] ?? e.kind}
                    meta={<DateText iso={e.createdAt} />}
                    trailing={<Amount value={e.amount} />}
                    divided={i > 0}
                    testID={`ledger-${e.kind}`}
                  />
                </View>
              );
            })}
          </GlideList>
        </GlassSurface>
      </View>
    </>
  );
}

/** The empty row fades out (+360, 180ms ease-exit; reduced: 120ms) while the first row is on its way. */
function EmptyRow({ leaving, children }: { leaving: boolean; children: ReactNode }) {
  const { motion } = useTheme();
  const opacity = useSharedValue(1);
  useEffect(() => {
    if (!leaving) {
      opacity.value = 1;
      return;
    }
    opacity.value = motion.reduced ? withTiming(0, motion.timing.tick) : withDelay(EMPTY_LEAVES_AFTER, withTiming(0, motion.timing.cut));
  }, [leaving, opacity, motion]);
  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={style} importantForAccessibility={leaving ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={leaving}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  balanceBeforeTopUp: { marginBottom: 16 - layout.listGap },
  // A-Budget: padding 18 18 18 20 inside the rim and its own spacing (title, +4 body, +16 amounts, +12 …).
  topUp: { paddingBottom: 18, gap: 0 },
  topUpBody: { marginTop: 4 },
  amounts: { marginTop: 16 },
  topUpNext: { marginTop: 12 },
  // History: the heading, then the ledger card 10 below it.
  history: { gap: 10 },
  // A-Budget: History starts 28 under the top-up card (the screen column gives 14 of it).
  historyAfterTopUp: { marginTop: 28 - layout.listGap },
  ledger: { borderRadius: radius.card, paddingVertical: 4 },
});
