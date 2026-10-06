// Builds the hosted deployment as Vercel Build Output API v3 (docs/plans/firebase-vercel-refactor.md
// §1, P3), for `vercel deploy --prebuilt`. Nothing builds on Vercel, and no secret enters the output:
//   - functions/api.func: the Fastify API (src/hosted/vercel.ts) bundled by esbuild, including the
//     TS workspace packages. Native modules (better-sqlite3, argon2) are excluded: the hosted path
//     never loads them (test/hosted.test.ts).
//   - static: the Expo web export, calling the API same-origin at /api.
//   - config.json (scripts/vercel/config.mjs): /api/* goes to the function, other paths to static files
//     then the SPA, the shared security headers, and two daily crons.
// Then it scans the output for server-only secret values (counts only, never a value).
//   node scripts/vercel/build.mjs [--env staging|production|devnet] [--skip-web] [--deploy] [--out <dir>]
// --deploy (the build that will be uploaded): every server-only variable must be present in this
// environment, so the value scan really checks all of them (pqa-qa r7 P3). Otherwise it refuses.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { assertBundles } from './bundle-check.mjs';
import { vercelConfig } from './config.mjs';
import { needlesFor } from './secret-needles.mjs';

const REPO = join(import.meta.dirname, '../..');
const args = process.argv.slice(2);
// --out <dir>: tests build into their own temp dir, never the shared .vercel/output.
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : join(REPO, '.vercel/output');
if (!OUT) throw new Error('--out needs a directory');
const envName = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'staging';
const deploy = args.includes('--deploy');
if (deploy && args.includes('--out')) throw new Error('--deploy always builds .vercel/output (what vercel deploy --prebuilt uploads).');
if (deploy && args.includes('--skip-web')) throw new Error('--deploy builds the web app too: drop --skip-web.');
// Server-only: these live in the Vercel project's server env and must never reach the output.
// The devnet platform signer (devnet-phase-contract.md CH-D4) is always scanned for; it is required
// only for a devnet deploy, and any other build refuses to run with it in the environment.
const DEVNET_SIGNER = 'POCKETQA_DEVNET_PLATFORM_SIGNER';
const SERVER_ONLY = ['FIREBASE_SERVICE_ACCOUNT_JSON', 'POCKETQA_R2_ACCESS_KEY_ID', 'POCKETQA_R2_SECRET_ACCESS_KEY', 'CRON_SECRET', DEVNET_SIGNER];
if (envName !== 'staging' && envName !== 'production' && envName !== 'devnet') throw new Error('--env must be staging, production or devnet');
if (envName !== 'devnet' && process.env[DEVNET_SIGNER]) throw new Error(`${DEVNET_SIGNER} is only for --env devnet builds (Preview env only; production never has it).`);
if (deploy) {
  const missing = SERVER_ONLY.filter((n) => !process.env[n] && (n !== DEVNET_SIGNER || envName === 'devnet'));
  if (missing.length) throw new Error(`--deploy needs every server-only variable in the scanning environment (missing: ${missing.join(', ')}).`);
}

// One source of truth for the function's time limit: the idempotency lease is tested against it.
const hostedSrc = readFileSync(join(REPO, 'apps/api/src/hosted/app.ts'), 'utf8');
const maxDuration = Number(/export const MAX_DURATION_S = (\d+);/.exec(hostedSrc)?.[1]);
if (!maxDuration) throw new Error('MAX_DURATION_S not found in apps/api/src/hosted/app.ts');
// Next to the Firestore location (eur3, Europe): Frankfurt.
const REGION = 'fra1';

// The bucket the CSP allows (not secrets: the account id and bucket name appear in every presigned URL).
const r2AccountId = process.env.POCKETQA_R2_ACCOUNT_ID;
const bucket = process.env.POCKETQA_R2_BUCKET;
if (!r2AccountId || !bucket) throw new Error('POCKETQA_R2_ACCOUNT_ID and POCKETQA_R2_BUCKET are needed for the CSP.');
// Built (and validated) before anything is written.
// Google sign-in on (the server flag): the app routes get the popup-flow allowances for this auth domain.
const google = process.env.POCKETQA_FIREBASE_GOOGLE === '1';
const googleAuthDomain = google ? process.env.POCKETQA_FIREBASE_AUTH_DOMAIN : undefined;
if (google && !googleAuthDomain) throw new Error('POCKETQA_FIREBASE_GOOGLE=1 needs POCKETQA_FIREBASE_AUTH_DOMAIN for the CSP.');
const config = vercelConfig({ r2AccountId, bucket, googleAuthDomain });

