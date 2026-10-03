import { appIdentityUri, DEVNET_DEMO_LAMPORTS, SOLANA_DEVNET_CHAIN, SOLANA_DEVNET_GENESIS_HASH, WALLET_NONCE_TTL_SECONDS, type DevnetTransfer, type SiwsInput } from '@pocket-qa/contracts';
import { type DomainError, verifyTransfer, verifyWalletLink, type NonceRecord } from '@pocket-qa/domain';
import { ownerParticipation, partyParticipation } from '../access';
import { me, type Ctx, type Handler } from '../context';
import { fail, iso, newId, newNonce, notFound } from '../util';
import { userView } from '../views';

const TRANSFER_INTENT_TTL_MS = 10 * 60 * 1000;
const TRANSFER_CONFIRM_WINDOW_MS = 3 * 60 * 1000;

type TransferRow = {
  id: string;
  participation_id: string;
  builder_id: string;
  tester_id: string;
  sender: string;
  recipient: string;
  lamports: number;
  signature: string | null;
  status: DevnetTransfer['status'];
  failure_reason: string | null;
  created_at: string;
  expires_at: string;
  verified_at: string | null;
};

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
  const db = ctx.deps.db;
  const now = ctx.deps.now();
  if (row.status === 'awaiting_signature' && now > Date.parse(row.expires_at)) {
    db.prepare(`UPDATE devnet_transfers SET status = 'expired', failure_reason = ? WHERE id = ?`).run('No signature was submitted in time.', row.id);
    return db.prepare('SELECT * FROM devnet_transfers WHERE id = ?').get(row.id) as TransferRow;
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
    db.prepare('UPDATE devnet_transfers SET status = ?, failure_reason = ?, verified_at = ? WHERE id = ?').run(
      verdict.status,
      verdict.reason,
      verdict.status === 'confirmed' ? iso(now) : null,
      row.id,
    );
  }
  return db.prepare('SELECT * FROM devnet_transfers WHERE id = ?').get(row.id) as TransferRow;
}

