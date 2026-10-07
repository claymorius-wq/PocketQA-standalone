import { afterEach, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers';

// Study ia2ed9db (verified cause): the reporting tester's profile was saved from the web as Android
// with androidApiLevel null, so checkEligibility says "Needs Android API 29 or newer." and every
// Android study with a minimum API is hidden. PUT /me/device now requires the API level (an integer
// 1..99) when the platform is android; other platforms keep null. checkEligibility and profiles
// already stored are unchanged.
let t: TestApp;
afterEach(async () => t?.close());
const ANDROID = { platform: 'android', osVersion: '14', androidApiLevel: 34, model: 'Pixel 8', languages: ['en'] };

describe('PUT /me/device: the Android API level is required for android', () => {
  it.each([
    ['null (as the web form saved it)', null],
    ['0', 0],
    ['100', 100],
    ['a fraction', 34.5],
  ])('android with API level %s → 400 VALIDATION, nothing saved', async (_n, level) => {
    t = await makeApp();
    const u = await t.register('tester');
    const r = await t.req('PUT', '/me/device', u.token, { ...ANDROID, androidApiLevel: level });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('VALIDATION');
    expect(r.body.message).toMatch(/androidApiLevel/);
    expect((await t.req('GET', '/me', u.token)).body.device).toBeNull();
  });

  it('android with API level 34 (and the bounds 1 and 99) is saved', async () => {
    t = await makeApp();
    const u = await t.register('tester');
    for (const level of [34, 1, 99]) expect((await t.req('PUT', '/me/device', u.token, { ...ANDROID, androidApiLevel: level })).status).toBe(200);
    expect((await t.req('GET', '/me', u.token)).body.device.androidApiLevel).toBe(99);
  });

  it.each(['web', 'ios'])('%s keeps a null API level', async (platform) => {
    t = await makeApp();
    const u = await t.register('tester');
    expect((await t.req('PUT', '/me/device', u.token, { ...ANDROID, platform, androidApiLevel: null })).status).toBe(200);
  });

  it('a profile ALREADY stored as android + null is still read as-is and still hidden by the unchanged eligibility rule', async () => {
    t = await makeApp();
    const b = await t.register('builder');
    await t.req('POST', '/me/credits/test-topup', b.token, { amount: 1000 });
    const s = (await t.req('POST', '/studies', b.token, { title: 'Android check', objective: 'Find where users get stuck.', tasks: [{ instruction: 'Open the app' }], deviceCriteria: { platforms: ['android'], minAndroidApi: 29, languages: ['en'] }, rewardCredits: 50, slots: 5, consentText: 'I agree to record my screen only while doing these tasks, and to review clips before upload.' })).body;
    await t.req('POST', `/studies/${s.id}/publish`, b.token);
    const u = await t.register('tester');
    const stored = { platform: 'android', osVersion: 'Browser', androidApiLevel: null, model: 'Web preview', languages: ['en'] };
    t.db.prepare('UPDATE users SET device_json = ? WHERE id = ?').run(JSON.stringify(stored), u.id);
    const me = await t.req('GET', '/me', u.token);
    expect(me.status).toBe(200);
    expect(me.body.device).toEqual(stored);
    expect(((await t.req('GET', '/studies/eligible', u.token)).body.items as { id: string }[]).map((x) => x.id)).not.toContain(s.id);
  });
});
