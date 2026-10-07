// The client bundle must call the API it was built for (pqa-qa hosted gate r1 P1-H1). Metro's
// transform cache once served the deployed web app an e2e bundle that called
// http://127.0.0.1:18887. A build therefore fails unless:
//   - the bundle contains the expected API base as a string literal ("/api" on web, the https URL
//     in an APK), and
//   - it contains no loopback or private API base with a port (127.0.0.1, localhost, [::1],
//     0.0.0.0, 10/8, 172.16/12, 192.168/16). Bare hosts without a port (library code, the
//     contracts' runtime-assembled default) are not API bases and are allowed, and so are two exact
//     library constants (below).
//   node scripts/vercel/bundle-check.mjs --expect <base> <file-or-dir>...
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Exact library constants that are never our API base (our API is on 8787 locally, or an e2e
// override port): React Native's dev server (react-native/Libraries/Core/Devtools/getDevServer.js)
// and Solana's local validator (@solana/web3.js clusterApiUrl 'localnet').
const LIBRARY_CONSTANTS = ['http://localhost:8081', 'http://localhost:8899'];
// Hermes bytecode (APK bundles) stores strings back to back with no quotes.
const HERMES_MAGIC = '\xc6\x1f\xbc\x03\xc1\x03\x19\x1f';

const PRIVATE_BASE = /https?:\/\/(?:127\.\d+\.\d+\.\d+|localhost|\[::1\]|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+):\d{2,5}/g;

/** Problems in one bundle's text; empty when it targets `expected` only. */
export function bundleProblems(text, expected) {
  const problems = [];
  const hermes = text.startsWith(HERMES_MAGIC);
  const literal = (q) => text.includes(`${q}${expected}${q}`);
  const present = hermes ? text.includes(expected) : literal('"') || literal("'") || literal('`');
  if (!present) problems.push(`missing the API base ${expected}`);
  let scan = text;
  for (const c of LIBRARY_CONSTANTS) scan = scan.split(c).join(' ');
  for (const m of new Set(scan.match(PRIVATE_BASE) ?? [])) problems.push(`private/loopback API base ${m}`);
  return problems;
}

function jsFiles(path) {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((n) => jsFiles(join(path, n))).filter((f) => /\.(js|bundle)$/.test(f));
}

/** Throws unless the bundle files under `paths` together contain the base and no private base. */
export function assertBundles(paths, expected) {
  const files = paths.flatMap(jsFiles);
  if (!files.length) throw new Error('bundle check: no .js/.bundle files found');
  const all = files.map((f) => readFileSync(f, 'latin1'));
  const missing = !all.some((t) => bundleProblems(t, expected).every((p) => !p.startsWith('missing')));
  const priv = [...new Set(all.flatMap((t) => bundleProblems(t, expected).filter((p) => !p.startsWith('missing'))))];
  const problems = [...(missing ? [`missing the API base ${expected}`] : []), ...priv];
  if (problems.length) throw new Error(`bundle check failed (${files.length} files): ${problems.join('; ')}`);
  return files.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--expect');
  if (at < 0 || !args[at + 1]) {
    console.error('usage: bundle-check.mjs --expect <base> <file-or-dir>...');
    process.exit(2);
  }
  const expected = args[at + 1];
  const paths = args.filter((_, i) => i !== at && i !== at + 1);
  try {
    console.log(`bundle check ok: ${assertBundles(paths, expected)} files call ${expected} and no private API base`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
