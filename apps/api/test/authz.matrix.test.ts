import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildPath, routes, type RouteName } from '@pocket-qa/contracts';
import { DEVICE, makeApp, PNG, seeded, STUDY, type TestApp } from './helpers';

// Authorization matrix (plan Phase 3): every route × every role × owner / non-owner.
let t: TestApp;
type Who = { token: string; id: string };
let ids: Record<string, string>;
let users: Record<'builderA' | 'builderB' | 'testerA' | 'testerB' | 'admin', Who>;
let mediaToken: string;

beforeAll(async () => {
  t = await makeApp({ settlement: 'simulated' });
  const { builder, tester, study, participationId } = await seeded(t);
  const taskId = study.tasks[0].id;
  const ev = await t.upload(tester.token, participationId, PNG, { kind: 'screenshot', capturedOn: 'web', clientSegmentId: 'm1' });
  await t.req('POST', `/participations/${participationId}/submit`, tester.token);
  const finding = await t.req('POST', `/participations/${participationId}/findings`, builder.token, { title: 'OTP confusing', severity: 'major', description: 'Tester could not find the code.' });
  expect(finding.status).toBe(200);
  // A second tester whose rejected work is disputed, for dispute routes.
  const testerC = await t.register('tester');
  await t.req('PUT', '/me/device', testerC.token, DEVICE);
  const pc = (await t.req('POST', `/studies/${study.id}/consent`, testerC.token, { consentVersion: 1, accepted: true })).body;
  await t.req('POST', `/participations/${pc.id}/start`, testerC.token);
  await t.req('POST', `/participations/${pc.id}/submit`, testerC.token);
  await t.req('POST', `/participations/${pc.id}/reject`, builder.token, { reason: 'Did not attempt the tasks at all.' });
  const dispute = (await t.req('POST', '/disputes', testerC.token, { participationId: pc.id, reason: 'I did attempt them, see my notes.' })).body;

  const builderB = await t.register('builder');
  await t.req('POST', '/me/credits/test-topup', builderB.token, { amount: 1000 });
  await t.req('POST', '/studies', builderB.token, STUDY);
  const testerB = await t.register('tester');
  await t.req('PUT', '/me/device', testerB.token, DEVICE);
  const admin = await t.admin();

  // A transfer row for the transfer routes (wallet linking is covered in wallet.test.ts).
  t.db
    .prepare(
      `INSERT INTO devnet_transfers (id, participation_id, builder_id, tester_id, sender, recipient, lamports, status, created_at, expires_at)
       VALUES ('tr1', ?, ?, ?, '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV', '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin', 1000000, 'awaiting_signature', ?, ?)`,
    )
    .run(participationId, builder.id, tester.id, new Date(t.clock.now).toISOString(), new Date(t.clock.now + 600_000).toISOString());

  // A (simulated) escrow study of builder A with an open funding request, for the escrow routes.
  await t.linkWallet(builder.token);
  const { rewardCredits: _, ...rest } = STUDY;
  const escrowStudy = (await t.req('POST', '/studies', builder.token, { ...rest, payment: { mode: 'escrow', rewardUnits: 1_000_000 } })).body;
  const funding = (await t.req('POST', `/studies/${escrowStudy.id}/escrow/fundings`, builder.token)).body;
  expect(funding.status).toBe('awaiting_payment');

  mediaToken = (await t.req('POST', `/evidence/${ev.body.id}/playback-token`, tester.token)).body.token;
  ids = { study: study.id, participation: participationId, task: taskId, evidence: ev.body.id, dispute: dispute.id, transfer: 'tr1', user: testerB.id, funding: funding.id };
  users = { builderA: builder, builderB, testerA: tester, testerB, admin };
});
afterAll(async () => t.close());

function pathFor(name: RouteName): string {
  const p = routes[name].path;
  const id =
    p.startsWith('/studies') || p.startsWith('/tester/studies') || p.startsWith('/admin/moderation/studies')
      ? ids.study
      : p.startsWith('/participations')
        ? ids.participation
        : p.startsWith('/evidence')
          ? ids.evidence
          : p.startsWith('/admin/disputes')
            ? ids.dispute
            : p.startsWith('/devnet/transfers')
              ? ids.transfer
              : p.startsWith('/escrow/fundings')
                ? ids.funding
              : p.startsWith('/admin/moderation/users')
                ? ids.user
                : 'x';
  const params: Record<string, string> = p.includes(':token') ? { token: mediaToken } : p.includes(':taskId') ? { id: id!, taskId: ids.task! } : p.includes(':id') ? { id: id! } : {};
  return buildPath(p, params);
}

const names = Object.keys(routes) as RouteName[];
const ROLES = { tester: ['testerA'], builder: ['builderA'], admin: ['admin'] } as const;

describe('authentication', () => {
  for (const name of names.filter((n) => routes[n].auth !== 'public')) {
    it(`${name}: no session → 401`, async () => {
      const r = await t.req(routes[name].method, pathFor(name));
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('UNAUTHENTICATED');
    });
    it(`${name}: forged session → 401`, async () => {
      const r = await t.req(routes[name].method, pathFor(name), 'not-a-real-token-but-long-enough-xxxxxxxxxx');
      expect(r.status).toBe(401);
    });
  }
});

