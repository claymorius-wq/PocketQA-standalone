import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { corsRules } from '../src/storage/cors';

// scripts/r2-cors.ts modes that never reach R2: --print (offline) and the argument/credential
// refusals. The environment carries no R2 credentials at all, so any network attempt would fail.
const run = (...args: string[]) => {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('POCKETQA_R2_')));
  return spawnSync('npx', ['tsx', 'scripts/r2-cors.ts', ...args], { cwd: process.cwd(), env, encoding: 'utf8' });
};

describe('r2:cors script (no R2 calls)', () => {
  it('--print shows the exact-origin rule and exits 0 without credentials', () => {
    const r = run('--origin', 'https://pocketqa.optijara.ai', '--print');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ CORSRules: corsRules('https://pocketqa.optijara.ai') });
  });

  it('--print refuses a non-exact origin (exit 1)', () => {
    const r = run('--origin', 'https://*.optijara.ai', '--print');
    expect(r.status).toBe(1);
    expect(r.stdout).toBe('');
  });

  it('no origin, or --print with --apply, is a usage error (exit 2)', () => {
    expect(run().status).toBe(2);
    expect(run('--origin', 'https://pocketqa.optijara.ai', '--print', '--apply').status).toBe(2);
  });

  it('the dry run without credentials stops before any R2 call (exit 2)', () => {
    const r = run('--origin', 'https://pocketqa.optijara.ai');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Set POCKETQA_R2_ACCOUNT_ID');
  });
});
