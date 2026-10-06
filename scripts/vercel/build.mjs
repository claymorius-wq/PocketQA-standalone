// Builds the hosted deployment as Vercel Build Output API v3 (docs/plans/firebase-vercel-refactor.md
// §1, P3), for `vercel deploy --prebuilt`. Nothing builds on Vercel, and no secret enters the output:
//   - functions/api.func: the Fastify API (src/hosted/vercel.ts) bundled by esbuild, including the
//     TS workspace packages. Native modules (better-sqlite3, argon2) are excluded: the hosted path
//     never loads them (test/hosted.test.ts).
//   - static: the Expo web export, calling the API same-origin at /api.
//   - config.json (scripts/vercel/config.mjs): /api/* goes to the function, other paths to static files
//     then the SPA, the shared security headers, and two daily crons.
// Then it scans the output for server-only secret values (counts only, never a value).
//   node scripts/vercel/build.mjs [--env staging|production] [--skip-web] [--deploy]
// --deploy (the build that will be uploaded): every server-only variable must be present in this
// environment, so the value scan really checks all of them (pqa-qa r7 P3). Otherwise it refuses.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { vercelConfig } from './config.mjs';

const REPO = join(import.meta.dirname, '../..');
const OUT = join(REPO, '.vercel/output');
const args = process.argv.slice(2);
const envName = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'staging';
const deploy = args.includes('--deploy');
if (deploy && args.includes('--skip-web')) throw new Error('--deploy builds the web app too: drop --skip-web.');
// Server-only: these live in the Vercel project's server env and must never reach the output.
const SERVER_ONLY = ['FIREBASE_SERVICE_ACCOUNT_JSON', 'POCKETQA_R2_ACCESS_KEY_ID', 'POCKETQA_R2_SECRET_ACCESS_KEY', 'CRON_SECRET'];
if (deploy) {
  const missing = SERVER_ONLY.filter((n) => !process.env[n]);
  if (missing.length) throw new Error(`--deploy needs every server-only variable in the scanning environment (missing: ${missing.join(', ')}).`);
}
if (envName !== 'staging' && envName !== 'production') throw new Error('--env must be staging or production');

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
const config = vercelConfig({ r2AccountId, bucket });

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
  execFileSync('pnpm', ['--filter', '@pocket-qa/mobile', 'build:web'], { cwd: REPO, env, stdio: 'inherit' });
  cpSync(join(REPO, 'apps/mobile/dist-web'), staticDir, { recursive: true });
} else {
  mkdirSync(staticDir, { recursive: true });
}

writeFileSync(join(OUT, 'config.json'), `${JSON.stringify(config, null, 2)}\n`);

// Secret scan: the values of every server-only variable present in this environment, plus key markers.
const needles = [];
for (const name of SERVER_ONLY) {
  const v = process.env[name];
  if (!v) continue;
  needles.push(v);
  if (name === 'FIREBASE_SERVICE_ACCOUNT_JSON') {
    try {
      const sa = JSON.parse(v);
      for (const k of ['private_key', 'private_key_id', 'client_id']) if (sa[k]) needles.push(String(sa[k]));
    } catch {
      /* the value itself is still scanned */
    }
  }
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
