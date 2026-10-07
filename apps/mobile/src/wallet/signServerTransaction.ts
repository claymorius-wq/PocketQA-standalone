import type { CheckedPlan, ServerTxPlan, SignContext } from './serverTx';

// iOS (and any platform without a resolver): no wallet can sign a devnet pilot transaction here.
// The UI explains this instead of offering the action; this never pretends to sign or send.
export async function signServerTransaction(_plan: ServerTxPlan, _ctx: SignContext, _submit: (signature: string) => Promise<unknown>): Promise<{ signature: string; plan: CheckedPlan }> {
  throw new Error('Signing devnet pilot transactions needs the Android app or a browser wallet with your linked devnet wallet.');
}
