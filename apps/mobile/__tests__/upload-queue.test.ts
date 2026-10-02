import { applySegment, removeSegment, uploadKept, type LocalSegment } from '../src/evidence/segments';

const seg = (id: string, state: LocalSegment['state']): LocalSegment => ({
  id,
  state,
  kind: 'screenshot',
  name: `${id}.png`,
  mimeType: 'image/png',
  size: 10,
  uri: `file:///${id}`,
  capturedOn: 'android',
});

describe('upload queue (threat model: removed private segment leaks)', () => {
  it('uploads only kept and previously failed segments; never removed or unreviewed ones', async () => {
    const sent: string[] = [];
    let state = [seg('recorded', 'recorded'), seg('kept', 'kept'), seg('removed', 'removed'), seg('failed', 'failed'), seg('done', 'uploaded')];
    const out = await uploadKept(
      () => state,
      async (s) => {
        sent.push(s.id);
      },
      (fn) => (state = fn(state)),
    );
    expect(sent).toEqual(['kept', 'failed']);
    expect(out.find((s) => s.id === 'removed')!.state).toBe('removed');
    expect(out.find((s) => s.id === 'recorded')!.state).toBe('recorded');
    expect(out.find((s) => s.id === 'kept')!.state).toBe('uploaded');
  });

  it('marks a failed upload as failed with its message and keeps going', async () => {
    let state = [seg('a', 'kept'), seg('b', 'kept')];
    const out = await uploadKept(() => state, async (s) => {
      if (s.id === 'a') throw new Error('Network down');
    }, (fn) => (state = fn(state)));
    expect(out.map((s) => [s.id, s.state, s.error])).toEqual([
      ['a', 'failed', 'Network down'],
      ['b', 'uploaded', undefined],
    ]);
  });

  it('a removed segment cannot be revived', () => {
    expect(() => applySegment([seg('x', 'removed')], 'x', 'keep')).toThrow();
    expect(() => applySegment([seg('x', 'removed')], 'x', 'beginUpload')).toThrow();
  });
});

describe('upload race (phase4 verdict r1, P1)', () => {
  it('a segment removed while another upload is in flight is never sent', async () => {
    let state: LocalSegment[] = [seg('A', 'kept'), seg('B', 'kept')];
    const get = () => state;
    const update = (fn: (l: LocalSegment[]) => LocalSegment[]) => {
      state = fn(state);
    };
    const sent: string[] = [];
    let releaseA: () => void = () => {};
    const run = uploadKept(get, async (s) => {
      sent.push(s.id);
      if (s.id === 'A') await new Promise<void>((r) => (releaseA = r));
    }, update);
    await Promise.resolve();
    // Tester removes B while A is uploading.
    update((l) => applySegment(l, 'B', 'remove'));
    releaseA();
    await run;
    expect(sent).toEqual(['A']);
    expect(state.find((s) => s.id === 'B')!.state).toBe('removed');
    expect(state.find((s) => s.id === 'A')!.state).toBe('uploaded');
  });
});

describe('leaving the screen (phase4 verdict r2, P3)', () => {
  it('stops uploading remaining items once cancelled', async () => {
    let state: LocalSegment[] = [seg('A', 'kept'), seg('B', 'kept')];
    let cancelled = false;
    const sent: string[] = [];
    await uploadKept(
      () => (cancelled ? [] : state),
      async (s) => {
        sent.push(s.id);
        cancelled = true; // tester navigates away during A
      },
      (fn) => (state = fn(state)),
    );
    expect(sent).toEqual(['A']);
  });
});

describe('removeSegment (phase4 verdict r2, P3)', () => {
  it('refuses to remove an item that is uploading and does not delete its file', () => {
    const deleted: string[] = [];
    const list = [seg('U', 'uploading'), seg('K', 'kept')];
    expect(removeSegment(list, 'U', (s) => deleted.push(s.id))).toBe(list);
    expect(deleted).toEqual([]);
    const after = removeSegment(list, 'K', (s) => deleted.push(s.id));
    expect(after.find((s) => s.id === 'K')!.state).toBe('removed');
    expect(deleted).toEqual(['K']);
  });
});
