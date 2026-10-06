// Exact-origin CORS on Pocket QA's own bucket (ledger S3). Three modes:
//   --print   offline: prints the rule for the origin and exits; no credentials, no R2 call;
//   (default) dry run: reads the bucket's current CORS and prints the plan; writes nothing;
//   --add     (with or without --apply) keeps every existing rule and appends this origin's rule;
//   --apply   creates the rule only when the bucket has no CORS (or already has exactly this
//             rule), then reads it back. It never replaces other rules and never touches objects.
// Credentials (dry run and --apply) come from the environment (POCKETQA_R2_ACCOUNT_ID,
// POCKETQA_R2_BUCKET, POCKETQA_R2_ACCESS_KEY_ID, POCKETQA_R2_SECRET_ACCESS_KEY), never printed.
//   pnpm --filter @pocket-qa/api r2:cors -- --origin https://pocketqa.optijara.ai [--print | --apply]
import { GetBucketCorsCommand, PutBucketCorsCommand, S3Client } from '@aws-sdk/client-s3';
import { R2_BUCKETS } from '../src/config';
import { CorsError, corsRules, mergeCors, mergedHolds, planCors, type CorsRule } from '../src/storage/cors';

const args = process.argv.slice(2);
const at = args.indexOf('--origin');
const origin = at >= 0 ? args[at + 1] : undefined;
const apply = args.includes('--apply');
// --add: keep every existing rule and append this origin's rule (never removes or edits a rule).
const add = args.includes('--add');
const print = args.includes('--print');
if (!origin || (apply && print) || (add && print)) {
  console.error('usage: r2:cors --origin https://<exact origin> [--print | [--add] [--apply]]');
  process.exit(2);
}
if (print) {
  // Offline: validate the origin and show the rule; nothing else is read or written.
  try {
    console.log(JSON.stringify({ CORSRules: corsRules(origin) }, null, 2));
    process.exit(0);
  } catch (e) {
    if (!(e instanceof CorsError)) throw e;
    console.error(e.message);
    process.exit(1);
  }
}
const env = process.env;
const accountId = env.POCKETQA_R2_ACCOUNT_ID ?? '';
const Bucket = env.POCKETQA_R2_BUCKET ?? '';
if (!/^[a-f0-9]{32}$/.test(accountId) || !env.POCKETQA_R2_ACCESS_KEY_ID || !env.POCKETQA_R2_SECRET_ACCESS_KEY) {
  console.error('Set POCKETQA_R2_ACCOUNT_ID, POCKETQA_R2_ACCESS_KEY_ID and POCKETQA_R2_SECRET_ACCESS_KEY.');
  process.exit(2);
}
if (!R2_BUCKETS.includes(Bucket)) {
  console.error(`Refusing: POCKETQA_R2_BUCKET must be Pocket QA's own bucket (${R2_BUCKETS.join(', ')}).`);
  process.exit(1);
}
let desired: CorsRule[];
try {
  desired = corsRules(origin);
} catch (e) {
  if (!(e instanceof CorsError)) throw e;
  console.error(e.message);
  process.exit(1);
}
const client = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: { accessKeyId: env.POCKETQA_R2_ACCESS_KEY_ID, secretAccessKey: env.POCKETQA_R2_SECRET_ACCESS_KEY },
});
const read = async (): Promise<CorsRule[] | null> => {
  try {
    return ((await client.send(new GetBucketCorsCommand({ Bucket }))).CORSRules ?? []) as CorsRule[];
  } catch (e) {
    if ((e as { name?: string }).name === 'NoSuchCORSConfiguration') return null;
    throw e;
  }
};
const current = await read();
if (add) {
  const merged = mergeCors(current, desired);
  console.log(`bucket ${Bucket}: current CORS ${current ? JSON.stringify(current) : '(none)'}`);
  console.log(`add-only: ${merged.plan === 'present' ? 'already present, nothing to write' : `would write ${JSON.stringify(merged.rules)}`}`);
  if (!apply || merged.plan === 'present') {
    if (!apply) console.log('Dry run: nothing changed. Re-run with --add --apply to append it.');
    process.exit(0);
  }
  await client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: merged.rules } }));
  const after = await read();
  const holds = mergedHolds(current, after, desired);
  console.log(`readback: ${after ? JSON.stringify(after) : '(none)'} → ${holds ? 'every previous rule kept, new origin present' : 'DOES NOT HOLD'}`);
  process.exit(holds ? 0 : 1);
}
const plan = planCors(current, desired);
console.log(`bucket ${Bucket}: current CORS ${current ? JSON.stringify(current) : '(none)'}`);
console.log(`desired ${JSON.stringify(desired)} → plan: ${plan}`);
if (plan === 'conflict') {
  console.error('Refusing: the bucket has other CORS rules. Nothing was changed.');
  process.exit(1);
}
if (!apply) {
  console.log('Dry run: nothing changed. Re-run with --apply to set it.');
  process.exit(0);
}
if (plan === 'create') await client.send(new PutBucketCorsCommand({ Bucket, CORSConfiguration: { CORSRules: desired } }));
const after = await read();
const ok = planCors(after, desired) === 'same';
console.log(`readback: ${after ? JSON.stringify(after) : '(none)'} → ${ok ? 'matches' : 'DOES NOT MATCH'}`);
process.exit(ok ? 0 : 1);
