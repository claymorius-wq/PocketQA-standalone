import { createSignInMessageText } from '@solana/wallet-standard-util';
import { describe, expect, it } from 'vitest';
import {
  isPublicHost,
  buildSiwsMessage,
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
      expect(['public', 'identity', 'user', 'tester', 'builder', 'admin'], name).toContain(def.auth);
      expect(def.response, name).toBeTruthy();
    }
    // Only these routes are reachable without a session.
    const open = Object.entries(routes).filter(([, d]) => d.auth === 'public').map(([n]) => n).sort();
    // clientConfig returns only public configuration (ADR 0005); identitySession needs a
    // verified provider token (auth 'identity'), so it is not open either.
    // walletLoginChallenge/walletLogin prove control of a key instead (ADR 0005 §2).
    expect(open).toEqual(['clientConfig', 'health', 'login', 'media', 'register', 'walletLogin', 'walletLoginChallenge']);
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

  // ADR 0005 §2/§4: Wallet Standard wallets build the sign-in text themselves with the
  // standard formatter; the server requires an exact match with buildSiwsMessage.
  it('buildSiwsMessage is byte-identical to the Wallet Standard sign-in message text', () => {
    const input = {
      domain: 'app.pocketqa.example',
      address: '3BL56hNDpaoqdnh898NyzPZiE4XXxFmFFQ9egFBsNtTB',
      statement: 'Sign in to Pocket QA at https://app.pocketqa.example with this devnet wallet. Only sign this on app.pocketqa.example. This is not a payment and sends nothing.',
      uri: 'https://app.pocketqa.example',
      version: '1' as const,
      chainId: 'solana:devnet' as const,
      nonce: 'abcDEF1234567890xyz',
      issuedAt: '2026-10-04T00:00:00.000Z',
      expirationTime: '2026-10-04T00:05:00.000Z',
    };
    expect(buildSiwsMessage(input)).toBe(createSignInMessageText(input));
  });
});

// The contracts package has no DOM/node lib; the WHATWG URL global exists at test runtime.
declare const URL: new (u: string) => { hostname: string };

describe('isPublicHost (production endpoints, inc1 review P3-1/P3-2)', () => {
  const host = (u: string) => new URL(u).hostname;
  it('refuses loopback, unspecified, private, emulator and mapped addresses in every spelling', () => {
    for (const u of [
      'https://localhost', 'https://localhost.', 'https://LOCALHOST', 'https://app.localhost', 'https://127.0.0.1', 'https://127.1', 'https://127.255.0.9',
      'https://0.0.0.0', 'https://0', 'https://10.0.2.2', 'https://10.1.2.3', 'https://172.16.0.1', 'https://192.168.1.10', 'https://169.254.1.1', 'https://100.64.0.1',
      'https://[::1]', 'https://[::]', 'https://[::ffff:127.0.0.1]', 'https://[::ffff:8.8.8.8]', 'https://[fd00::1]', 'https://[fe80::1]', 'https://2130706433',
    ]) {
      expect(isPublicHost(host(u)), u).toBe(false);
    }
  });
  it('accepts public names and addresses', () => {
    for (const u of ['https://pocketqa.optijara.ai', 'https://api.pocketqa.example', 'https://8.8.8.8', 'https://172.32.0.1', 'https://[2606:4700::1111]']) {
      expect(isPublicHost(host(u)), u).toBe(true);
    }
  });
});
