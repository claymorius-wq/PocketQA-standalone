// Vercel Build Output config.json (v3) for the hosted deployment. Pure, so
// scripts/vercel-config.test.mjs can check it against the production front door's headers.
import { API_CSP, appCsp, connectOrigins, r2BucketSource, securityHeaders } from '../production/security-headers.mjs';

/** The pinned devnet RPC the devnet web client reads (pqa-be1 CS3); only a devnet build's CSP allows it. */
export const DEVNET_RPC_ORIGIN = 'https://api.devnet.solana.com';

/**
 * The hosted app CSP: Firebase Auth plus the one private bucket for uploads (connect) and presigned
 * playback (media, img). `devnet`: also the pinned devnet RPC (connect only); every other build is
 * byte-identical to before.
 */
export function hostedAppCsp(r2AccountId, bucket, googleAuthDomain, { devnet = false } = {}) {
  const connect = connectOrigins(r2AccountId, bucket);
  return appCsp(devnet ? [...connect, DEVNET_RPC_ORIGIN] : connect, [r2BucketSource(r2AccountId, bucket)], googleAuthDomain ? { googleAuthDomain } : {});
}

/** `googleAuthDomain`: set when the deployment offers Google sign-in (POCKETQA_FIREBASE_GOOGLE=1). */
export function vercelConfig({ r2AccountId, bucket, googleAuthDomain, devnet = false }) {
  const security = securityHeaders();
  const appSecurity = securityHeaders({ popups: !!googleAuthDomain });
  return {
    version: 3,
    routes: [
      // The app (everything but /api): security headers and the app CSP.
      { src: '^/(?!api(?:/|$)).*', headers: { ...appSecurity, 'content-security-policy': hostedAppCsp(r2AccountId, bucket, googleAuthDomain, { devnet }) }, continue: true },
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
