/**
 * Synthetic devnet identities (devnet-live-run.md §4). Firebase Auth users are project-global
 * (pqa-be3-interfaces.md §8), so the devnet journey uses ONLY labelled synthetic @example.test
 * accounts, the same list that gates server-signed operations. An operator verifies such an account's
 * email with an Admin SDK link; any other address is refused before Firebase is contacted.
 */
export function assertSyntheticDevnetEmail(email: string, allowedEmails: readonly string[]): string {
  const e = email.trim().toLowerCase();
  if (!/^[a-z0-9._+-]+@example\.test$/.test(e)) throw new Error('Only synthetic @example.test accounts are verified for devnet.');
  if (!allowedEmails.includes(e)) throw new Error('This address is not on POCKETQA_DEVNET_ALLOWED_EMAILS.');
  return e;
}