describe('role guard', () => {
  for (const name of names.filter((n) => ['tester', 'builder', 'admin'].includes(routes[n].auth))) {
    const allowed = routes[name].auth as keyof typeof ROLES;
    for (const role of (Object.keys(ROLES) as (keyof typeof ROLES)[]).filter((r) => r !== allowed)) {
      it(`${name}: ${role} → 403`, async () => {
        const who = users[ROLES[role][0]];
        const r = await t.req(routes[name].method, pathFor(name), who.token, {});
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('FORBIDDEN_ROLE');
      });
    }
  }
});

// Valid bodies so ownership (checked in the handler) is what decides the outcome.
const BODY: Partial<Record<RouteName, () => unknown>> = {
  updateStudy: () => ({ title: 'Renamed study' }),
  approve: () => ({}),
  reject: () => ({ reason: 'Not attempted at all, sorry.' }),
  createFinding: () => ({ title: 'Something', severity: 'minor', description: 'Details here.' }),
  putTaskNote: () => ({ note: 'x' }),
  withdrawParticipation: () => ({}),
  createTransfer: () => ({ participationId: ids.participation }),
  submitTransferSignature: () => ({ signature: '5'.repeat(88) }),
  openDispute: () => ({ participationId: ids.participation, reason: 'This is my dispute reason.' }),
  createUploadIntent: () => ({ kind: 'screenshot', mimeType: 'image/png', sizeBytes: 100, capturedOn: 'web', clientSegmentId: 'm-1' }),
  submitFundingSignature: () => ({ signature: `sim${'a'.repeat(24)}` }),
};

const OWNER_SCOPED: { name: RouteName; nonOwners: (keyof typeof users)[] }[] = [
  ...(['getStudy', 'updateStudy', 'publishStudy', 'pauseStudy', 'resumeStudy', 'closeStudy', 'studyParticipations', 'studyDisputes', 'createFinding', 'approve', 'reject', 'createTransfer', 'submitTransferSignature', 'transferBlockhash', 'createEscrowFunding', 'getEscrowFunding', 'simulatedWalletPayment', 'submitFundingSignature'] as RouteName[]).map(
    (name) => ({ name, nonOwners: ['builderB'] as (keyof typeof users)[] }),
  ),
  ...(['startParticipation', 'withdrawParticipation', 'putTaskNote', 'submitParticipation', 'uploadEvidence', 'openDispute', 'createUploadIntent', 'completeUploadIntent'] as RouteName[]).map((name) => ({
    name,
    nonOwners: ['testerB'] as (keyof typeof users)[],
  })),
  ...(['getParticipation', 'listEvidence', 'playbackToken', 'listFindings', 'getTransfer', 'participationTransfers'] as RouteName[]).map((name) => ({
    name,
    nonOwners: ['testerB', 'builderB'] as (keyof typeof users)[],
  })),
];

describe('ownership: non-owners get 404, never 403 or data', () => {
  it('covers every owner-scoped route in the contract', () => {
    const scoped = names.filter((n) => ['study-owner', 'tester-owner', 'participation-party'].includes(routes[n].scope) && routes[n].path.includes(':'));
    const covered = new Set(OWNER_SCOPED.map((o) => o.name));
    // openDispute / createTransfer carry the participation in the body instead of the path.
    expect(scoped.filter((n) => !covered.has(n))).toEqual([]);
  });

  for (const { name, nonOwners } of OWNER_SCOPED) {
    for (const who of nonOwners) {
      it(`${name}: ${who} → 404`, async () => {
        const r = await t.req(routes[name].method, pathFor(name), users[who].token, BODY[name]?.() ?? {});
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('NOT_FOUND');
      });
    }
  }

  it('admin may read participation evidence for disputes', async () => {
    expect((await t.req('GET', pathFor('listEvidence'), users.admin.token)).status).toBe(200);
    expect((await t.req('POST', pathFor('playbackToken'), users.admin.token)).status).toBe(200);
  });

  it('list endpoints only return the caller’s own rows', async () => {
    const b = (await t.req('GET', '/studies', users.builderB.token)).body.items;
    expect(b.every((s: { builderId: string }) => s.builderId === users.builderB.id)).toBe(true);
    expect((await t.req('GET', '/participations', users.testerB.token)).body.items).toEqual([]);
    expect((await t.req('GET', '/disputes', users.testerA.token)).body.items).toEqual([]);
  });

  it('suspended accounts are locked out except me/logout/export/delete', async () => {
    const victim = await t.register('tester');
    await t.req('POST', `/admin/moderation/users/${victim.id}`, users.admin.token, { action: 'suspend', reason: 'Spam submissions' });
    expect((await t.req('GET', '/studies/eligible', victim.token)).status).toBe(403);
    expect((await t.req('GET', '/me', victim.token)).body.status).toBe('suspended');
    expect((await t.req('POST', '/me/export', victim.token)).status).toBe(200);
  });
});
