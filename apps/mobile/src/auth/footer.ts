import type { AuthMode, StorageMode } from '@pocket-qa/contracts';

/**
 * Where data actually lives, from the server's public config: never a local-only claim
 * on a cloud deployment (Firebase sign-in or R2 evidence).
 */
export function signInFooter(c: { preview: boolean; authMode: AuthMode; storage: StorageMode; apiLocal?: boolean }): string {
  if (c.preview) return 'Public demo preview · synthetic data · devnet and test credits only';
  if (c.authMode === 'local' && c.storage === 'local') {
    // "This machine" only when the API itself is local; a hosted API keeps the data.
    return c.apiLocal === false ? 'Accounts and evidence are kept on the Pocket QA server' : 'Local build · data stays on this machine';
  }
  const accounts = c.authMode === 'firebase' ? 'Sign-in is managed by Firebase' : 'Accounts are kept on the Pocket QA server';
  const evidence = c.storage === 'r2' ? 'evidence is stored privately in cloud storage' : 'evidence is stored on the Pocket QA server';
  return `${accounts} · ${evidence}`;
}

/** Whether the API base URL points at this machine (loopback), e.g. the local build. */
export const isLoopbackApi = (base: string) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?(\/|$)/.test(base);
