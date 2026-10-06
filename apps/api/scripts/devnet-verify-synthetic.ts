// Prints the email-verification link of ONE synthetic devnet account (devnet-live-run.md §4), so the
// operator can verify it without a mailbox. Only an address on POCKETQA_DEVNET_ALLOWED_EMAILS, and only
// @example.test, is accepted; anything else is refused before Firebase is contacted.
//   POCKETQA_FIREBASE_PROJECT_ID=… POCKETQA_DEVNET_ALLOWED_EMAILS=… FIREBASE_SERVICE_ACCOUNT_JSON=… \
//     npx tsx scripts/devnet-verify-synthetic.ts <email>
// The account must already exist (signed up in the devnet app). The link is single-use; nothing else
// is printed.
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { assertSyntheticDevnetEmail } from '../src/devnet/syntheticIdentity';
import { serviceAccountCredential } from '../src/firestore/admin';

const projectId = process.env.POCKETQA_FIREBASE_PROJECT_ID ?? '';
const allowed = (process.env.POCKETQA_DEVNET_ALLOWED_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
try {
  const email = assertSyntheticDevnetEmail(process.argv[2] ?? '', allowed);
  if (!projectId) throw new Error('POCKETQA_FIREBASE_PROJECT_ID is required.');
  const credential = serviceAccountCredential(process.env, projectId);
  if (!credential) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON (server-only) is required.');
  const app = getApps().find((a) => a.name === 'devnet-verify') ?? initializeApp({ projectId, credential }, 'devnet-verify');
  console.log(await getAuth(app).generateEmailVerificationLink(email));
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
