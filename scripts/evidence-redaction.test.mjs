// Checked-in command evidence is token-free (docs/verification.md convention): Firebase emulator
// one-time codes and API key query values must be written as [REDACTED], even fake ones.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const ROOT = join(import.meta.dirname, '../docs');
const files = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : f.endsWith('.txt') ? [join(dir, f)] : []));

test('evidence logs carry no unredacted oobCode or apiKey query values', () => {
  const hits = files(ROOT).flatMap((f) => (readFileSync(f, 'utf8').match(/\b(?:oobCode|apiKey)=(?!\[REDACTED\])[^&"\s]+/g) ?? []).map((m) => `${f}: ${m.slice(0, 12)}…`));
  assert.deepEqual(hits, []);
});
