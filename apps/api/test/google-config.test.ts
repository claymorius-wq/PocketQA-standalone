import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { makeApp, type TestApp } from './helpers';

// Hamza's hosted Google report: the web app offers "Continue with Google" only when the deployment
// says the provider is enabled (POCKETQA_FIREBASE_GOOGLE=1), never as a dead button.
const fb = { POCKETQA_AUTH_MODE: 'firebase', POCKETQA_FIREBASE_PROJECT_ID: 'demo-pocketqa', POCKETQA_FIREBASE_WEB_API_KEY: 'k' }; // check-secrets: allow (placeholder public Firebase web config)
let t: TestApp;
afterEach(async () => {
  await t?.app.close();
});

describe('Google sign-in flag', () => {
  it('is off unless POCKETQA_FIREBASE_GOOGLE=1', () => {
    expect(loadConfig(fb).firebase?.googleSignIn).toBe(false);
    expect(loadConfig({ ...fb, POCKETQA_FIREBASE_GOOGLE: 'true' }).firebase?.googleSignIn).toBe(false);
    expect(loadConfig({ ...fb, POCKETQA_FIREBASE_GOOGLE: '1' }).firebase?.googleSignIn).toBe(true);
  });

  it('/config serves it', async () => {
    t = await makeApp({ authMode: 'firebase' });
    expect((await t.req('GET', '/config')).body.firebase.googleSignIn).toBe(false);
    t.deps.config.firebase!.googleSignIn = true;
    expect((await t.req('GET', '/config')).body.firebase.googleSignIn).toBe(true);
  });
});