export const walletHandlers = {
  walletNonce: (ctx) => {
    const user = me(ctx);
    const now = ctx.deps.now();
    const nonce = newNonce();
    const domain = ctx.deps.config.siwsDomain;
    const input: SiwsInput = {
      domain,
      address: ctx.body.address,
      statement: 'Link this devnet wallet to your Pocket QA account. This is not a payment.',
      uri: appIdentityUri(domain),
      version: '1',
      chainId: SOLANA_DEVNET_CHAIN,
      nonce,
      issuedAt: iso(now),
      expirationTime: iso(now + WALLET_NONCE_TTL_SECONDS * 1000),
    };
    ctx.deps.db
      .prepare('INSERT INTO wallet_nonces (nonce, user_id, address, input_json, expires_at, used_at) VALUES (?,?,?,?,?,NULL)')
      .run(nonce, user.id, ctx.body.address, JSON.stringify(input), now + WALLET_NONCE_TTL_SECONDS * 1000);
    return { input };
  },

  walletLink: (ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    const now = ctx.deps.now();
    const { address, nonce, signedMessage, signature } = ctx.body;
    let outcome: DomainError | null = null;
    db.transaction(() => {
      const row = db.prepare('SELECT * FROM wallet_nonces WHERE nonce = ?').get(nonce) as
        | { nonce: string; user_id: string; address: string; input_json: string; expires_at: number; used_at: number | null }
        | undefined;
      const record: NonceRecord | null = row
        ? { userId: row.user_id, address: row.address, nonce: row.nonce, input: JSON.parse(row.input_json), expiresAtMs: row.expires_at, usedAtMs: row.used_at }
        : null;
      // Burn the nonce on any attempt by its owner, successful or not (single use).
      if (row && row.user_id === user.id && row.used_at === null) {
        db.prepare('UPDATE wallet_nonces SET used_at = ? WHERE nonce = ?').run(now, nonce);
      }
      try {
        verifyWalletLink({ record, request: { userId: user.id, address, nonce, signedMessage: b64(signedMessage), signature: b64(signature) }, nowMs: now });
      } catch (e) {
        outcome = e as DomainError;
        return; // keep the burn committed
      }
      const owner = db.prepare('SELECT user_id FROM wallet_links WHERE address = ?').get(address) as { user_id: string } | undefined;
      if (owner && owner.user_id !== user.id) {
        outcome = fail('CONFLICT_STATE', 'This wallet is already linked to another account.');
        return;
      }
      db.prepare('INSERT INTO wallet_links (user_id, address, linked_at) VALUES (?,?,?) ON CONFLICT (user_id) DO UPDATE SET address = excluded.address, linked_at = excluded.linked_at').run(
        user.id,
        address,
        iso(now),
      );
    })();
    if (outcome) throw outcome;
    return userView(db, user);
  },

  walletUnlink: (ctx) => {
    const user = me(ctx);
    // Never remove the last way in: a wallet-only account needs a password or a verified
    // email/Google sign-in first (ADR 0005 §2).
    const recoverable = ctx.deps.db.prepare(`SELECT 1 FROM identities WHERE user_id = ? AND has_recovery = 1`).get(user.id);
    if (!user.password_hash && !recoverable) {
      throw fail('CONFLICT_STATE', 'Add an email or Google sign-in before removing your only sign-in method.');
    }
    ctx.deps.db.prepare('DELETE FROM wallet_links WHERE user_id = ?').run(user.id);
    return userView(ctx.deps.db, user);
  },

  createTransfer: async (ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    await assertDevnet(ctx);
    const { p } = ownerParticipation(db, ctx.body.participationId, user);
    if (p.status !== 'approved' && p.status !== 'resolved') throw fail('CONFLICT_STATE', 'Demo transfers are only for approved work.');
    const sender = db.prepare('SELECT address FROM wallet_links WHERE user_id = ?').get(user.id) as { address: string } | undefined;
    const recipient = db.prepare('SELECT address FROM wallet_links WHERE user_id = ?').get(p.tester_id) as { address: string } | undefined;
    if (!sender) throw fail('CONFLICT_STATE', 'Link your devnet wallet first.');
    if (!recipient) throw fail('CONFLICT_STATE', 'The tester has not linked a devnet wallet.');
    const now = ctx.deps.now();
    const id = newId();
    try {
      db.prepare(
        `INSERT INTO devnet_transfers (id, participation_id, builder_id, tester_id, sender, recipient, lamports, status, created_at, expires_at)
         VALUES (?,?,?,?,?,?,?,'awaiting_signature',?,?)`,
      ).run(id, p.id, user.id, p.tester_id, sender.address, recipient.address, DEVNET_DEMO_LAMPORTS, iso(now), iso(now + TRANSFER_INTENT_TTL_MS));
    } catch {
      throw fail('CONFLICT_STATE', 'A demo transfer for this participation already exists.');
    }
    return transferView(db.prepare('SELECT * FROM devnet_transfers WHERE id = ?').get(id) as TransferRow);
  },

  submitTransferSignature: async (ctx) => {
    const user = me(ctx);
    const db = ctx.deps.db;
    const row = db.prepare('SELECT * FROM devnet_transfers WHERE id = ? AND builder_id = ?').get(ctx.params.id!, user.id) as TransferRow | undefined;
    if (!row) throw notFound('Transfer');
    // Idempotent for the same signature: the app retries when a response is lost, and
    // must not be told "not recorded" for a report the server already holds.
    if (row.signature && row.signature === ctx.body.signature) return transferView(await reverify(ctx, row));
    const fresh = await reverify(ctx, row);
    if (fresh.status !== 'awaiting_signature') throw fail('CONFLICT_STATE', `Transfer is ${fresh.status}.`);
    try {
      db.prepare(`UPDATE devnet_transfers SET signature = ?, status = 'pending', expires_at = ? WHERE id = ? AND status = 'awaiting_signature'`).run(
        ctx.body.signature,
        iso(ctx.deps.now() + TRANSFER_CONFIRM_WINDOW_MS),
        row.id,
      );
    } catch {
      throw fail('CONFLICT_STATE', 'This signature was already used for another transfer.');
    }
    const pending = db.prepare('SELECT * FROM devnet_transfers WHERE id = ?').get(row.id) as TransferRow;
    return transferView(await reverify(ctx, pending));
  },

  participationTransfers: async (ctx) => {
    const db = ctx.deps.db;
    const { p } = partyParticipation(db, ctx.params.id!, me(ctx));
    const rows = db.prepare('SELECT * FROM devnet_transfers WHERE participation_id = ? ORDER BY created_at DESC').all(p.id) as TransferRow[];
    // Re-verify pending ones so every viewer sees the chain's answer, not a stale claim.
    const fresh: TransferRow[] = [];
    for (const r of rows) fresh.push(r.status === 'pending' || r.status === 'awaiting_signature' ? await reverify(ctx, r).catch(() => r) : r);
    return { items: fresh.map(transferView) };
  },

  transferBlockhash: async (ctx) => {
    const user = me(ctx);
    const row = ctx.deps.db.prepare('SELECT * FROM devnet_transfers WHERE id = ? AND builder_id = ?').get(ctx.params.id!, user.id) as TransferRow | undefined;
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
    const db = ctx.deps.db;
    const row = db.prepare('SELECT * FROM devnet_transfers WHERE id = ?').get(ctx.params.id!) as TransferRow | undefined;
    if (!row) throw notFound('Transfer');
    try {
      partyParticipation(db, row.participation_id, user);
    } catch {
      throw notFound('Transfer');
    }
    return transferView(await reverify(ctx, row));
  },
} satisfies Record<string, Handler>;
