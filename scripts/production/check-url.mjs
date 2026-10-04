// Validates production build inputs for build-web.sh (inc1 review P3-2, P3-3). Mirrors
// isPublicHost in packages/contracts (same cases in scripts/production-scripts.test.mjs).
//   node check-url.mjs api <PROD_API_URL>     `/api` or https on a public host
//   node check-url.mjs out <PROD_WEB_DIR>     must be apps/mobile/dist-production
import { realpathSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function isPublicHost(hostname) {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (h === '' || h === 'localhost' || h.endsWith('.localhost')) return false;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127));
  }
  if (h.startsWith('[')) {
    const v6 = h.slice(1, -1);
    return !(v6 === '::1' || v6 === '::' || v6.startsWith('::ffff:') || /^::[0-9a-f.]*$/.test(v6) || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6));
  }
  return true;
}

export function apiProblem(value) {
  if (value === '/api') return null;
  let u;
  try {
    u = new URL(value);
  } catch {
    return 'PROD_API_URL must be /api or an https origin.';
  }
  if (u.protocol !== 'https:') return 'PROD_API_URL must be /api or an https origin.';
  if (!isPublicHost(u.hostname)) return 'PROD_API_URL must be a public host (not loopback, private or emulator).';
  return null;
}

const REPO = resolve(import.meta.dirname, '../..');
export function outProblem(value) {
  const rel = relative(resolve(REPO, 'apps/mobile'), resolve(REPO, value));
  if (rel !== 'dist-production') return 'PROD_WEB_DIR must be apps/mobile/dist-production (git-ignored).';
  return null;
}

// Real paths on both sides, so a symlinked checkout or a path with spaces still runs the check.
const isMain = process.argv[1] !== undefined && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
if (isMain) {
  const [kind, value = ''] = process.argv.slice(2);
  const problem = kind === 'api' ? apiProblem(value) : kind === 'out' ? outProblem(value) : 'usage: check-url.mjs api|out <value>';
  if (problem) {
    console.error(problem);
    process.exit(1);
  }
}
