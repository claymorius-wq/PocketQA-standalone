import { base58, base64 } from '@scure/base';
import { availableWallets } from './registry';
import { reportSignature } from './reportSignature';
import { checkServerTxPlan, type CheckedPlan, type ServerTxPlan, type SignContext } from './serverTx';
import { connectWallet, disconnectWallet, type StandardWallet } from './standard';

type SignAndSendFeature = {
  signAndSendTransaction(...inputs: { account: unknown; chain: string; transaction: Uint8Array }[]): Promise<readonly { signature: Uint8Array }[]>;
};

/**
 * Web twin of the Android flow: a browser wallet (Wallet Standard) signs and sends the
 * SERVER-BUILT devnet transaction on `solana:devnet`, after the same plan and byte checks; the
 * connected account must be the linked wallet. Each call connects, asks once and disconnects.
 */
export async function signServerTransaction(
  plan: ServerTxPlan,
  ctx: SignContext,
  submit: (signature: string) => Promise<unknown>,
  opts: { wallet?: StandardWallet } = {},
): Promise<{ signature: string; plan: CheckedPlan }> {
  const checked = checkServerTxPlan(plan, ctx);
  const wallet = opts.wallet ?? availableWallets()[0];
  if (!wallet) throw new Error('No Solana wallet extension found. Nothing was sent.');
  let signature: string;
  try {
    const account = await connectWallet(wallet);
    if (account.address !== checked.signer) throw new Error('The wallet account is not your linked devnet wallet. Nothing was sent.');
    const feature = wallet.features['solana:signAndSendTransaction'] as SignAndSendFeature | undefined;
    if (!feature) throw new Error(`${wallet.name} can’t sign and send devnet transactions. Nothing was sent.`);
    const [out] = await feature.signAndSendTransaction({ account, chain: 'solana:devnet', transaction: base64.decode(plan.transactionB64) });
    if (!out) throw new Error('The wallet returned no signature.');
    signature = base58.encode(out.signature);
  } finally {
    await disconnectWallet(wallet);
  }
  await reportSignature(() => submit(signature), signature);
  return { signature, plan: checked };
}
