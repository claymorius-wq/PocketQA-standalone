import { appIdentityUri, DEVNET_DEMO_LAMPORTS, SOLANA_DEVNET_CHAIN, SOLANA_DEVNET_GENESIS_HASH, WALLET_NONCE_TTL_SECONDS, type DevnetTransfer, type SiwsInput } from '@pocket-qa/contracts';
import { verifyTransfer, verifyWalletLink } from '@pocket-qa/domain';
import { ownerParticipation, partyParticipation } from '../access';
import { me, type Ctx, type Handler } from '../context';
import { fail, iso, newId, newNonce, notFound } from '../util';
import type { TransferRow } from '../repo/escrow/types';
import { userView } from '../views';

const TRANSFER_INTENT_TTL_MS = 10 * 60 * 1000;
const TRANSFER_CONFIRM_WINDOW_MS = 3 * 60 * 1000;

function transferView(r: TransferRow): DevnetTransfer {
  return {
    id: r.id,
    participationId: r.participation_id,
    sender: r.sender,
    recipient: r.recipient,
    lamports: r.lamports,
    signature: r.signature,
    status: r.status,
    failureReason: r.failure_reason,
    cluster: 'devnet',
    explorerUrl: r.signature ? `https://explorer.solana.com/tx/${r.signature}?cluster=devnet` : null,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    verifiedAt: r.verified_at,
  };
}

const b64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));

/** Chain features are refused unless the configured RPC really is devnet. */
async function assertDevnet(ctx: Ctx): Promise<string> {
  let genesis: string;
  try {
    genesis = await ctx.deps.rpc.getGenesisHash();
  } catch {
    throw fail('CHAIN_UNAVAILABLE', 'Solana devnet RPC is unreachable.');
  }
  if (genesis !== SOLANA_DEVNET_GENESIS_HASH) throw fail('CHAIN_UNAVAILABLE', 'The configured RPC is not Solana devnet.');
  return genesis;
}

async function reverify(ctx: Ctx, row: TransferRow): Promise<TransferRow> {
  const repo = ctx.deps.repo.escrow;
  const now = ctx.deps.now();
  if (row.status === 'awaiting_signature' && now > Date.parse(row.expires_at)) {
    return repo.expireTransfer(row.id, 'No signature was submitted in time.');
  }
  if (row.status !== 'pending' || !row.signature) return row;
  const genesis = await assertDevnet(ctx);
  let tx;
  try {
    tx = await ctx.deps.rpc.getTransaction(row.signature);
  } catch {
    return row; // RPC hiccup: stay pending, never guess.
  }
  const verdict = verifyTransfer({
    expected: {
      sender: row.sender,
      recipient: row.recipient,
      lamports: row.lamports,
      signature: row.signature,
      createdAtMs: Date.parse(row.created_at),
      expiresAtMs: Date.parse(row.expires_at),
    },
    tx,
    genesisHash: genesis,
    nowMs: now,
  });
  if (verdict.status !== 'pending') {
    return repo.recordTransferVerdict(row.id, { status: verdict.status, reason: verdict.reason, verifiedAt: verdict.status === 'confirmed' ? iso(now) : null });
  }
  return (await repo.transferById(row.id))!;
}

/** Devnet demo transfers are a development feature; production never offers them. */
function devnetTransfersOn(ctx: Ctx) {
  if (!ctx.deps.config.features.devnetTransfers) throw fail('FEATURE_UNAVAILABLE', 'Devnet demo transfers aren’t available on this deployment.');
}

