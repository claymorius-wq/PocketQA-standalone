// pqa-be2 E-08 on the SQLite backend (the local/USB API's repository). No emulator. Scratch DB
// file under $E08_DB_DIR (a scratchpad), never the live USB database. Synthetic data only.
// Run (from apps/api): ../../node_modules/.bin/vitest run --config ../../docs/reviews/full-e2e/evidence/pqa-be2/harness/vitest.races.config.ts e08.sqlite
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { openDb } from '../../../../../../apps/api/src/db';
import { makeRepos } from '../../../../../../apps/api/src/repo';
import { newId } from '../../../../../../apps/api/src/util';
import type { UserRow } from '../../../../../../apps/api/src/views/core';

const dir = mkdtempSync(join(process.env.E08_DB_DIR ?? '/nonexistent-set-E08_DB_DIR', 'e08-'));
const db = openDb(join(dir, 'e08.sqlite'));
const { core, studies: repo } = makeRepos({ kind: 'sqlite', db });
afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});
const T0 = Date.parse('2026-10-06T10:00:00.000Z');
const WINDOW = 7 * 24 * 3600 * 1000;
const device = JSON.stringify({ platform: 'android', androidApiLevel: 35, languages: ['en'] });
const obs = (id: string, o: unknown) => process.stdout.write(`[E-OBS ${id}] ${JSON.stringify(o)}\n`);
async function user(role: UserRow['role']) {
  const id = `pqa-e2e-${role}-${newId().slice(0, 8)}`;
  const u: UserRow = { id, email: `${id}@example.test`, password_hash: null, display_name: `QA synthetic ${role}`, role, status: 'active', device_json: device, created_at: '2026-10-06T00:00:00.000Z' };
  expect(await core.createUser(u)).toBe('created');
  return u;
}

it('SQLite: close after the window, then a dispute timed just before it, then an overturn', async () => {
  const b = await user('builder');
  const admin = await user('admin');
  const t = await user('tester');
  await repo.topUp(b.id, 40, T0);
  const sid = newId();
  await repo.createStudy({ id: sid, builderId: b.id, title: 'QA synthetic E-08 study', objective: 'Boundary race proof (synthetic)', buildUnderTest: null, deviceCriteriaJson: JSON.stringify({ platforms: ['android', 'web'], minAndroidApi: null, languages: ['en'] }), rewardCredits: 20, slots: 2, consentText: 'I agree to this synthetic QA study recording.', tasks: [{ instruction: 'Open the app' }], taskIds: [], createdAt: '2026-10-06T09:00:00.000Z', escrow: null });
  await repo.studyTransition(sid, b, 'publish', false, T0);
  const p = await repo.consent({ studyId: sid, tester: t, consentVersion: 1, settlementEnabled: false, id: newId(), nowMs: T0 });
  await repo.testerTransition(p.id, t, 'start', null, T0);
  await repo.testerTransition(p.id, t, 'submit', null, T0);
  await repo.decideParticipation(p.id, { by: 'builder', actor: b, decision: 'reject', reason: 'QA synthetic rejection reason', helpful: false }, T0);
  await repo.studyTransition(sid, b, 'close', false, T0 + WINDOW + 1);
  const afterClose = { study: (await repo.getStudy(sid))!.status, studyAcct: await repo.accountBalance(`study:${sid}`), builder: await repo.accountBalance(`user:${b.id}`) };
  const dispute = await repo.openDispute(p.id, t, 'QA synthetic dispute reason', newId(), T0 + WINDOW - 1).then((d) => ({ ok: true as const, d }), (e) => ({ ok: false as const, code: String((e as { code?: string }).code ?? (e as Error).message) }));
  let overturn = 'not attempted';
  if (dispute.ok) overturn = await repo.resolveDispute(dispute.d.id, admin, 'overturned', 'QA synthetic overturn', T0 + WINDOW + 10).then(() => 'ok', (e) => `${(e as { code?: string }).code ?? ''} ${(e as Error).message}`.trim());
  const after = { studyAcct: await repo.accountBalance(`study:${sid}`), builder: await repo.accountBalance(`user:${b.id}`), tester: await repo.accountBalance(`user:${t.id}`) };
  const studyView = await repo.getStudy(sid).then(() => 'row ok');
  obs('E-08/sqlite', { afterClose, disputeOnClosedStudy: dispute.ok ? 'opened' : dispute.code, overturn, after, minted: after.builder + after.tester - 40, studyView });
  expect(after.builder + after.tester).toBeLessThanOrEqual(40);
});
