import { beforeAll, describe, expect, it } from 'vitest';
import { clearEmulator, emulatorFirestore, PROJECT } from './fs';

// firestore.rules is deny-all (plan §4): no browser or app client ever reads or writes Firestore;
// only the API does, with the Admin SDK. Checked against the emulator's rules engine over REST,
// as an anonymous caller and as a signed-in Firebase user, for the sensitive collections
// (pqa-qa freeze r1 P3-2). The admin control proves the documents exist, so a denial is the rules
// and not a missing document.
const HOST = process.env.FIRESTORE_EMULATOR_HOST!;
const BASE = `http://${HOST}/v1/projects/${PROJECT}/databases/(default)/documents`;
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** An unsigned ID token: the emulator accepts it as a signed-in user (production would also verify the signature). */
const userToken = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'u-client', user_id: 'u-client', iss: `https://securetoken.google.com/${PROJECT}`, aud: PROJECT, iat: 1, exp: 4_102_444_800, email: 'c@example.test', email_verified: true, firebase: { sign_in_provider: 'password' } })}.`;
const COLLECTIONS = ['users', 'identities', 'sessions', 'evidence', 'participations', 'ledger', 'audit', 'idempotency', 'storageObjects'];

const callers: [string, Record<string, string>][] = [
  ['anonymous', {}],
  ['a signed-in Firebase user', { authorization: `Bearer ${userToken}` }],
];

beforeAll(async () => {
  await clearEmulator();
  const fs = emulatorFirestore();
  await Promise.all(COLLECTIONS.map((c) => fs.collection(c).doc('d1').set({ secret: 'server only' })));
});

describe('firestore.rules denies every client', () => {
  it('control: the admin can read the seeded documents', async () => {
    const res = await fetch(`${BASE}/users/d1`, { headers: { authorization: 'Bearer owner' } });
    expect(res.status).toBe(200);
  });

  describe.each(callers)('%s', (_who, headers) => {
    it.each(COLLECTIONS)('cannot get, list, create, update or delete in %s', async (c) => {
      const statuses = await Promise.all([
        fetch(`${BASE}/${c}/d1`, { headers }),
        fetch(`${BASE}/${c}`, { headers }),
        fetch(`${BASE}/${c}?documentId=d2`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ fields: { x: { stringValue: 'y' } } }) }),
        fetch(`${BASE}/${c}/d1`, { method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ fields: { secret: { stringValue: 'changed' } } }) }),
        fetch(`${BASE}/${c}/d1`, { method: 'DELETE', headers }),
      ]).then((rs) => rs.map((r) => r.status));
      expect(statuses).toEqual([403, 403, 403, 403, 403]);
    });
  });

  it('nothing a client tried changed the data', async () => {
    const fs = emulatorFirestore();
    for (const c of COLLECTIONS) {
      expect((await fs.collection(c).doc('d1').get()).data()).toEqual({ secret: 'server only' });
      expect((await fs.collection(c).doc('d2').get()).exists).toBe(false);
    }
  });
});
