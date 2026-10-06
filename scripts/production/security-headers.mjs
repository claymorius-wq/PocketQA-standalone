// The one definition of the browser security headers (pqa-qa r4 P2-I). It is shared by the
// production front door (scripts/production/web-server.mjs) and the Vercel deployment
// (scripts/vercel/config.mjs), so the two can't drift; scripts/vercel-config.test.mjs compares them.

// Firebase Auth (email/password, ID-token refresh). Google sign-in would also need the auth
// domain as frame-src; it is not enabled (ledger I9), so it is not allowed here.
export const FIREBASE_AUTH_ORIGINS = ['https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com'];

/** This account's R2 S3 endpoint, narrowed to the one bucket (presigned URLs are path-style: /<bucket>/<key>). */
export function r2BucketSource(r2AccountId, bucket) {
  if (!/^[a-f0-9]{32}$/.test(r2AccountId ?? '')) throw new Error('R2 account id must be 32 hex characters');
  if (!/^[a-z0-9][a-z0-9-]{2,62}$/.test(bucket ?? '')) throw new Error('R2 bucket name is required');
  return `https://${r2AccountId}.r2.cloudflarestorage.com/${bucket}/`;
}

/** connect-src sources for a deployment: Firebase Auth plus the one bucket, for presigned direct uploads. */
export function connectOrigins(r2AccountId, bucket) {
  return [...FIREBASE_AUTH_ORIGINS, r2BucketSource(r2AccountId, bucket)];
}

export function securityHeaders() {
  return {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    // Microphone and screen capture for this origin only: the local-only web recorder
    // (docs/plans/web-screen-audio-recording.md). The camera stays off.
    'permissions-policy': 'camera=(), microphone=(self), display-capture=(self), geolocation=(), payment=()',
    'cross-origin-opener-policy': 'same-origin',
    'strict-transport-security': 'max-age=31536000',
  };
}

// API responses (JSON and uploaded media) are never documents to render.
export const API_CSP = "default-src 'none'; sandbox";

const SOURCE = /^https:\/\/[a-z0-9.-]+(\/[a-z0-9-]+\/)?$/;
/**
 * The app CSP. React Native Web needs inline styles, not inline scripts (the export has none).
 * `media`: extra sources for evidence playback, i.e. the private bucket when playback is a presigned
 * GET (hosted R2); for video (media-src) and screenshots (img-src). The local front door plays
 * through /api, so it passes none.
 */
export function appCsp(connect, media = []) {
  for (const o of [...connect, ...media]) if (!SOURCE.test(o)) throw new Error(`CSP source must be an https origin, optionally with one /path/: ${o}`);
  const extra = media.length ? ` ${media.join(' ')}` : '';
  return `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:${extra}; media-src 'self' blob:${extra}; font-src 'self' data:; connect-src 'self' ${connect.join(' ')}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`;
}
