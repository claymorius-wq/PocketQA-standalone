import type { SiwsInput } from '@pocket-qa/contracts';

/**
 * Solana Wallet Standard (browser wallets), ADR 0005 §4. Structural types so this module
 * has no runtime dependency on a wallet; discovery uses @wallet-standard/app on web.
 * - Login: `solana:signIn` with the server's challenge fields only. The wallet builds the
 *   SIWS text and can compare its domain with the requesting page. No signMessage fallback.
 * - Account linking (already signed in): `solana:signMessage` over the server's link text.
 * Nothing here ever asks a wallet to sign or send a transaction.
 */
export type StandardAccount = { address: string; publicKey: Uint8Array; chains: readonly string[]; features: readonly string[] };
export type StandardWallet = {
  name: string;
  icon: string;
  chains: readonly string[];
  features: Record<string, unknown>;
  accounts: readonly StandardAccount[];
};
type ConnectFeature = { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly StandardAccount[] }> };
type SignInFeature = { signIn(...inputs: SiwsInput[]): Promise<readonly { account: StandardAccount; signedMessage: Uint8Array; signature: Uint8Array }[]> };
type DisconnectFeature = { disconnect(): Promise<void> };
type SignMessageFeature = { signMessage(...inputs: { account: StandardAccount; message: Uint8Array }[]): Promise<readonly { signedMessage: Uint8Array; signature: Uint8Array }[]> };

const DEVNET = 'solana:devnet';

export class WalletUnsupported extends Error {}

/** Wallets that can connect and work on Solana devnet. */
export function solanaWallets(registered: readonly StandardWallet[]): StandardWallet[] {
  return registered.filter((w) => w.chains.includes(DEVNET) && !!w.features['standard:connect']);
}

export async function connectWallet(w: StandardWallet): Promise<StandardAccount> {
  const { accounts } = await (w.features['standard:connect'] as ConnectFeature).connect();
  const account = accounts.find((a) => a.chains.includes(DEVNET)) ?? accounts[0];
  if (!account) throw new Error('The wallet did not share an account.');
  return account;
}

/**
 * Pocket QA keeps no wallet connection: each flow connects, asks for one signature and
 * disconnects. A wallet without `standard:disconnect` is simply left as it is.
 */
export async function disconnectWallet(w: StandardWallet): Promise<void> {
  await (w.features['standard:disconnect'] as DisconnectFeature | undefined)?.disconnect().catch(() => {});
}

export async function signInWithWallet(w: StandardWallet, input: SiwsInput) {
  const feature = w.features['solana:signIn'] as SignInFeature | undefined;
  if (!feature) throw new WalletUnsupported(`${w.name} doesn’t support Sign In With Solana, so it can’t be used to sign in. Use email or Google, or a wallet that supports it.`);
  const [out] = await feature.signIn(input);
  if (!out) throw new Error('The wallet returned no sign-in.');
  if (out.account.address !== input.address) throw new Error('The wallet signed with a different account than the one it connected.');
  return { address: out.account.address, signedMessage: out.signedMessage, signature: out.signature };
}

export async function signMessageWithWallet(w: StandardWallet, account: StandardAccount, message: Uint8Array) {
  const feature = w.features['solana:signMessage'] as SignMessageFeature | undefined;
  if (!feature) throw new WalletUnsupported(`${w.name} can’t sign messages, so it can’t be linked.`);
  const [out] = await feature.signMessage({ account, message });
  if (!out) throw new Error('The wallet returned no signature.');
  return out;
}
