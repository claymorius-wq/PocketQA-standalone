import { appIdentityUri, SOLANA_DEVNET_CHAIN, WALLET_NONCE_TTL_SECONDS, type SiwsInput } from '@pocket-qa/contracts';
import { verifyWalletLogin } from '@pocket-qa/domain';
import type { Ctx, Handler } from '../context';
import { RateLimiter } from '../rateLimit';
import { fail, iso, newId, newNonce } from '../util';
import { userView } from '../views';
import { issueSession } from './account';

// Per process (see rateLimit.ts). The address limit is keyed by address *and* client, so
// nobody can lock a wallet's owner out by asking for challenges from elsewhere; the
// per-client cap bounds how many challenges one client can create overall.
const perAddressClient = new RateLimiter(5, 60_000);
const perClient = new RateLimiter(30, 60_000);
const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

function assertEnabled(ctx: Ctx) {
  if (!ctx.deps.config.walletLogin) throw fail('CONFLICT_STATE', 'Wallet sign-in is not enabled on this deployment.');
}

function limit(ctx: Ctx, address: string) {
  const now = ctx.deps.now();
  if (!perClient.take(`ip:${ctx.req.ip}`, now) || !perAddressClient.take(`addr:${address}|ip:${ctx.req.ip}`, now)) {
    throw fail('RATE_LIMITED', 'Too many wallet sign-in attempts. Try again in a minute.');
  }
}

export const walletLoginHandlers = {
  walletLoginChallenge: async (ctx) => {
    assertEnabled(ctx);
    const { address } = ctx.body;
    limit(ctx, address);
    const now = ctx.deps.now();
    const nonce = newNonce();
    // Web: bound to the deployment's real origin, so a solana:signIn wallet can compare it
    // with the page it is asked from (ADR 0005 §2). MWA (Android): bound to the app identity
    // the app declares to the wallet (docs/production/wallet-login-design.md). The stored
    // input is what verification rebuilds, so a signature for one surface fails the other.
    const origin = ctx.deps.config.publicOrigin!;
    const mwa = ctx.body.surface === 'mwa';
    const domain = mwa ? ctx.deps.config.siwsDomain : new URL(origin).host;
    const uri = mwa ? appIdentityUri(domain) : origin;
    const statement = mwa
      ? 'Sign in to Pocket QA in the Pocket QA Android app with this devnet wallet. Only sign this in the Pocket QA Android app, never on a website. This is not a payment and sends nothing.'
      : `Sign in to Pocket QA at ${origin} with this devnet wallet. Only sign this on ${domain}. This is not a payment and sends nothing.`;
    const input: SiwsInput = {
      domain,
      address,
      statement,
      uri,
      version: '1',
      chainId: SOLANA_DEVNET_CHAIN,
      nonce,
      issuedAt: iso(now),
      expirationTime: iso(now + WALLET_NONCE_TTL_SECONDS * 1000),
    };
    await ctx.deps.repo.escrow.createLoginChallenge({ nonce, address, inputJson: JSON.stringify(input), expiresAtMs: now + WALLET_NONCE_TTL_SECONDS * 1000, nowMs: now });
    return { input };
  },

  walletLogin: async (ctx) => {
    assertEnabled(ctx);
    const now = ctx.deps.now();
    const { address, nonce, signedMessage, signature, newAccount } = ctx.body;
    const result = await ctx.deps.repo.escrow.walletLogin({
      address,
      nonce,
      nowMs: now,
      verify: (record) => verifyWalletLogin({ record, request: { address, nonce, signedMessage: b64(signedMessage), signature: b64(signature) }, nowMs: now }),
      newAccount: newAccount ? { id: newId(), displayName: newAccount.displayName, role: newAccount.role } : null,
      firebase: ctx.deps.config.authMode === 'firebase',
    });
    if ('error' in result) throw result.error;
    const signedIn = result.user;
    const session =
      ctx.deps.config.authMode === 'local'
        ? { kind: 'local' as const, token: (await issueSession(ctx, signedIn)).token }
        : { kind: 'firebase_custom_token' as const, customToken: await ctx.deps.identity!.createCustomToken(result.subject!) };
    return { user: userView(ctx.deps.db, signedIn), session };
  },
} satisfies Record<string, Handler>;