export const walletHandlers = {
  walletNonce: async (ctx) => {
    const user = me(ctx);
    const now = ctx.deps.now();
    const nonce = newNonce();
    // Web: the real origin, so a wallet's SIWS domain check matches the page. MWA (Android):
    // the fixed app identity domain the MWA identity URI is derived from.
    let domain = ctx.deps.config.siwsDomain;
    let uri = appIdentityUri(domain);
    if (ctx.body.surface === 'web') {
      const origin = ctx.deps.config.publicOrigin;
      if (!origin) throw fail('CONFLICT_STATE', 'Web wallet linking needs the app’s public origin to be configured (POCKETQA_PUBLIC_ORIGIN).');
      domain = new URL(origin).host;
      uri = origin;
    }
    const input: SiwsInput = {
      domain,
      address: ctx.body.address,
      statement: 'Link this devnet wallet to your Pocket QA account. This is not a payment.',
      uri,
      version: '1',
      chainId: SOLANA_DEVNET_CHAIN,
      nonce,
      issuedAt: iso(now),
      expirationTime: iso(now + WALLET_NONCE_TTL_SECONDS * 1000),
    };
    await ctx.deps.repo.escrow.createLinkNonce({ nonce, userId: user.id, address: ctx.body.address, inputJson: JSON.stringify(input), expiresAtMs: now + WALLET_NONCE_TTL_SECONDS * 1000 });
    return { input };
  },

  walletLink: async (ctx) => {
    const user = me(ctx);
    const now = ctx.deps.now();
    const { address, nonce, signedMessage, signature } = ctx.body;
    const outcome = await ctx.deps.repo.escrow.linkWallet({
      userId: user.id,
      address,
      nonce,
      nowMs: now,
      verify: (record) => verifyWalletLink({ record, request: { userId: user.id, address, nonce, signedMessage: b64(signedMessage), signature: b64(signature) }, nowMs: now }),
    });
    if (outcome) throw outcome;
    return userView(ctx.deps.db, user);
  },

  walletUnlink: async (ctx) => {
    const user = me(ctx);
    // Never remove the last way in: a wallet-only account needs a password or a verified
    // email/Google sign-in first (ADR 0005 §2).
    if (!(await ctx.deps.repo.escrow.unlinkWallet({ id: user.id, hasPassword: !!user.password_hash }))) {
      throw fail('CONFLICT_STATE', 'Add an email or Google sign-in before removing your only sign-in method.');
    }
    return userView(ctx.deps.db, user);
  },

  createTransfer: async (ctx) => {
    devnetTransfersOn(ctx);
    const user = me(ctx);
    const repo = ctx.deps.repo.escrow;
    await assertDevnet(ctx);
    const { p } = ownerParticipation(ctx.deps.db, ctx.body.participationId, user);
    if (p.status !== 'approved' && p.status !== 'resolved') throw fail('CONFLICT_STATE', 'Demo transfers are only for approved work.');
    const sender = await repo.walletLinkOf(user.id);
    const recipient = await repo.walletLinkOf(p.tester_id);
    if (!sender) throw fail('CONFLICT_STATE', 'Link your devnet wallet first.');
    if (!recipient) throw fail('CONFLICT_STATE', 'The tester has not linked a devnet wallet.');
    const now = ctx.deps.now();
    const row = await repo.createTransfer({
      id: newId(),
      participation_id: p.id,
      builder_id: user.id,
      tester_id: p.tester_id,
      sender: sender.address,
      recipient: recipient.address,
      lamports: DEVNET_DEMO_LAMPORTS,
      created_at: iso(now),
      expires_at: iso(now + TRANSFER_INTENT_TTL_MS),
    });
    if (!row) throw fail('CONFLICT_STATE', 'A demo transfer for this participation already exists.');
    return transferView(row);
  },

  submitTransferSignature: async (ctx) => {
    devnetTransfersOn(ctx);
    const user = me(ctx);
    const repo = ctx.deps.repo.escrow;
    const row = await repo.builderTransfer(ctx.params.id!, user.id);
    if (!row) throw notFound('Transfer');
    // Idempotent for the same signature: the app retries when a response is lost, and
    // must not be told "not recorded" for a report the server already holds.
    if (row.signature && row.signature === ctx.body.signature) return transferView(await reverify(ctx, row));
    const fresh = await reverify(ctx, row);
    if (fresh.status !== 'awaiting_signature') throw fail('CONFLICT_STATE', `Transfer is ${fresh.status}.`);
    const pending = await repo.attachTransferSignature(row.id, ctx.body.signature, iso(ctx.deps.now() + TRANSFER_CONFIRM_WINDOW_MS));
    if (!pending) throw fail('CONFLICT_STATE', 'This signature was already used for another transfer.');
    return transferView(await reverify(ctx, pending));
  },

  participationTransfers: async (ctx) => {
    const { p } = partyParticipation(ctx.deps.db, ctx.params.id!, me(ctx));
    const rows = await ctx.deps.repo.escrow.transfersOf(p.id);
    // Re-verify pending ones so every viewer sees the chain's answer, not a stale claim.
    const fresh: TransferRow[] = [];
    for (const r of rows) fresh.push(r.status === 'pending' || r.status === 'awaiting_signature' ? await reverify(ctx, r).catch(() => r) : r);
    return { items: fresh.map(transferView) };
  },

  transferBlockhash: async (ctx) => {
    devnetTransfersOn(ctx);
    const user = me(ctx);
    const row = await ctx.deps.repo.escrow.builderTransfer(ctx.params.id!, user.id);
    if (!row) throw notFound('Transfer');
    await assertDevnet(ctx);
    try {
      return await ctx.deps.rpc.getLatestBlockhash();
    } catch {
      throw fail('CHAIN_UNAVAILABLE', 'Solana devnet RPC is unreachable.');
    }
  },

  getTransfer: async (ctx) => {
    const user = me(ctx);
    const row = await ctx.deps.repo.escrow.transferById(ctx.params.id!);
    if (!row) throw notFound('Transfer');
    try {
      partyParticipation(ctx.deps.db, row.participation_id, user);
    } catch {
      throw notFound('Transfer');
    }
    return transferView(await reverify(ctx, row));
  },
} satisfies Record<string, Handler>;
