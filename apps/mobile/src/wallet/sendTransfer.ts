import type { DevnetTransfer } from '@pocket-qa/contracts';

// Web / iOS: signing needs Mobile Wallet Adapter (Android). The UI explains this instead
// of offering the action; this never pretends to sign or send anything.
export async function signAndSendDevnetTransfer(_t: DevnetTransfer): Promise<never> {
  throw new Error('Signing a devnet transfer needs the Android app with your linked devnet wallet.');
}
