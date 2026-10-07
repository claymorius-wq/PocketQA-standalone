import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { API_CSP, securityHeaders } from './production/security-headers.mjs';
import { appCsp, connectOrigins } from './production/web-server.mjs';
import { hostedAppCsp, vercelConfig } from './vercel/config.mjs';

// pqa-qa r4 P2-I: the hosted deployment sends the same security headers as the production front
// door. Its CSP differs only by the one private bucket, as a playback source (presigned GET).
const ACCOUNT = 'a'.repeat(32);
const BUCKET = 'pocketqa-evidence';
const cfg = vercelConfig({ r2AccountId: ACCOUNT, bucket: BUCKET });
const appRoute = cfg.routes[0];
const apiRoute = cfg.routes[1];

describe('Vercel config headers', () => {
  it('the app route sends every production front-door header', () => {
    for (const [k, v] of Object.entries(securityHeaders())) assert.equal(appRoute.headers[k], v, k);
    assert.match(appRoute.headers['permissions-policy'], /camera=\(\), microphone=\(self\), display-capture=\(self\), geolocation=\(\), payment=\(\)/);
    assert.equal(appRoute.headers['cross-origin-opener-policy'], 'same-origin');
  });

  it('the app CSP is the front door CSP plus only the exact bucket for media and images', () => {
    const bucket = `https://${ACCOUNT}.r2.cloudflarestorage.com/${BUCKET}/`;
    const csp = appRoute.headers['content-security-policy'];
    assert.equal(csp, hostedAppCsp(ACCOUNT, BUCKET));
    const front = appCsp(connectOrigins(ACCOUNT, BUCKET));
    assert.equal(csp.replace(` ${bucket}; media-src`, '; media-src').replace(` ${bucket}; font-src`, '; font-src'), front);
    assert.match(csp, /default-src 'self'; script-src 'self';/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.ok(!csp.includes('*'), 'no wildcard source');
    assert.ok(csp.includes(`connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com ${bucket}`));
  });

  it('the API route is sandboxed, not cached, and has the security headers', () => {
    assert.equal(apiRoute.src, '^/api(?:/.*)?$');
    assert.equal(apiRoute.headers['content-security-policy'], API_CSP);
    assert.equal(apiRoute.headers['cache-control'], 'no-store');
    for (const [k, v] of Object.entries(securityHeaders())) assert.equal(apiRoute.headers[k], v, k);
  });

  it('the app route matches every path except the API, so the two CSPs never stack', () => {
    const app = new RegExp(appRoute.src);
    const api = new RegExp(apiRoute.src);
    for (const p of ['/', '/index.html', '/builder/study/1', '/apiary', '/_expo/static/js/web/x.js']) assert.ok(app.test(p) && !api.test(p), p);
    for (const p of ['/api', '/api/', '/api/me', '/api/jobs/settle']) assert.ok(api.test(p) && !app.test(p), p);
  });

  it('refuses a malformed account or bucket (no wildcard hosts)', () => {
    assert.throws(() => vercelConfig({ r2AccountId: '*', bucket: BUCKET }), /32 hex/);
    assert.throws(() => vercelConfig({ r2AccountId: ACCOUNT, bucket: '' }), /bucket/);
  });

  it('routes /api to the function, then files, then the SPA; two daily crons', () => {
    assert.deepEqual(cfg.routes.slice(2), [{ src: '^/api(?:/.*)?$', dest: '/api' }, { handle: 'filesystem' }, { src: '/(.*)', dest: '/index.html' }]);
    assert.deepEqual(cfg.crons.map((c) => c.path), ['/api/jobs/sweep', '/api/jobs/settle']);
    for (const c of cfg.crons) assert.match(c.schedule, /^\d+ \d+ \* \* \*$/);
  });

  it('Google sign-in on: the app route allows exactly gapi and the auth-domain iframe, and popups; /api is unchanged', () => {
    const g = vercelConfig({ r2AccountId: ACCOUNT, bucket: BUCKET, googleAuthDomain: 'pocketqa-optijara.firebaseapp.com' });
    const app = g.routes[0].headers;
    const api = g.routes[1].headers;
    assert.match(app['content-security-policy'], /script-src 'self' https:\/\/apis\.google\.com;/);
    assert.match(app['content-security-policy'], /frame-src https:\/\/pocketqa-optijara\.firebaseapp\.com;/);
    assert.equal(app['cross-origin-opener-policy'], 'same-origin-allow-popups');
    // Nothing else widened: dropping the two Google additions gives the Google-off policy exactly.
    const off = hostedAppCsp(ACCOUNT, BUCKET);
    assert.equal(app['content-security-policy'].replace(' https://apis.google.com', '').replace(' frame-src https://pocketqa-optijara.firebaseapp.com;', ''), off);
    assert.equal(api['cross-origin-opener-policy'], 'same-origin');
    assert.equal(api['content-security-policy'], API_CSP);
    assert.deepEqual(vercelConfig({ r2AccountId: ACCOUNT, bucket: BUCKET }).routes[0].headers['cross-origin-opener-policy'], 'same-origin');
    assert.throws(() => vercelConfig({ r2AccountId: ACCOUNT, bucket: BUCKET, googleAuthDomain: 'evil.example/*' }), /exact hostname/);
  });
});

