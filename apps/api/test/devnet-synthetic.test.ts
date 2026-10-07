import { describe, expect, it } from 'vitest';
import { assertSyntheticDevnetEmail } from '../src/devnet/syntheticIdentity';

// Firebase Auth is project-global: devnet verifies only labelled synthetic accounts on its allow-list.
describe('assertSyntheticDevnetEmail', () => {
  const allowed = ['devnet-builder@example.test', 'devnet-tester@example.test'];
  it('accepts an allow-listed @example.test address (normalised)', () => {
    expect(assertSyntheticDevnetEmail(' Devnet-Builder@Example.Test ', allowed)).toBe('devnet-builder@example.test');
  });
  it.each(['hamza@gmail.com', 'devnet-builder@example.test.evil.com', 'other@example.test', ''])('refuses %j', (email) => {
    expect(() => assertSyntheticDevnetEmail(email, allowed)).toThrow();
  });
});
