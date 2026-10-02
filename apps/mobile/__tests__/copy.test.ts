import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { lintCopy } from '@pocket-qa/domain';

// Every string literal in app UI source must pass the same banned-copy linter the API
// applies to builder text: no earnings promises, fake payment or fake-AI claims.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(tsx?)$/.test(f) ? [p] : [];
  });
}

describe('app copy', () => {
  const sources = [...files(join(__dirname, '../app')), ...files(join(__dirname, '../src'))];
  it('has UI sources to scan', () => expect(sources.length).toBeGreaterThan(10));
  it.each(sources)('%s has no banned wording', (file) => {
    const text = readFileSync(file, 'utf8');
    const literals = text.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1/g) ?? [];
    const jsxText = text.match(/>\s*([^<>{}]{3,})\s*</g) ?? [];
    const hits = [...literals, ...jsxText].filter((s) => lintCopy(s).length > 0);
    expect(hits).toEqual([]);
  });
});
