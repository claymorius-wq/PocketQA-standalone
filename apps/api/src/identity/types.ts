/**
 * Managed identity (ADR 0005). The provider only proves who is calling; the API keeps its
 * own users, roles and statuses, so nothing in a token (claims included) grants a role.
 */
export type VerifiedIdentity = {
  /** Provider UID; mapped to the internal user id through `identities`. */
  uid: string;
  email: string | null;
  emailVerified: boolean;
  /** e.g. 'password', 'google.com', 'custom' (wallet login). */
  signInProvider: string;
  authTimeMs: number;
};

export interface IdentityProvider {
  readonly name: 'firebase';
  /** Verifies a provider ID token, including revocation. Throws IdentityError otherwise. */
  verifyIdToken(token: string): Promise<VerifiedIdentity>;
  /** Mints a custom token for `uid` (wallet login). Never accepted as an API bearer. */
  createCustomToken(uid: string): Promise<string>;
  /** Revokes refresh tokens, so ID tokens issued before now fail verification. */
  revokeSessions(uid: string): Promise<void>;
  /** Deletes the provider user; a user that no longer exists is not an error. */
  deleteUser(uid: string): Promise<void>;
}

export class IdentityError extends Error {}

/**
 * Sign-in providers accepted for creating or recovering an account (email/password and
 * Google). Others are refused until reviewed; 'custom' is wallet login only.
 */
export const RECOVERABLE_PROVIDERS = new Set(['password', 'google.com']);

/** A sign-in that proves control of a real, verified email through an accepted provider. */
export const isRecoverableSignIn = (id: VerifiedIdentity) => RECOVERABLE_PROVIDERS.has(id.signInProvider) && id.emailVerified;
