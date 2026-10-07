// Vercel Build Output config.json (v3) for the hosted deployment. Pure, so
// scripts/vercel-config.test.mjs can check it against the production front door's headers.
import { API_CSP, appCsp, connectOrigins, r2BucketSource, securityHeaders } from '../production/security-headers.mjs';

/** The hosted app CSP: Firebase Auth plus the one private bucket for uploads (connect) and presigned playback (media, img). */
export function hostedAppCsp(r2AccountId, bucket, googleAuthDomain) {
  return appCsp(connectOrigins(r2AccountId, bucket), [r2BucketSource(r2AccountId, bucket)], googleAuthDomain ? { googleAuthDomain } : {});
}

/** `googleAuthDomain`: set when the deployment offers Google sign-in (POCKETQA_FIREBASE_GOOGLE=1). */
export function vercelConfig({ r2AccountId, bucket, googleAuthDomain }) {
  const security = securityHeaders();
  const appSecurity = securityHeaders({ popups: !!googleAuthDomain });
  return {
    version: 3,
    routes: [
      // The app (everything but /api): security headers and the app CSP.
      { src: '^/(?!api(?:/|$)).*', headers: { ...appSecurity, 'content-security-policy': hostedAppCsp(r2AccountId, bucket, googleAuthDomain) }, continue: true },
      // The API: never a document to render, never cached.
      { src: '^/api(?:/.*)?$', headers: { ...security, 'content-security-policy': API_CSP, 'cache-control': 'no-store' }, continue: true },
      { src: '^/api(?:/.*)?$', dest: '/api' },
      { handle: 'filesystem' },
      // Single-page web app (expo web.output "single").
      { src: '/(.*)', dest: '/index.html' },
    ],
    // Hobby allows two daily crons. Both jobs also run as bounded slices after relevant mutations (R5).
    crons: [
      { path: '/api/jobs/sweep', schedule: '15 3 * * *' },
      { path: '/api/jobs/settle', schedule: '45 3 * * *' },
    ],
  };
}
