import { isDeepStrictEqual } from 'node:util';
import { base58 } from '@scure/base';
import type { Connection, VersionedTransaction } from '@solana/web3.js';

/**
 * The single send of the run 1 completion (pqa-qa harness delta r1, P2-1 and P2-2), separated so it
 * is tested offline. Only Squads' own refusal of an already-executed proposal counts as the
 * expected result; any other error is a failure of its own kind. The signature is known and
 * recorded before broadcasting, so no exception after an attempt can read as "nothing was sent":
 * from then on, anything unproven is `unknown`, with the signature to inspect.
 */
/** Squads `InvalidProposalStatus` on the execute instruction (index 0). */
export const EXPECTED_REFUSAL = { InstructionError: [0, { Custom: 6008 }] };

export type Outcome = 'incomplete' | 'refused-as-expected' | 'unexpected-error' | 'NOT-refused' | 'unknown';
export type SendRecord = { signature: string; state: 'pending' | 'landed'; slot: number | null; confirmation: string; err: unknown; feeLamports: number | null; explorer: string };
export type CompletionRecord = { send: SendRecord | null; outcome: Outcome; reason: string | null };

type Conn = Pick<Connection, 'sendTransaction' | 'getSignatureStatuses' | 'getTransaction'>;

export async function sendAndClassify(conn: Conn, tx: VersionedTransaction, out: CompletionRecord, opts: { polls?: number; sleep?: (ms: number) => Promise<void> } = {}) {
  const polls = opts.polls ?? 45;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  // The signature exists once the transaction is signed: record it before anything leaves.
  const first = tx.signatures[0];
  if (!first || first.every((b) => b === 0)) throw new Error('the transaction must be signed before it is sent');
  const signature = base58.encode(first);
  out.send = { signature, state: 'pending', slot: null, confirmation: 'not read', err: null, feeLamports: null, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet` };
  out.outcome = 'unknown';
  out.reason = 'Sent or possibly sent; not yet verified on chain.';
  try {
    await conn.sendTransaction(tx, { skipPreflight: true, maxRetries: 5 });
    // Finalized status read directly (paced, bounded), never inferred from a confirm rejection.
    let st = null;
    for (let i = 0; i < polls && st?.confirmationStatus !== 'finalized'; i++) {
      await sleep(2000);
      st = (await conn.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
    }
    if (st?.confirmationStatus !== 'finalized') {
      out.send.confirmation = st?.confirmationStatus ?? 'not found';
      out.reason = `Not finalized after ${polls} status reads; inspect the chain, never retry blindly.`;
      return out;
    }
    const landed = await conn.getTransaction(signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    Object.assign(out.send, { state: 'landed', slot: st.slot, confirmation: 'finalized', err: st.err ?? null, feeLamports: landed?.meta?.fee ?? null });
    if (isDeepStrictEqual(st.err, EXPECTED_REFUSAL)) {
      out.outcome = 'refused-as-expected';
      out.reason = null;
    } else if (st.err) {
      out.outcome = 'unexpected-error';
      out.reason = `Finalized with an error other than Squads InvalidProposalStatus (6008): ${JSON.stringify(st.err)}.`;
    } else {
      out.outcome = 'NOT-refused';
      out.reason = 'Finalized WITHOUT error: the second execute was not refused.';
    }
    return out;
  } catch (e) {
    out.outcome = 'unknown';
    out.reason = `Exception after the send attempt (${e instanceof Error ? e.message : JSON.stringify(e)}); inspect ${signature} on chain, never retry blindly.`;
    return out;
  }
}

/** The receipt line for the send: "Nothing was sent." only when no send was ever attempted. */
export function sendLine(out: CompletionRecord) {
  if (!out.send) return 'Nothing was sent (stopped before the send).';
  const s = out.send;
  return `Send ${s.state}: [${s.signature.slice(0, 12)}…](${s.explorer}), slot ${s.slot ?? 'unknown'}, ${s.confirmation}, err \`${JSON.stringify(s.err)}\`, fee ${s.feeLamports ?? 'unknown'} lamports.`;
}
