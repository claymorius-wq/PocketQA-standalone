/** The wallet sent the transaction but the server never recorded the signature. */
export class SentNotRecordedError extends Error {}

/**
 * Reports a signature the wallet has already sent. A failure here doesn't mean nothing
 * happened (the transaction may land on devnet), so it is retried (the server accepts the
 * same signature again idempotently), and the final error names the signature instead of
 * letting the builder think it is safe to send again.
 */
export async function reportSignature(
  submit: () => Promise<unknown>,
  signature: string,
  tries = 3,
  waitMs: (attempt: number) => number = (i) => 1000 * 2 ** i,
): Promise<void> {
  for (let i = 0; ; i += 1) {
    try {
      await submit();
      return;
    } catch (e) {
      if (i + 1 >= tries) {
        // The full signature, so the builder can look it up in the devnet explorer.
        throw new SentNotRecordedError(
          `Your wallet sent the transaction, but Pocket QA could not record it. Check the devnet explorer for signature ${signature} before starting another transfer.`,
          { cause: e },
        );
      }
      await new Promise((r) => setTimeout(r, waitMs(i)));
    }
  }
}
