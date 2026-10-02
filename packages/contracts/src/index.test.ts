import { describe, expect, it } from 'vitest';
import {
  buildPath,
  CreateStudyBody,
  ErrorBody,
  RegisterBody,
  RejectBody,
  routes,
  WalletLinkBody,
  CreditsView,
  CreateDevnetTransferBody,
  redactPath,
} from './index';

const validStudy = {
  title: 'Onboarding flow',
  objective: 'Find where new users get stuck during onboarding.',
  tasks: [{ instruction: 'Create an account and reach the home screen' }],
  deviceCriteria: { platforms: ['android'], minAndroidApi: 34, languages: ['en'] },
  rewardCredits: 50,
  slots: 5,
  consentText: 'I agree to record my screen only while performing these tasks.',
};

describe('contracts', () => {
  it('accepts a valid study and rejects zero reward or no tasks', () => {
    expect(CreateStudyBody.safeParse(validStudy).success).toBe(true);
    expect(CreateStudyBody.safeParse({ ...validStudy, rewardCredits: 0 }).success).toBe(false);
    expect(CreateStudyBody.safeParse({ ...validStudy, rewardCredits: 1.5 }).success).toBe(false);
    expect(CreateStudyBody.safeParse({ ...validStudy, tasks: [] }).success).toBe(false);
  });

  it('never allows self-registration as admin', () => {
    const base = { email: 'A@Example.com', password: 'correct horse battery', displayName: 'A' };
    expect(RegisterBody.safeParse({ ...base, role: 'admin' }).success).toBe(false);
    const ok = RegisterBody.parse({ ...base, role: 'tester' });
    expect(ok.email).toBe('a@example.com');
  });

  it('normalizes emails with surrounding whitespace and case', () => {
    const base = { password: 'correct horse battery', displayName: 'A', role: 'tester' };
    const parsed = RegisterBody.safeParse({ ...base, email: '  A@Example.COM ' });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.email).toBe('a@example.com');
  });

  it('requires a substantive rejection reason', () => {
    expect(RejectBody.safeParse({ reason: 'bad' }).success).toBe(false);
    expect(RejectBody.safeParse({ reason: 'No evidence attached for task 2' }).success).toBe(true);
  });

  it('only accepts known error codes', () => {
    expect(ErrorBody.safeParse({ code: 'NONCE_INVALID', message: 'x' }).success).toBe(true);
    expect(ErrorBody.safeParse({ code: 'PAID', message: 'x' }).success).toBe(false);
  });

  it('pins the credits disclaimer', () => {
    expect(CreditsView.safeParse({ balance: 1, entries: [], disclaimer: 'Earnings' }).success).toBe(false);
  });

  it('rejects non-base58 wallet addresses', () => {
    const sig = 'A'.repeat(88);
    const ok = { address: '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV', nonce: 'n'.repeat(16), signature: sig, signedMessage: 'bQ==' };
    expect(WalletLinkBody.safeParse(ok).success).toBe(true);
    expect(WalletLinkBody.safeParse({ ...ok, address: '0OIl'.repeat(10) }).success).toBe(false);
    expect(WalletLinkBody.safeParse({ ...ok, nonce: 'short' }).success).toBe(false);
  });

  it('binds every route to an auth level and schemas', () => {
    for (const [name, def] of Object.entries(routes)) {
      expect(['public', 'user', 'tester', 'builder', 'admin'], name).toContain(def.auth);
      expect(def.response, name).toBeTruthy();
    }
    // Only these routes are reachable without a session.
    const open = Object.entries(routes).filter(([, d]) => d.auth === 'public').map(([n]) => n).sort();
    expect(open).toEqual(['health', 'login', 'media', 'register']);
  });

  it('transfer intents take no client-chosen recipient or amount', () => {
    const parsed = CreateDevnetTransferBody.parse({ participationId: 'p1', recipient: 'x', lamports: 5 });
    expect(parsed).toEqual({ participationId: 'p1' });
  });

  it('redacts playback tokens from logged paths', () => {
    expect(redactPath('/media/abcdef0123456789abcdef0123456789?x=1')).toBe('/media/[redacted]');
    expect(redactPath('/studies/1')).toBe('/studies/1');
  });

  it('builds paths and refuses missing params', () => {
    expect(buildPath(routes.putTaskNote.path, { id: 'p 1', taskId: 't1' })).toBe('/participations/p%201/tasks/t1/note');
    expect(() => buildPath(routes.getStudy.path)).toThrow();
  });
});
