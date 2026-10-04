import { isLoopbackApi, signInFooter } from '../src/auth/footer';

// Increment-4 review r1 P2: the sign-in footer must describe where data actually lives.
describe('sign-in footer', () => {
  it('local auth and local storage: data stays on this machine', () => {
    expect(signInFooter({ preview: false, authMode: 'local', storage: 'local' })).toBe('Local build · data stays on this machine');
  });
  it('never claims local-only data on cloud deployments', () => {
    for (const c of [
      { authMode: 'firebase', storage: 'local' },
      { authMode: 'local', storage: 'r2' },
      { authMode: 'firebase', storage: 'r2' },
    ] as const) {
      const text = signInFooter({ preview: false, ...c });
      expect(text).not.toMatch(/stays on this machine|local build/i);
    }
    expect(signInFooter({ preview: false, authMode: 'firebase', storage: 'r2' })).toBe('Sign-in is managed by Firebase · evidence is stored privately in cloud storage');
    expect(signInFooter({ preview: false, authMode: 'firebase', storage: 'local' })).toBe('Sign-in is managed by Firebase · evidence is stored on the Pocket QA server');
    expect(signInFooter({ preview: false, authMode: 'local', storage: 'r2' })).toBe('Accounts are kept on the Pocket QA server · evidence is stored privately in cloud storage');
  });
  it('the shared preview says it is public and synthetic', () => {
    expect(signInFooter({ preview: true, authMode: 'local', storage: 'local' })).toBe('Public demo preview · synthetic data · devnet and test credits only');
  });
});

describe('hosted API (review r2 P3)', () => {
  it('local auth and storage on a remote API never says "this machine"', () => {
    expect(signInFooter({ preview: false, authMode: 'local', storage: 'local', apiLocal: false })).toBe('Accounts and evidence are kept on the Pocket QA server');
  });
  it('detects a loopback API', () => {
    expect(isLoopbackApi('http://127.0.0.1:8787')).toBe(true);
    expect(isLoopbackApi('http://localhost:8787/')).toBe(true);
    expect(isLoopbackApi('https://api.pocketqa.example')).toBe(false);
    expect(isLoopbackApi('/api')).toBe(false);
  });
});
