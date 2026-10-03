/**
 * Plain-language wallet errors. Shapes come from @solana-mobile/mobile-wallet-adapter-protocol
 * 2.3.0: session errors carry a string `code` (the Android module rejects a cancelled
 * association with code "Session not established: Local association cancelled by user"),
 * protocol errors a numeric JSON-RPC code (-1 authorization failed, -2 invalid payloads,
 * -3 not signed, -4 not submitted).
 */
export function walletErrorText(e: unknown): string {
  const err = (e ?? {}) as { code?: string | number; message?: string };
  const code = err.code;
  const text = `${typeof code === 'string' ? code : ''} ${err.message ?? ''}`;
  if (code === 'ERROR_WALLET_NOT_FOUND') return 'No Mobile Wallet Adapter wallet is installed on this device.';
  if (code === -1 || code === -3 || /cancel|declin|not signed|ERROR_SESSION_CLOSED|ERROR_SESSION_TIMEOUT/i.test(text)) {
    return 'The wallet request was declined or closed. Nothing was linked.';
  }
  // Wallet signed but couldn't get the transaction accepted (observed with an unfunded
  // devnet key: RPC preflight -32002, surfaced by the mock wallet as -2).
  if (code === -2 || code === -4) return 'The wallet could not send the transaction (it may have no devnet SOL for fees). Nothing was sent.';
  if (code === 'NONCE_INVALID') return 'The sign-in request expired or was already used. Try again.';
  return err.message || 'Something went wrong.';
}
