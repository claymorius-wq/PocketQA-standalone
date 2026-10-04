import { router } from 'expo-router';
import { FlaskConical, Plus } from 'lucide-react-native';
import { useFocusRefetch, useStudies } from '../../src/lib/queries';
import { BuilderStudiesEmpty } from '../../src/screens/BuilderStudiesEmpty';
import { BuilderStudyCard } from '../../src/screens/BuilderStudyCard';
import { Button, QueryState, Screen } from '../../src/ui';
import { Enter } from '../../src/ui/screen';

// A-BStudies. The header's "New" is the screen's one primary; the empty state's action is
// secondary (an empty panel never lights); the empty card takes the board's stacked layout (lens
// and title in a row, the body full width under it, then the action). Signature (§13 "Cards
// stagger"): a list that arrives after the screen's own arrival (first load, Retry) rises card by
// card, 40ms apart, at most five steps; a list already there when the screen arrives moves with
// the content root, so each card's Enter stays still. The U1 hand-off after sign-in is the Screen's (ArrivalContext).
export default function Studies() {
  const q = useStudies();
  useFocusRefetch(q);
  const newBtn = <Button label="New" icon={Plus} onPress={() => router.push('/builder/new-study')} testID="new-study" />;
  return (
    <Screen title="Studies" subtitle="Your usability studies" right={newBtn} testID="studies-screen">
      <QueryState
        query={q}
        empty={(d) =>
          d.items.length === 0 ? (
            <BuilderStudiesEmpty icon={FlaskConical} title="No studies yet" body="Create a study with tasks and device criteria, then fund it with test credits to publish." action={<Button label="Create a study" variant="secondary" icon={Plus} onPress={() => router.push('/builder/new-study')} testID="empty-new-study" />} />
          ) : null
        }
      >
        {(d) =>
          d.items.map((s, i) => (
            <Enter key={s.id} step={i}>
              <BuilderStudyCard study={s} index={i} onPress={() => router.push(`/builder/study/${s.id}`)} />
            </Enter>
          ))
        }
      </QueryState>
    </Screen>
  );
}
