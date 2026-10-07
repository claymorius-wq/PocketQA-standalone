/**
 * pqa-qa: READ-ONLY Firestore integrity check (parent-authorised, scoped). It never writes.
 * Prints counts plus offending document IDS only (no emails, names, notes or amounts per user).
 *
 * Run from apps/api (so imports resolve):
 *   npx tsx <path>/qa-integrity-check.ts --project <projectId>
 *   (emulator: FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> with a demo- project)
 * Credentials for the real project come from the server-only env the API already uses
 * (FIREBASE_SERVICE_ACCOUNT_JSON); the script never prints them.
 */
import { openFirestore } from '../../../apps/api/src/firestore/admin';

const project = process.argv[process.argv.indexOf('--project') + 1];
if (!project || project.startsWith('--')) throw new Error('usage: --project <id>');
const fs = openFirestore(process.env, project);
const all = async (c: string) => (await fs.collection(c).get()).docs; // reads only

const studies = await all('studies');
const parts = await all('participations');
const disputes = await all('disputes');
const accounts = await all('accounts');
const ledger = await all('ledger');
const rewards = await all('ledgerRewards');
const escrow = await all('escrowLedger');

const studyStatus = new Map(studies.map((d) => [d.id, String(d.get('status'))]));
const findings: Record<string, string[]> = {};
const flag = (k: string, id: string) => ((findings[k] ??= []).push(id));

// 1. Disputes on closed studies (E-08 class).
for (const p of parts) if (p.get('status') === 'disputed' && studyStatus.get(String(p.get('study_id'))) === 'closed') flag('disputed participation on a closed study', p.id);
for (const d of disputes) {
  const pid = d.id;
  const p = parts.find((x) => x.id === pid || x.get('id') === pid);
  const sid = p ? String(p.get('study_id')) : null;
  if (d.get('status') === 'open' && sid && studyStatus.get(sid) === 'closed') flag('open dispute on a closed study', pid);
}

// 2. Ledger: integer amounts, each transaction balanced, running totals equal the postings.
const sumBy = new Map<string, number>();
const txSum = new Map<string, number>();
for (const e of ledger) {
  const a = Number(e.get('amount'));
  if (!Number.isInteger(a)) flag('non-integer ledger amount', e.id);
  sumBy.set(String(e.get('account')), (sumBy.get(String(e.get('account'))) ?? 0) + a);
  txSum.set(String(e.get('tx_id')), (txSum.get(String(e.get('tx_id'))) ?? 0) + a);
}
for (const [tx, s] of txSum) if (s !== 0) flag('unbalanced ledger transaction', tx);
for (const a of accounts) {
  const bal = Number(a.get('balance'));
  if ((sumBy.get(a.id) ?? 0) !== bal) flag('account total differs from its postings', a.id);
  if ((a.id.startsWith('study:') || a.id.startsWith('user:')) && bal < 0) flag('negative study/user balance', a.id);
  if (a.id.startsWith('study:') && studyStatus.get(a.id.slice(6)) === 'closed' && bal !== 0) flag('closed study with a non-zero budget', a.id);
}
// The faucet deliberately has no totals doc (repo/studies/firestore.ts:67); every other account must.
for (const acct of sumBy.keys()) if (acct !== 'system:test-faucet' && !accounts.some((a) => a.id === acct)) flag('postings without an account total', acct);

// 3. One reward per participation and kind: guards equal positive reward/dispute credits.
const credits = ledger.filter((e) => ['reward_credit', 'dispute_credit'].includes(String(e.get('kind'))) && Number(e.get('amount')) > 0);
const creditKeys = new Map<string, number>();
for (const e of credits) { const k = `${e.get('participation_id')}:${e.get('kind')}`; creditKeys.set(k, (creditKeys.get(k) ?? 0) + 1); }
for (const [k, n] of creditKeys) if (n > 1) flag('more than one reward credit for a participation/kind', k);
for (const g of rewards) if (!creditKeys.has(g.id)) flag('reward guard without its credit', g.id);
for (const k of creditKeys.keys()) if (!rewards.some((g) => g.id === k)) flag('reward credit without its guard', k);

// 4. Escrow: integer postings; no vault below zero.
const vault = new Map<string, number>();
for (const e of escrow) {
  const a = Number(e.get('amount'));
  if (!Number.isInteger(a)) flag('non-integer escrow amount', e.id);
  const acct = String(e.get('account'));
  if (acct.startsWith('vault:')) vault.set(acct, (vault.get(acct) ?? 0) + a);
}
for (const [v, s] of vault) if (s < 0) flag('negative escrow vault', v);

console.log(JSON.stringify({
  project, readAt: new Date().toISOString(), readOnly: true,
  counts: { studies: studies.length, closedStudies: [...studyStatus.values()].filter((s) => s === 'closed').length, participations: parts.length, disputedParticipations: parts.filter((p) => p.get('status') === 'disputed').length, disputes: disputes.length, accounts: accounts.length, ledgerEntries: ledger.length, ledgerTx: txSum.size, rewardGuards: rewards.length, escrowPostings: escrow.length },
  violations: Object.fromEntries(Object.entries(findings).map(([k, v]) => [k, { count: v.length, ids: v.slice(0, 50) }])),
  ok: Object.keys(findings).length === 0,
}, null, 2));
process.exit(0);
