import { restoreToken } from '../src/auth/restore';

function stores(marker: string | null, token: string | null) {
  const s = { marker, token, cleared: 0 };
  return {
    s,
    flags: { get: async () => s.marker, set: async (v: string) => void (s.marker = v) },
    tokens: { get: async () => s.token, clear: async () => void ((s.token = null), s.cleared++) },
  };
}

describe('restoreToken (iOS keychain survives uninstall)', () => {
  it('drops a leftover session on the first launch after install', async () => {
    const { s, flags, tokens } = stores(null, 'old-users-session-token');
    expect(await restoreToken(flags, tokens)).toBeNull();
    expect(s.cleared).toBe(1);
    expect(s.marker).toBe('1');
  });
  it('restores the session on later launches', async () => {
    const { s, flags, tokens } = stores('1', 'current-session-token');
    expect(await restoreToken(flags, tokens)).toBe('current-session-token');
    expect(s.cleared).toBe(0);
  });
});
