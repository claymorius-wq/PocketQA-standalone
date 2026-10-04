import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Native regression (2026-10-04): a worklet whose signature had a default value read from module
// scope (`coreIdle = CORE_IDLE_OPACITY`) crashed Android on the UI thread with "Property
// 'CORE_IDLE_OPACITY' doesn't exist": the worklet transform captures what the body reads, not
// default-parameter initialisers. Jest runs worklets as plain JS, so only this static check sees it.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    if (n === '__tests__' || n === 'node_modules') return [];
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

it('no worklet takes a default parameter', () => {
  const bad: string[] = [];
  for (const f of [...files(join(__dirname, '../src')), ...files(join(__dirname, '../app'))]) {
    const lines = readFileSync(f, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/^\s*['"]worklet['"];?\s*$/.test(line)) return;
      const sig = lines.slice(Math.max(0, i - 4), i).join(' ');
      const params = /\(([^()]*)\)\s*(?::[^{]*)?(?:=>)?\s*\{\s*$/.exec(sig)?.[1] ?? '';
      if (/[^=!<>]=[^=>]/.test(params)) bad.push(`${f}:${i + 1}`);
    });
  }
  expect(bad).toEqual([]);
});

it('the check sees the pattern it guards against', () => {
  const sig = 'export function liveLevels(b: number, coreIdle = CORE_IDLE_OPACITY): LiveLevels {';
  expect(/[^=!<>]=[^=>]/.test(/\(([^()]*)\)\s*(?::[^{]*)?(?:=>)?\s*\{\s*$/.exec(sig)?.[1] ?? '')).toBe(true);
});
