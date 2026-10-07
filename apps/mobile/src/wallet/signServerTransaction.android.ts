// Android-only (not .native): MWA's native module doesn't exist on iOS and loading it there crashes.
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol';
import { base58 } from '@scure/base';
import { appIdentityUri, DEFAULT_SIWS_DOMAIN, SOLANA_DEVNET_CHAIN } from '@pocket-qa/contracts';
import { reportSignature } from './reportSignature';
import { checkServerTxPlan, type CheckedPlan, type ServerTxPlan, type SignContext } from './serverTx';
import { decodeWalletBase64 } from './signature';

/**
 * Devnet pilot: asks the builder's wallet (MWA) to sign and send a SERVER-BUILT transaction
 * (escrow funding, or the builder's Squads approval), then reports the signature through `submit`.
 * The plan and the bytes are checked first (serverTx.ts); the wallet is authorized on devnet and
 * must be the linked wallet. The server never trusts the signature: it reads the chain.
 */
export async function signServerTransaction(plan: ServerTxPlan, ctx: SignContext, submit: (signature: string) => Promise<unknown>): Promise<{ signature: string; plan: CheckedPlan }> {
  const checked = checkServerTxPlan(plan, ctx);
  const signature = await transact(async (w) => {
    const auth = await w.authorize({ chain: SOLANA_DEVNET_CHAIN, identity: { name: 'Pocket QA', uri: appIdentityUri(DEFAULT_SIWS_DOMAIN), icon: 'favicon.ico' } });
    const account = auth.accounts[0];
    const address = account ? base58.encode(decodeWalletBase64(account.address)) : '';
    if (address !== checked.signer) throw new Error('The wallet account is not your linked devnet wallet. Nothing was sent.');
    const res = await w.signAndSendTransactions({ payloads: [plan.transactionB64] });
    const sig = res.signatures[0];
    if (!sig) throw new Error('The wallet returned no signature.');
    return base58.encode(decodeWalletBase64(sig));
  });
  await reportSignature(() => submit(signature), signature);
  return { signature, plan: checked };
}
