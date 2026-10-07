import { CLI_ACTOR_ID, GrantError } from '../adminGrant';
import type { Repos } from '../repo';
import { iso, newId } from '../util';
import { assertSyntheticDevnetEmail } from './syntheticIdentity';

/**
 * A synthetic admin for POCKETQA_ENV=devnet (the dispute overturn needs one; devnet-live-run.md §4),
 * granted by an operator on the host, never over HTTP. The production rules of admin:grant hold
 * (verified managed identity, an account dedicated to administration, a reason, audited) and on top:
 * ONLY the devnet namespace (it refuses root, i.e. production, repositories) and ONLY an allow-listed
 * synthetic @example.test account.
 */
export async function grantDevnetAdmin(repos: Repos, input: { email: string; reason: string; operator: string; nowMs: number; allowedEmails: readonly string[] }): Promise<{ userId: string }> {
  if (repos.namespace !== 'devnet') throw new GrantError('The devnet admin grant runs only on the devnet namespace (never the production collections).');
  let email: string;
  try {
    email = assertSyntheticDevnetEmail(input.email, input.allowedEmails);
  } catch (e) {
    throw new GrantError((e as Error).message);
  }
  const reason = input.reason.trim();
  if (reason.length < 10) throw new GrantError('Give a reason of at least 10 characters (it is kept in the audit log).');
  const user = await repos.core.activeUserByEmail(email);
  if (!user) throw new GrantError('No account with that email in the devnet namespace. Sign it up in the devnet app and verify it first.');
  if (user.status !== 'active') throw new GrantError('That account is suspended.');
  if (user.role === 'admin') throw new GrantError('That account is already an admin.');
  if (!(await repos.core.hasRecoverableIdentity(user.id))) throw new GrantError('That account has no verified email sign-in. Verify it first (scripts/devnet-verify-synthetic.ts).');
  if (await repos.escrow.walletLinkOf(user.id)) throw new GrantError('That account has a linked wallet. Use a dedicated account without a wallet for administration.');
  if ((await repos.studies.listStudiesByBuilder(user.id)).length || (await repos.studies.listParticipationsByTester(user.id)).length) {
    throw new GrantError('That account has studies or test sessions. Use a dedicated account for administration.');
  }
  await repos.core.setRole(user.id, 'admin');
  await repos.core.appendAudit({ id: newId(), actor_id: CLI_ACTOR_ID, action: 'user.admin_granted', target_type: 'user', target_id: user.id, reason: `${reason} (devnet admin grant by host operator ${input.operator})`, created_at: iso(input.nowMs) });
  return { userId: user.id };
}
