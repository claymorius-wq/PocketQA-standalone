// Android-only (not .native): MWA's native module doesn't exist on iOS and loading it there crashes.
import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol';
import { base58, base64 } from '@scure/base';
import { appIdentityUri, DEFAULT_SIWS_DOMAIN, SOLANA_DEVNET_CHAIN, type DevnetTransfer } from '@pocket-qa/contracts';
import { buildDevnetTransferTx } from '@pocket-qa/domain';
import { api } from '../api/client';
import { reportSignature } from './reportSignature';
import { decodeWalletBase64 } from './signature';

/**
 * Asks the builder's wallet to sign and send the server-defined devnet demo transfer,
 * then reports the signature. The app never decides the outcome: the transfer stays
 * `pending` until the server finds the finalized transaction on devnet and checks sender,
 * recipient, amount and genesis (ADR 0001 §9).
 */
export async function signAndSendDevnetTransfer(t: DevnetTransfer): Promise<void> {
  const { blockhash } = await api('transferBlockhash', { params: { id: t.id } });
  const tx = buildDevnetTransferTx({ sender: t.sender, recipient: t.recipient, lamports: t.lamports, blockhash });
  const signature = await transact(async (w) => {
    const auth = await w.authorize({ chain: SOLANA_DEVNET_CHAIN, identity: { name: 'Pocket QA', uri: appIdentityUri(DEFAULT_SIWS_DOMAIN), icon: 'favicon.ico' } });
    const account = auth.accounts[0];
    const address = account ? base58.encode(decodeWalletBase64(account.address)) : '';
    if (address !== t.sender) throw new Error('The wallet account is not your linked devnet wallet. Nothing was sent.');
    const res = await w.signAndSendTransactions({ payloads: [base64.encode(tx)] });
    const sig = res.signatures[0];
    if (!sig) throw new Error('The wallet returned no signature.');
    return base58.encode(decodeWalletBase64(sig));
  });
  await reportSignature(() => api('submitTransferSignature', { params: { id: t.id }, body: { signature } }), signature);
}
