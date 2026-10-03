// HTTP smoke for the protected preview. Prints statuses only, never a secret.
//   Local (Host header):  PREVIEW_URL=http://127.0.0.1:<port> PREVIEW_PUBLIC_HOST=pocketqa.optijara.ai node scripts/preview/smoke.mjs
//   Public (after DNS):   PREVIEW_URL=https://pocketqa.optijara.ai node scripts/preview/smoke.mjs
// Reads the gate password and demo tester sign-in from .preview/access.txt.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpReq } from 'node:http';
import { request as httpsReq } from 'node:https';
import { join } from 'node:path';

const base = new URL(process.env.PREVIEW_URL ?? '');
const host = process.env.PREVIEW_PUBLIC_HOST ?? base.host;
const access = readFileSync(join(import.meta.dirname, '../../.preview/access.txt'), 'utf8');
const gatePassword = access.match(/^Gate password: (\S+)$/m)?.[1];
const tester = access.match(/^Tester:\s+(\S+)\s+\/\s+(\S+)$/m);
if (!gatePassword || !tester) throw new Error('access.txt is missing the gate password or tester sign-in');

function call(method, path, { headers = {}, body, hostHeader = host } = {}) {
  const req = base.protocol === 'https:' ? httpsReq : httpReq;
  return new Promise((resolve, reject) => {
    const r = req({ hostname: base.hostname, port: base.port || undefined, method, path, servername: base.hostname, headers: { host: hostHeader, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

console.log(`started ${new Date().toISOString()} against ${process.env.PREVIEW_URL}`);
let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
};

// Unauthenticated: nothing but the login page.
check('GET / without gate → 303 /__gate/login', ((r) => r.status === 303 && r.headers.location === '/__gate/login')(await call('GET', '/')));
const idx = readFileSync(join(import.meta.dirname, '../../apps/mobile/dist-preview/index.html'), 'utf8');
const bundle = idx.match(/src="(\/_expo\/[^"]+\.js)"/)?.[1];
console.log(`bundle ${bundle}`);
check('GET app bundle without gate → 303', (await call('GET', bundle)).status === 303);
check('GET /api/health without gate → 401 (gate)', ((r) => r.status === 401 && JSON.parse(r.body).gate === true)(await call('GET', '/api/health')));
check('POST /api/auth/login without gate → 401', (await call('POST', '/api/auth/login', { headers: { 'content-type': 'application/json' }, body: '{}' })).status === 401);
check('GET /__gate/login → 200 with identity marker', ((r) => r.status === 200 && /name="pocketqa-preview" content="gate"/.test(r.body))(await call('GET', '/__gate/login')));
check('wrong gate password → 401, no cookie', ((r) => r.status === 401 && !r.headers['set-cookie'])(await call('POST', '/__gate/login', { headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=not-the-password' })));
if (base.protocol !== 'https:') check('unknown Host → 421', (await call('GET', '/', { hostHeader: 'evil.example' })).status === 421);

// Authenticated.
const login = await call('POST', '/__gate/login', { headers: { 'content-type': 'application/x-www-form-urlencoded', origin: `https://${host}` }, body: new URLSearchParams({ password: gatePassword }).toString() });
const setCookie = login.headers['set-cookie']?.[0] ?? '';
check('gate login → 303 + HttpOnly Secure SameSite=Strict cookie', login.status === 303 && /HttpOnly/.test(setCookie) && /Secure/.test(setCookie) && /SameSite=Strict/.test(setCookie));
const cookie = setCookie.split(';')[0];
check('GET / with gate → 200 app index', ((r) => r.status === 200 && /_expo\/static\/js\/web\/entry-/.test(r.body))(await call('GET', '/', { headers: { cookie } })));
check('GET app bundle with gate → 200', (await call('GET', bundle, { headers: { cookie } })).status === 200);
check('GET /api/health via proxy → 200 ok', ((r) => r.status === 200 && JSON.parse(r.body).ok === true)(await call('GET', '/api/health', { headers: { cookie } })));
const signIn = await call('POST', '/api/auth/login', { headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ email: tester[1], password: tester[2] }) });
check('demo tester app sign-in via proxy → 200', signIn.status === 200);
const token = signIn.status === 200 ? JSON.parse(signIn.body).token : '';
const eligible = await call('GET', '/api/studies/eligible', { headers: { cookie, authorization: `Bearer ${token}` } });
check('tester sees the demo studies (bearer passes through the gate)', eligible.status === 200 && JSON.parse(eligible.body).items.length >= 1);
check('app bearer without gate cookie → still 401 at the gate', (await call('GET', '/api/me', { headers: { authorization: `Bearer ${token}` } })).status === 401);
check('admin self-registration refused by the API', (await call('POST', '/api/auth/register', { headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'x-admin@pocketqa.example', password: randomBytes(18).toString('base64url'), displayName: 'X', role: 'admin' }) })).status === 400);

const upload = await call('POST', '/api/participations/any/evidence', { headers: { cookie, authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}' });
check('evidence upload refused in the shared preview → 403', upload.status === 403 && /preview/.test(JSON.parse(upload.body).message));
check('deleting the shared demo account refused → 403', (await call('DELETE', '/api/me', { headers: { cookie, authorization: `Bearer ${token}` } })).status === 403);
check('encoded path spelling rejected → 400', (await call('POST', '/api/participations/any/%65vidence', { headers: { cookie } })).status === 400);
console.log(`finished ${new Date().toISOString()}`);
console.log(failed ? `${failed} check(s) FAILED` : 'all checks passed');
process.exit(failed ? 1 : 0);
