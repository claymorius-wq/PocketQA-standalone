import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { IdentityError, type IdentityProvider, type VerifiedIdentity } from '../src/identity/types';

/**
 * Deterministic stand-in for Firebase Auth in unit tests: HMAC-signed ID tokens with
 * audience, expiry and issue time, refresh-token revocation, and custom tokens that can
 * only be exchanged (as a client would) and are never valid bearers. The real adapter is
 * exercised against the Firebase Auth emulator separately.
 */
type Claims = { uid: string; email: string | null; email_verified: boolean; provider: string; aud: string; iat: number; exp: number; auth_time: number; [k: string]: unknown };

export class FakeIdentity implements IdentityProvider {
  readonly name = 'firebase' as const;
  private key = randomBytes(32);
  private revokedAt = new Map<string, number>();
  readonly deleted: string[] = [];
  readonly revoked: string[] = [];
  constructor(
    readonly projectId: string,
    private now: () => number,
  ) {}

  private sign(body: string) {
    return createHmac('sha256', this.key).update(body).digest('base64url');
  }

  /** What a client would get after signing in with the provider. */
  idToken(c: Partial<Claims> & { uid: string }): string {
    const iat = Math.floor(this.now() / 1000);
    const claims: Claims = { email: null, email_verified: false, provider: 'password', aud: this.projectId, iat, exp: iat + 3600, auth_time: iat, ...c };
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `fid.${body}.${this.sign(body)}`;
  }

  /**
   * What the client SDK does every hour: a fresh ID token (new iat/exp) that keeps the
   * original sign-in's auth_time, so revocation still applies to it.
   */
  refresh(token: string): string {
    const c = JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString()) as Claims;
    const iat = Math.floor(this.now() / 1000);
    return this.idToken({ ...c, iat, exp: iat + 3600 });
  }

  /** Client-side exchange of a custom token for an ID token (signInWithCustomToken). */
  exchangeCustomToken(custom: string): string {
    const [kind, uid, sig] = custom.split('.');
    if (kind !== 'fct' || !uid || sig !== this.sign(`fct.${uid}`)) throw new Error('bad custom token');
    return this.idToken({ uid: Buffer.from(uid, 'base64url').toString(), provider: 'custom' });
  }

  async verifyIdToken(token: string): Promise<VerifiedIdentity> {
    const [kind, body, sig] = token.split('.');
    if (kind !== 'fid' || !body || !sig) throw new IdentityError('not an ID token');
    const want = Buffer.from(this.sign(body));
    const got = Buffer.from(sig);
    if (want.length !== got.length || !timingSafeEqual(want, got)) throw new IdentityError('bad signature');
    const c = JSON.parse(Buffer.from(body, 'base64url').toString()) as Claims;
    if (c.aud !== this.projectId) throw new IdentityError('wrong audience');
    if (c.exp * 1000 <= this.now()) throw new IdentityError('expired');
    // Firebase semantics: revocation sets validSince to the current *second*, and a token
    // is revoked only if its auth_time (seconds) is strictly earlier. Same-second tokens
    // survive provider revocation, which is why the API also keeps its own valid_after.
    const revoked = this.revokedAt.get(c.uid);
    if (revoked !== undefined && c.auth_time < Math.floor(revoked / 1000)) throw new IdentityError('revoked');
    return { uid: c.uid, email: c.email, emailVerified: c.email_verified, signInProvider: c.provider, authTimeMs: c.auth_time * 1000 };
  }

  async createCustomToken(uid: string) {
    const u = Buffer.from(uid).toString('base64url');
    return `fct.${u}.${this.sign(`fct.${u}`)}`;
  }

  async revokeSessions(uid: string) {
    this.revoked.push(uid);
    this.revokedAt.set(uid, this.now());
  }

  async deleteUser(uid: string) {
    this.deleted.push(uid);
  }
}
