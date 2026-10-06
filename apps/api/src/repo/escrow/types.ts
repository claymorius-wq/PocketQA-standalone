/**
 * Escrow repository (owner: pqa-be3, see ../index.ts): wallet links and nonces, wallet login,
 * devnet demo transfers, escrow, settlements, the simulated chain and reputation. Intent-level
 * async operations only; rows keep today's SQLite shapes.
 */

/** A user's linked devnet wallet (`wallet_links`; Firestore `walletLinks/{userId}`). */
export type WalletLink = { address: string; linkedAt: string };

export interface EscrowRepo {
  /** The user's linked wallet, or null. Read by the core `userView`. */
  walletLinkOf(userId: string): Promise<WalletLink | null>;
}
