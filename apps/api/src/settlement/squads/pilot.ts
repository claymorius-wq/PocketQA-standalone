import type { DB } from '../../db';
import { SquadsDevnetSettlement } from './adapter';
import { loadPilotKeys, RpcSquadsChain } from './rpcChain';

/**
 * The server's Squads devnet pilot provider (ADR 0007 §10), built only when
 * POCKETQA_SETTLEMENT=squads_devnet (never in production). Each landed step is logged with its
 * public signature, slot and fee as a receipt; no key material is ever logged.
 */
export function squadsDevnetPilot(db: DB, now: () => number, keysDir: string) {
  const { signers, createSeed } = loadPilotKeys(keysDir);
  const chain = RpcSquadsChain.devnet(signers, (s) => console.log(JSON.stringify({ receipt: 'squads_devnet_pilot', ...s, explorer: `https://explorer.solana.com/tx/${s.signature}?cluster=devnet` })));
  return new SquadsDevnetSettlement({ db, now, chain, createSeed });
}
