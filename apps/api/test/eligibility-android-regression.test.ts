import { afterEach, describe, expect, it } from 'vitest';
import { makeApp, type TestApp } from './helpers';

// Regression probe for study ia2ed9db… (user report): a tester whose profile was explicitly saved as
// Android does not see an Android study created in Chrome. The study below is exactly what the New
// Study form sends with its defaults (platforms ['android'], minAndroidApi 29, languages ['en']).
// Each case pins one filter of GET /studies/eligible, so the real cause shows up as the one case
// whose expectation the production data contradicts.
let t: TestApp;
afterEach(async () => t?.close());

const CHROME_DEFAULTS = {
  title: 'Android onboarding check',
  objective: 'Find where first-time users get stuck on Android.',
  tasks: [{ instruction: 'Open the app and reach the home screen' }],
  deviceCriteria: { platforms: ['android'], minAndroidApi: 29, languages: ['en'] },
  rewardCredits: 50,
  slots: 5,
  consentText: 'I agree to record my screen only while doing these tasks, and to review clips before upload.',
};
const ANDROID_34 = { platform: 'android', osVersion: '14', androidApiLevel: 34, model: 'Pixel 8', languages: ['en-US'] };

async function publishedAndroidStudy(body: Record<string, unknown> = CHROME_DEFAULTS) {
  const b = await t.register('builder');
  await t.req('POST', '/me/credits/test-topup', b.token, { amount: 1000 });
  const s = (await t.req('POST', '/studies', b.token, body)).body;
  expect((await t.req('POST', `/studies/${s.id}/publish`, b.token)).status).toBe(200);
  return { b, s };
}
async function testerWith(device: Record<string, unknown>) {
  const tt = await t.register('tester');
  expect((await t.req('PUT', '/me/device', tt.token, device)).status).toBe(200);
  return tt;
}
const eligibleIds = async (token: string) => ((await t.req('GET', '/studies/eligible', token)).body.items as { id: string }[]).map((x) => x.id);

describe('GET /studies/eligible: an Android study made with the New Study defaults', () => {
  it('a correctly saved Android profile (API 34, en-US) SEES it', async () => {
    t = await makeApp();
    const { s } = await publishedAndroidStudy();
    const tt = await testerWith(ANDROID_34);
    expect(await eligibleIds(tt.token)).toContain(s.id);
  });

  it('an Android profile saved with the API field blank (null, as the web form allows) does NOT see it', async () => {
    t = await makeApp();
    const { s } = await publishedAndroidStudy();
    const tt = await testerWith({ ...ANDROID_34, androidApiLevel: null });
    expect(await eligibleIds(tt.token)).not.toContain(s.id);
  });

  it('an Android profile below the minimum (API 28) does NOT see it', async () => {
    t = await makeApp();
    const { s } = await publishedAndroidStudy();
    const tt = await testerWith({ ...ANDROID_34, androidApiLevel: 28 });
    expect(await eligibleIds(tt.token)).not.toContain(s.id);
  });

  it('an Android profile with no matching language (es only) does NOT see it', async () => {
    t = await makeApp();
    const { s } = await publishedAndroidStudy();
    const tt = await testerWith({ ...ANDROID_34, languages: ['es'] });
    expect(await eligibleIds(tt.token)).not.toContain(s.id);
  });

  it('a tester who once joined and withdrew never sees it again', async () => {
    t = await makeApp();
    const { s } = await publishedAndroidStudy();
    const tt = await testerWith(ANDROID_34);
    const p = (await t.req('POST', `/studies/${s.id}/consent`, tt.token, { consentVersion: 1, accepted: true })).body;
    expect((await t.req('POST', `/participations/${p.id}/withdraw`, tt.token, { reason: 'Changed my mind about this one.' })).status).toBe(200);
    expect(await eligibleIds(tt.token)).not.toContain(s.id);
  });

  it('a draft (unpublished) study is never listed', async () => {
    t = await makeApp();
    const b = await t.register('builder');
    const s = (await t.req('POST', '/studies', b.token, CHROME_DEFAULTS)).body;
    const tt = await testerWith(ANDROID_34);
    expect(await eligibleIds(tt.token)).not.toContain(s.id);
  });

  it('a token-reward (escrow, simulated) study is listed to a correct Android profile with NO linked wallet', async () => {
    t = await makeApp({ settlement: 'simulated' });
    const b = await t.register('builder');
    await t.linkWallet(b.token); // the builder funds from a linked wallet; the TESTER has none
    const { rewardCredits: _r, ...rest } = CHROME_DEFAULTS;
    const s = (await t.req('POST', '/studies', b.token, { ...rest, payment: { mode: 'escrow', rewardUnits: 1_000_000 } })).body;
    const f = (await t.req('POST', `/studies/${s.id}/escrow/fundings`, b.token)).body;
    const paid = (await t.req('POST', `/escrow/fundings/${f.id}/simulated-wallet-payment`, b.token)).body;
    await t.req('POST', `/escrow/fundings/${f.id}/signature`, b.token, { signature: paid.signature });
    expect((await t.req('POST', `/studies/${s.id}/publish`, b.token)).status).toBe(200);
    const tt = await testerWith(ANDROID_34);
    expect(await eligibleIds(tt.token)).toContain(s.id);
  });
});