rmSync(OUT, { recursive: true, force: true });
const fn = join(OUT, 'functions/api.func');
mkdirSync(fn, { recursive: true });

await build({
  entryPoints: [join(REPO, 'apps/api/src/hosted/vercel.ts')],
  outfile: join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  external: ['better-sqlite3', '@node-rs/argon2'],
  // CommonJS dependencies inside an ES module bundle still need require, __filename and __dirname.
  banner: {
    js: [
      "import { createRequire as __pqaRequire } from 'node:module';",
      "import { fileURLToPath as __pqaPath } from 'node:url';",
      "import { dirname as __pqaDir } from 'node:path';",
      'const require = __pqaRequire(import.meta.url);',
      'const __filename = __pqaPath(import.meta.url);',
      'const __dirname = __pqaDir(__filename);',
    ].join('\n'),
  },
  legalComments: 'none',
  logLevel: 'warning',
});
writeFileSync(
  join(fn, '.vc-config.json'),
  `${JSON.stringify({ runtime: 'nodejs24.x', handler: 'index.mjs', launcherType: 'Nodejs', maxDuration, regions: [REGION], shouldAddHelpers: false }, null, 2)}\n`,
);

const staticDir = join(OUT, 'static');
if (!args.includes('--skip-web')) {
  // Only the public build-time variables the web app reads; never EXPO_PUBLIC_PREVIEW.
  const env = { ...process.env, EXPO_PUBLIC_API_URL: '/api', EXPO_PUBLIC_POCKETQA_ENV: envName };
  delete env.EXPO_PUBLIC_PREVIEW;
  // The web export never needs a server secret, so it never gets one.
  for (const n of SERVER_ONLY) delete env[n];
  // --clear: Metro's transform cache inlines EXPO_PUBLIC_* values, and once served an e2e bundle
  // (API http://127.0.0.1:18887) to the deployed app (pqa-qa hosted gate r1 P1-H1).
  rmSync(join(REPO, 'apps/mobile/dist-web'), { recursive: true, force: true }); // no leftovers from earlier exports
  execFileSync('pnpm', ['--filter', '@pocket-qa/mobile', 'exec', 'expo', 'export', '--platform', 'web', '--output-dir', 'dist-web', '--clear'], { cwd: REPO, env, stdio: 'inherit' });
  rmSync(staticDir, { recursive: true, force: true });
  cpSync(join(REPO, 'apps/mobile/dist-web'), staticDir, { recursive: true });
  // And whatever the cache did: the app must call /api and nothing private, or there is no build.
  try {
    assertBundles([join(staticDir, '_expo')], '/api');
  } catch (e) {
    rmSync(OUT, { recursive: true, force: true });
    throw e;
  }
} else {
  mkdirSync(staticDir, { recursive: true });
}

writeFileSync(join(OUT, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);

// Secret scan: the values of every server-only variable present in this environment, plus key markers.
const needles = [];
for (const name of SERVER_ONLY) {
  const v = process.env[name];
  if (!v) continue;
  needles.push(...needlesFor(name, v));
}
// Key MATERIAL, not the words: libraries (firebase-admin, jose) mention these markers in their code.
const keyMaterial = [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----\s*[A-Za-z0-9+/=\s]{200,}/, /"private_key"\s*:\s*"-----BEGIN/];
let files = 0;
let hits = 0;
(function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else {
      files += 1;
      const text = readFileSync(p, 'latin1');
      for (const s of needles) if (s.length >= 8 && text.includes(s)) hits += 1;
      for (const re of keyMaterial) if (re.test(text)) hits += 1;
    }
  }
})(OUT);
execFileSync('node', [join(REPO, 'scripts/preview/assert-no-secrets.mjs'), OUT], { stdio: 'inherit' });
if (hits) {
  console.error(`secret scan: ${hits} match(es) in ${files} files. Refusing this output.`);
  rmSync(OUT, { recursive: true, force: true });
  process.exit(1);
}
console.log(`built .vercel/output (${envName}${deploy ? ', deploy' : ''}): api.func maxDuration ${maxDuration}s in ${REGION}; ${files} files; secret scan clean (${SERVER_ONLY.filter((n) => process.env[n]).length}/${SERVER_ONLY.length} server-only variables, ${needles.length} values checked)`);
