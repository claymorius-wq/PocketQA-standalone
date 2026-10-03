import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Metro resolves `x.native.ts` on iOS as well as Android. The MWA protocol package looks up
// its native module when it loads, and that module exists only on Android, so importing it
// from any file iOS can resolve crashes the iOS app on that screen (found by the iOS
// simulator smoke run). Files that import it must be Android-only.
const ROOT = join(__dirname, '..');
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

it('only *.android.ts(x) files import the Android-only Mobile Wallet Adapter module', () => {
  const offenders = [...files(join(ROOT, 'src')), ...files(join(ROOT, 'app'))]
    .filter((p) => /['"]@solana-mobile\/mobile-wallet-adapter-protocol['"]/.test(readFileSync(p, 'utf8'))) // import, require, import(), re-export
    .filter((p) => !/\.android\.tsx?$/.test(p))
    .map((p) => relative(ROOT, p));
  expect(offenders).toEqual([]);
});
