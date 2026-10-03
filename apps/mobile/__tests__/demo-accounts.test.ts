import { loadDemoAccounts, parseBootstrap } from '../src/preview/demoAccounts';

// Preview convenience: only synthetic demo sign-ins, only when the preview build asks.
const good = {
  demoAccounts: [
    { role: 'admin', email: 'demo-admin@pocketqa.example', password: 'a'.repeat(24) },
    { role: 'tester', email: 'demo-tester@pocketqa.example', password: 'b'.repeat(24) },
    { role: 'builder', email: 'demo-builder@pocketqa.example', password: 'c'.repeat(24) },
  ],
};

describe('parseBootstrap', () => {
  it('keeps the three synthetic accounts in tester, builder, admin order', () => {
    expect(parseBootstrap(good).map((a) => a.role)).toEqual(['tester', 'builder', 'admin']);
  });

  it('drops anything that is not a seeded synthetic account', () => {
    const bad = {
      demoAccounts: [
        { role: 'tester', email: 'real.person@gmail.com', password: 'x'.repeat(24) },
        { role: 'admin', email: 'demo-tester@pocketqa.example', password: 'x'.repeat(24) },
        { role: 'owner', email: 'demo-owner@pocketqa.example', password: 'x'.repeat(24) },
        { role: 'builder', email: 'demo-builder@pocketqa.example', password: 'short' },
        { role: 'tester', email: 'demo-tester@pocketqa.example', password: 42 },
      ],
    };
    expect(parseBootstrap(bad)).toEqual([]);
    expect(parseBootstrap(null)).toEqual([]);
    expect(parseBootstrap({ demoAccounts: 'x' })).toEqual([]);
  });
});

describe('loadDemoAccounts', () => {
  it('never fetches outside the preview build', async () => {
    const fetchImpl = jest.fn();
    expect(await loadDemoAccounts({ enabled: false, fetchImpl: fetchImpl as unknown as typeof fetch })).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('reads the same-origin bootstrap after the gate, and fails closed', async () => {
    const ok = jest.fn(async () => new Response(JSON.stringify(good), { headers: { 'content-type': 'application/json' } }));
    expect((await loadDemoAccounts({ enabled: true, fetchImpl: ok as unknown as typeof fetch })).length).toBe(3);
    expect((ok.mock.calls[0] as unknown[])[0]).toBe('/__preview/bootstrap.json');
    const html = jest.fn(async () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }));
    expect(await loadDemoAccounts({ enabled: true, fetchImpl: html as unknown as typeof fetch })).toEqual([]);
    const down = jest.fn(async () => {
      throw new Error('offline');
    });
    expect(await loadDemoAccounts({ enabled: true, fetchImpl: down as unknown as typeof fetch })).toEqual([]);
  });
});
