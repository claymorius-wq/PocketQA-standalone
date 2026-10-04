import type { DB } from './db';
import { iso, newId } from './util';

/** Audit actor for operator actions run on the host CLI (never a user id, never via HTTP). */
export const CLI_ACTOR_ID = 'host-cli';

export class GrantError extends Error {}

/**
 * Production admin provisioning (ledger I7). There is no HTTP route and no seeded identity:
 * an operator on the host promotes an existing account that signed in with a verified
 * managed identity (email or Google). The account must be dedicated to administration
 * (no studies, participations or wallet link), because admins never sign in by wallet and
 * a role change must not orphan someone's work. Atomic, and audited with the reason.
 */
export function grantAdmin(db: DB, input: { email: string; reason: string; operator: string; now: number }): { userId: string } {
  const reason = input.reason.trim();
  if (reason.length < 10) throw new GrantError('Give a reason of at least 10 characters (it is kept in the audit log).');
  return db.transaction(() => {
    const user = db.prepare('SELECT id, role, status FROM users WHERE email = ?').get(input.email.toLowerCase()) as { id: string; role: string; status: string } | undefined;
    if (!user || user.status === 'deleted') throw new GrantError('No account with that email. The person must first sign up and verify their email in the app.');
    if (user.status !== 'active') throw new GrantError('That account is suspended.');
    if (user.role === 'admin') throw new GrantError('That account is already an admin.');
    const verified = db.prepare(`SELECT 1 FROM identities WHERE provider = 'firebase' AND user_id = ? AND has_recovery = 1`).get(user.id);
    if (!verified) throw new GrantError('That account has no verified email or Google sign-in. Admins sign in only with a verified managed identity.');
    if (db.prepare('SELECT 1 FROM wallet_links WHERE user_id = ?').get(user.id)) throw new GrantError('That account has a linked wallet. Use a dedicated account without a wallet for administration.');
    const busy =
      db.prepare('SELECT 1 FROM studies WHERE builder_id = ? LIMIT 1').get(user.id) ?? db.prepare('SELECT 1 FROM participations WHERE tester_id = ? LIMIT 1').get(user.id);
    if (busy) throw new GrantError('That account has studies or test sessions. Use a dedicated account for administration.');
    db.prepare(`UPDATE users SET role = 'admin' WHERE id = ?`).run(user.id);
    db.prepare('INSERT INTO audit (id, actor_id, action, target_type, target_id, reason, created_at) VALUES (?,?,?,?,?,?,?)').run(
      newId(),
      CLI_ACTOR_ID,
      'user.admin_granted',
      'user',
      user.id,
      `${reason} (admin:grant by host operator ${input.operator})`,
      iso(input.now),
    );
    return { userId: user.id };
  })();
}
