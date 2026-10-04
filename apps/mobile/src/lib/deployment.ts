import { isPublicHost } from '@pocket-qa/contracts';

/**
 * Build-time deployment checks (docs/production/acceptance-ledger.md D1, O5). A production
 * build (EXPO_PUBLIC_POCKETQA_ENV=production) must reach the API over https on a real host,
 * or same-origin `/api` on web, and can never be the shared-demo preview build.
 * Returns a problem to show instead of the app, or null.
 */
export function deploymentProblem(input: { env: string | undefined; apiUrl: string | undefined; preview: boolean; platform: string }): string | null {
  if (input.env !== 'production') return null;
  if (input.preview) return 'This production build was made with the demo preview switched on. Rebuild without EXPO_PUBLIC_PREVIEW.';
  const url = input.apiUrl ?? '';
  // Web may use the same-origin proxy path; native needs an absolute https URL.
  if (input.platform === 'web' && url === '/api') return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return 'This production build has no valid API address (EXPO_PUBLIC_API_URL).';
  }
  if (u.protocol !== 'https:' || !isPublicHost(u.hostname)) return 'This production build points at a non-https, local or private API address. Rebuild with the public https API URL.';
  return null;
}

export const PRODUCTION_BUILD = process.env.EXPO_PUBLIC_POCKETQA_ENV === 'production';
