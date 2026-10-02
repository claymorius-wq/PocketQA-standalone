// Seeds a builder, a funded published Android+web study and a tester through the real
// local API, and prints `KEY=value` lines for `maestro test -e ...`. Local only.
const API = process.env.API ?? 'http://127.0.0.1:8787';
const run = Date.now().toString(36);
const pw = `pqa-${run}-${Math.random().toString(36).slice(2)}`; // check-secrets: allow (generated per run)

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

const b = await call('POST', '/auth/register', null, { email: `builder-${run}@example.test`, password: pw, displayName: 'Bea Builder', role: 'builder' });
await call('POST', '/me/credits/test-topup', b.token, { amount: 1000 });
const s = await call('POST', '/studies', b.token, {
  title: `Native recording ${run}`,
  objective: 'Record yourself trying the onboarding flow on a real Android device.',
  tasks: [{ instruction: 'Open the app and try to reach the home screen' }],
  deviceCriteria: { platforms: ['android', 'web'], minAndroidApi: 29, languages: ['en'] },
  rewardCredits: 50,
  slots: 3,
  consentText: 'I agree to record my screen only while doing these tasks, and to review clips before upload.',
});
await call('POST', `/studies/${s.id}/publish`, b.token);
const t = await call('POST', '/auth/register', null, { email: `tester-${run}@example.test`, password: pw, displayName: 'Tara Tester', role: 'tester' });
await call('PUT', '/me/device', t.token, { platform: 'android', osVersion: '16', androidApiLevel: 36, model: 'Android emulator', languages: ['en'] });
console.log(`EMAIL=${t.user.email}`);
console.log(`PASSWORD=${pw}`); // check-secrets: allow (throwaway local test account)
console.log(`STUDY="${s.title}"`);
