import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RequireRole } from '../../src/screens/RequireRole';
import { router } from 'expo-router';
import { Plus, Save, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { CreateStudyBody, type Platform as P } from '@pocket-qa/contracts';
import { lintCopy } from '@pocket-qa/domain';
import { api, ApiError } from '../../src/api/client';
import { Button, Card, Checkbox, Field, Notice, Row, Screen, Section, Text } from '../../src/ui';

const DEFAULT_CONSENT =
  'I agree to record my screen only while doing the tasks in this study. I will review every clip before upload and remove anything private. Recordings are used only to improve this app.';

function NewStudyInner() {
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [build, setBuild] = useState('');
  const [tasks, setTasks] = useState<string[]>(['']);
  const [platforms, setPlatforms] = useState<P[]>(['android']);
  const [minApi, setMinApi] = useState('29');
  const [langs, setLangs] = useState('en');
  const [reward, setReward] = useState('50');
  const [slots, setSlots] = useState('5');
  const [consent, setConsent] = useState(DEFAULT_CONSENT);
  const body = {
    title,
    objective,
    ...(build.trim() ? { buildUnderTest: build } : {}),
    tasks: tasks.filter((t) => t.trim()).map((instruction) => ({ instruction })),
    deviceCriteria: { platforms, minAndroidApi: platforms.includes('android') && minApi ? Number(minApi) : null, languages: langs.split(',').map((l) => l.trim()).filter(Boolean) },
    rewardCredits: Number(reward),
    slots: Number(slots),
    consentText: consent,
  };
  const parsed = CreateStudyBody.safeParse(body);
  const copyIssues = [title, objective, consent, ...tasks].flatMap(lintCopy);
  const create = useMutation({
    mutationFn: () => api('createStudy', { body }),
    onSuccess: (s) => {
      qc.invalidateQueries({ queryKey: ['studies'] });
      router.replace(`/builder/study/${s.id}`);
    },
  });
  const firstIssue = parsed.success ? null : parsed.error.issues[0];
  const togglePlatform = (p: P) => setPlatforms((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));
  return (
    <Screen testID="new-study-screen">
      <Text variant="display">New study</Text>
      <Text tone="muted">Saved as a draft. Publishing reserves reward × slots from your test credits.</Text>
      <Card>
        <Field label="Title" value={title} onChangeText={setTitle} testID="study-title" />
        <Field label="Objective" value={objective} onChangeText={setObjective} multiline hint="What should testers help you learn?" testID="study-objective" />
        <Field label="Build under test (optional)" value={build} onChangeText={setBuild} hint="A link or version label. The server never fetches it." testID="study-build" />
      </Card>
      <Section title="Tasks">
        {tasks.map((t, i) => (
          <Card key={i}>
            <Field label={`Task ${i + 1}`} value={t} onChangeText={(v) => setTasks((list) => list.map((x, j) => (j === i ? v : x)))} multiline testID={`study-task-${i}`} />
            {tasks.length > 1 ? <Button label="Remove task" icon={Trash2} variant="ghost" onPress={() => setTasks((list) => list.filter((_, j) => j !== i))} /> : null}
          </Card>
        ))}
        <Button label="Add task" icon={Plus} variant="secondary" onPress={() => setTasks((l) => [...l, ''])} testID="study-add-task" />
      </Section>
      <Section title="Device criteria">
        <Card>
          <Text variant="small" tone="muted">Matched against testers’ self-reported devices.</Text>
          <Checkbox label="Android" checked={platforms.includes('android')} onChange={() => togglePlatform('android')} testID="crit-android" />
          <Checkbox label="iOS" checked={platforms.includes('ios')} onChange={() => togglePlatform('ios')} testID="crit-ios" />
          <Checkbox label="Web" checked={platforms.includes('web')} onChange={() => togglePlatform('web')} testID="crit-web" />
          {platforms.includes('android') ? <Field label="Minimum Android API" value={minApi} onChangeText={setMinApi} keyboardType="number-pad" testID="crit-min-api" /> : null}
          <Field label="Languages" value={langs} onChangeText={setLangs} hint="Comma-separated; leave empty for any." testID="crit-langs" />
        </Card>
      </Section>
      <Section title="Reward and budget">
        <Card>
          <Row>
            <Field label="Reward per tester" value={reward} onChangeText={setReward} keyboardType="number-pad" testID="study-reward" />
            <Field label="Slots" value={slots} onChangeText={setSlots} keyboardType="number-pad" testID="study-slots" />
          </Row>
          <Text variant="small" tone="muted">Budget to reserve at publish: {(Number(reward) * Number(slots) || 0).toLocaleString('en-US')} test credits. Testers are credited only after you approve their work.</Text>
        </Card>
      </Section>
      <Section title="Consent text">
        <Card>
          <Field label="Testers must accept this" value={consent} onChangeText={setConsent} multiline testID="study-consent" />
        </Card>
      </Section>
      {copyIssues.length ? <Notice tone="danger" title="Wording not allowed" testID="copy-issue">Remove promises of earnings, payment or AI analysis ({copyIssues.join(', ')}).</Notice> : null}
      {firstIssue ? <Text variant="small" tone="muted" testID="study-form-hint">To save: {firstIssue.path.join('.') || 'form'} — {firstIssue.message}</Text> : null}
      {create.error ? <Notice tone="danger" title="Couldn’t save" testID="create-error">{(create.error as ApiError).message}</Notice> : null}
      <Button label="Save draft" icon={Save} onPress={() => create.mutate()} disabled={!parsed.success || copyIssues.length > 0} loading={create.isPending} testID="study-save" />
    </Screen>
  );
}

export default function NewStudy() {
  return (
    <RequireRole role="builder">
      <NewStudyInner />
    </RequireRole>
  );
}
