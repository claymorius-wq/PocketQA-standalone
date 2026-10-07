import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEMO_SHOWCASE_LABEL, type DemoBuilder, type DemoTester } from '@pocket-qa/contracts';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSession } from '../auth/SessionProvider';
import { useDemoShowcase } from '../lib/queries';
import { Card, Checkbox, QueryState, Text } from '../ui';
import { Hairline, plural, SectionHeader } from '../ui/patterns';
import { StatusPill } from '../ui/status';

/**
 * The labelled demo showcase (devnet demo deployment only, /config features.demoShowcase): synthetic
 * sample profiles, never real users. It lives in its OWN section below the real ranking and is never
 * interleaved with it: no rank, no money-like numbers, no actions, a "Demo" badge (a11y "Demo") on
 * every card. "Show demo examples" is on by default and remembered per viewer on this device. With
 * the flag off (production) nothing renders and nothing is requested.
 */
const showKey = (viewer: string) => `pocketqa.demoShowcase.show.${viewer}`;

export function DemoShowcaseSection() {
  const { user, features } = useSession();
  const on = !!features?.demoShowcase;
  const viewer = user?.id ?? 'anonymous';
  // This viewer's choice on this device: null until read (nothing shown or fetched yet, so a viewer
  // who hid the examples never sees them flash); default on when nothing is stored.
  const [show, setShow] = useState<boolean | null>(null);
  useEffect(() => {
    if (!on) return;
    let live = true;
    AsyncStorage.getItem(showKey(viewer))
      .then((v) => live && setShow(v !== '0'))
      .catch(() => live && setShow(true));
    return () => {
      live = false;
    };
  }, [on, viewer]);
  const q = useDemoShowcase({ enabled: on && show === true });
  if (!on || show === null) return null;
  const toggle = (next: boolean) => {
    setShow(next);
    void AsyncStorage.setItem(showKey(viewer), next ? '1' : '0').catch(() => {});
  };
  return (
    <View style={styles.section} testID="demo-showcase">
      <SectionHeader title={DEMO_SHOWCASE_LABEL} rule />
      <Checkbox checked={show} onChange={toggle} label="Show demo examples" testID="demo-toggle" />
      {show ? (
        <QueryState query={q}>
          {(d) => (
            <View style={styles.section}>
              <Text variant="small" tone="muted">
                Synthetic sample profiles for the demo: no real work, ratings or rewards stand behind them.
              </Text>
              <Card k={0.7} style={styles.card} testID="demo-testers">
                <Text variant="label">Demo testers</Text>
                {d.testers.map((p, i) => (
                  <DemoRow key={p.id} id={p.id} alias={p.alias} figures={testerFigures(p)} first={i === 0} />
                ))}
              </Card>
              {d.builders.length ? (
                <Card k={0.7} style={styles.card} testID="demo-builders">
                  <Text variant="label">Demo builders</Text>
                  {d.builders.map((p, i) => (
                    <DemoRow key={p.id} id={p.id} alias={p.alias} figures={builderFigures(p)} first={i === 0} />
                  ))}
                </Card>
              ) : null}
            </View>
          )}
        </QueryState>
      ) : null}
    </View>
  );
}

const testerFigures = (p: DemoTester) => `Quality ${p.qualityScore} of 100 · ${p.decided} decided · ${plural(p.badges.length, 'badge', 'badges')}`;
const builderFigures = (p: DemoBuilder) => plural(p.studiesPublished, 'study published', 'studies published');

/** One demo profile: the "Demo" badge, the alias, "Demo example · not a real user", fixture figures. No rank, no action. */
function DemoRow({ id, alias, figures, first }: { id: string; alias: string; figures: string; first: boolean }) {
  return (
    <View testID={`demo-profile-${id}`} style={styles.row} accessible accessibilityLabel={`Demo. ${alias}. Demo example, not a real user. ${figures}.`}>
      {first ? null : <Hairline inset={0} />}
      <View style={styles.head}>
        <View testID={`demo-badge-${id}`} accessible accessibilityLabel="Demo">
          <StatusPill status="demo" label="Demo" />
        </View>
        <Text variant="heading" numberOfLines={1} style={styles.flex}>
          {alias}
        </Text>
      </View>
      <Text variant="small" tone="muted">
        Demo example · not a real user
      </Text>
      <Text variant="small" tone="muted">
        {figures}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 10 },
  card: { padding: 16, gap: 8 },
  row: { gap: 4, paddingVertical: 6 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
});
