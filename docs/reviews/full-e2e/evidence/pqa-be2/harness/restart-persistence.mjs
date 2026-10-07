// E-xx persistence across API restart (local-api, SQLite). pqa-be2, full E2E 2026-10-06.
// Usage: node restart-persistence.mjs seed|read <baseUrl> <stateFile>
// `seed` creates a synthetic builder + tester, tops up, creates/publishes a study, tester consents,
// then writes the tokens/ids and a JSON snapshot of every read model to <stateFile>.
// `read` (after the API was killed and restarted) re-reads the same views with the SAME tokens and
// prints a field-by-field comparison. Synthetic data only; scratch data dir; never port 8787.
import { readFileSync, writeFileSync } from 'node:fs';

const [, , mode, base, stateFile] = process.argv;
const call = async (method, path, token, body) => {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
};
const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
};

async function snapshot(s) {
  const builderMe = must(await call('GET', '/me', s.builderToken), 'builder me');
  const testerMe = must(await call('GET', '/me', s.testerToken), 'tester me');
  const builderCredits = must(await call('GET', '/me/credits', s.builderToken), 'builder credits');
  const study = must(await call('GET', `/studies/${s.studyId}`, s.builderToken), 'study');
  const parts = must(await call('GET', `/studies/${s.studyId}/participations`, s.builderToken), 'participations').items;
  const myParts = must(await call('GET', '/participations', s.testerToken), 'tester participations').items;
  return {
    builder: { id: builderMe.id, role: builderMe.role, email: builderMe.email },
    tester: { id: testerMe.id, role: testerMe.role, device: testerMe.device ?? null },
    builderCredits,
    study: { id: study.id, status: study.status, slots: study.slots, rewardCredits: study.rewardCredits, budget: study.budget, tasks: study.tasks?.length },
    participations: parts.map((p) => ({ id: p.id, status: p.status, testerId: p.testerId })),
    testerParticipations: myParts.map((p) => ({ id: p.id, status: p.status })),
  };
}

if (mode === 'seed') {
  const tag = Date.now().toString(36);
  const pw = `QA-synthetic-${tag}-pw!`;
  const b = must(await call('POST', '/auth/register', null, { email: `pqa-e2e-builder-${tag}@example.test`, password: pw, displayName: 'QA synthetic builder', role: 'builder' }), 'register builder');
  const t = must(await call('POST', '/auth/register', null, { email: `pqa-e2e-tester-${tag}@example.test`, password: pw, displayName: 'QA synthetic tester', role: 'tester' }), 'register tester');
  // Admin self-promotion attempt through the only role-writing route (expected 400).
  const adminTry = await call('POST', '/auth/register', null, { email: `pqa-e2e-admin-${tag}@example.test`, password: pw, displayName: 'QA synthetic admin try', role: 'admin' });
  must(await call('PUT', '/me/device', t.token, { platform: 'android', osVersion: '15', androidApiLevel: 35, model: 'QA synthetic device', languages: ['en'] }), 'device');
  must(await call('POST', '/me/credits/test-topup', b.token, { amount: 500 }), 'topup');
  const study = must(await call('POST', '/studies', b.token, {
    title: 'QA synthetic restart study', objective: 'Persistence across API restart (synthetic).',
    tasks: [{ instruction: 'Open the app home' }], deviceCriteria: { platforms: ['android', 'web'], minAndroidApi: null, languages: ['en'] },
    rewardCredits: 40, slots: 3, consentText: 'I agree to this synthetic QA study recording.',
  }), 'create study');
  must(await call('POST', `/studies/${study.id}/publish`, b.token), 'publish');
  const tv = must(await call('GET', `/tester/studies/${study.id}`, t.token), 'tester study');
  must(await call('POST', `/studies/${study.id}/consent`, t.token, { consentVersion: tv.consentVersion ?? 1, accepted: true }), 'consent');
  const s = { builderToken: b.token, testerToken: t.token, studyId: study.id, adminSelfRegister: { status: adminTry.status, code: adminTry.json?.error?.code ?? adminTry.json?.code ?? null } };
  s.before = await snapshot(s);
  writeFileSync(stateFile, JSON.stringify(s, null, 2));
  console.log(JSON.stringify({ seeded: true, studyId: s.studyId, adminSelfRegister: s.adminSelfRegister, before: s.before }, null, 2));
} else if (mode === 'read') {
  const s = JSON.parse(readFileSync(stateFile, 'utf8'));
  const after = await snapshot(s);
  const a = JSON.stringify(s.before), b2 = JSON.stringify(after);
  console.log(JSON.stringify({ identical: a === b2, after }, null, 2));
  if (a !== b2) { console.log('BEFORE', a); console.log('AFTER ', b2); process.exit(2); }
} else {
  console.error('mode must be seed or read');
  process.exit(64);
}
