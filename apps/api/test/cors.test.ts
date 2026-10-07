import { describe, expect, it } from 'vitest';
import { CorsError, corsRules, mergeCors, mergedHolds, planCors } from '../src/storage/cors';

// Ledger S3: one exact https origin, PUT with content-type only; never overwrite other rules.
describe('evidence bucket CORS', () => {
  it('builds the minimal rule for the production origin', () => {
    expect(corsRules('https://pocketqa.optijara.ai')).toEqual([{ AllowedOrigins: ['https://pocketqa.optijara.ai'], AllowedMethods: ['PUT'], AllowedHeaders: ['content-type'], MaxAgeSeconds: 3600 }]);
  });

  it('refuses anything but an exact public https origin', () => {
    for (const o of ['*', 'https://*.optijara.ai', 'http://pocketqa.optijara.ai', 'https://pocketqa.optijara.ai/', 'https://pocketqa.optijara.ai/app', 'https://localhost', 'https://127.0.0.1', 'https://192.168.1.2', 'pocketqa.optijara.ai']) {
      expect(() => corsRules(o), o).toThrow(CorsError);
    }
  });

  it('plans create on an empty bucket, same on an identical rule, and conflict on anything else', () => {
    const want = corsRules('https://pocketqa.optijara.ai');
    expect(planCors(null, want)).toBe('create');
    expect(planCors([], want)).toBe('create');
    expect(planCors([{ AllowedOrigins: ['https://pocketqa.optijara.ai'], AllowedMethods: ['put'], AllowedHeaders: ['Content-Type'], MaxAgeSeconds: 3600 }], want)).toBe('same');
    expect(planCors([{ AllowedOrigins: ['*'], AllowedMethods: ['GET'], AllowedHeaders: [], MaxAgeSeconds: 3600 }], want)).toBe('conflict');
    expect(planCors([...want, { AllowedOrigins: ['https://other.example'], AllowedMethods: ['PUT'], AllowedHeaders: ['content-type'], MaxAgeSeconds: 3600 }], want)).toBe('conflict');
  });

  it('add-only merge keeps every existing rule verbatim and appends the exact new origin once', () => {
    const existing = corsRules('https://pocketqa.optijara.ai');
    const want = corsRules('https://pocketqa.vercel.app');
    const merged = mergeCors(existing, want);
    expect(merged.plan).toBe('add');
    expect(merged.rules).toEqual([...existing, ...want]);
    expect(mergedHolds(existing, merged.rules, want)).toBe(true);
    expect(mergeCors(merged.rules, want)).toEqual({ plan: 'present', rules: merged.rules }); // idempotent
    expect(mergeCors(null, want)).toEqual({ plan: 'add', rules: want });
    // A readback that dropped the old rule fails the check.
    expect(mergedHolds(existing, want, want)).toBe(false);
  });
});

