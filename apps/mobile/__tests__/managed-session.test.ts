import { ApiError } from '../src/api/client';
import { endsRestoredSession, resolveManagedSession } from '../src/auth/managedSession';

const user = { id: 'u1', email: 'a@example.test', displayName: 'A', role: 'tester', status: 'active', device: null, wallet: null, createdAt: '2026-10-04T00:00:00.000Z' };

describe('resolveManagedSession', () => {
  it('returns the mapped account and never asks to create one', async () => {
    const call = jest.fn(async () => ({ user }));
    expect(await resolveManagedSession(call as never)).toEqual({ kind: 'signed-in', user });
    expect(call).toHaveBeenCalledWith({});
  });
  it('a 404 means no account yet: the UI asks for a role', async () => {
    const call = jest.fn(async () => {
      throw new ApiError('NOT_FOUND', 'No Pocket QA account uses this sign-in yet.', 404);
    });
    expect(await resolveManagedSession(call as never)).toEqual({ kind: 'needs-account' });
  });
  it('an unverified email is an actionable error', async () => {
    const call = jest.fn(async () => {
      throw new ApiError('EMAIL_UNVERIFIED', 'x', 403);
    });
    await expect(resolveManagedSession(call as never)).rejects.toThrow(/Verify your email/);
  });
  it('other errors propagate', async () => {
    const call = jest.fn(async () => {
      throw new ApiError('OFFLINE', 'down', 0);
    });
    await expect(resolveManagedSession(call as never)).rejects.toMatchObject({ code: 'OFFLINE' });
  });
});

describe('endsRestoredSession (inc2 review P3-1)', () => {
  it('a restored Firebase session the API refuses as signed-out or unverified is cleared; offline keeps it', () => {
    expect(endsRestoredSession(new ApiError('UNAUTHENTICATED', 'x', 401))).toBe(true);
    expect(endsRestoredSession(new ApiError('EMAIL_UNVERIFIED', 'x', 403))).toBe(true);
    expect(endsRestoredSession(new ApiError('OFFLINE', 'x', 0))).toBe(false);
    expect(endsRestoredSession(new Error('x'))).toBe(false);
  });
});
