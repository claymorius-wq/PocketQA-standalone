// The arbiter's vote on one devnet payment (operator only; docs/reviews/devnet/devnet-live-run.md §6).
//   npx tsx scripts/devnet-arbiter.ts --key-file <abs path to arbiter.json> --platform <platform pubkey> \
//     --multisig <ms> --index <n> --op <pqa-op1:…> --recipient <wallet> --amount <units> [--rpc <url>] [--send]
// Without --send it only reads devnet and prints what it checked. It prints public data only (never
// the key). Devnet test USDC, no value · test keys · not independent custody.
import { arbiterApprove, ArbiterRefusal, rpcArbiterChain } from '../src/settlement/squads/arbiter';
import { loadKeyFile } from '../src/settlement/squads/devnetSigner';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const need = (name: string) => {
  const v = opt(name);
  if (!v) {
    console.error(`missing --${name}`);
    process.exit(2);
  }
  return v;
};

try {
  const result = await arbiterApprove({
    chain: rpcArbiterChain(opt('rpc') ?? 'https://api.devnet.solana.com'),
    arbiter: loadKeyFile(need('key-file'), '--key-file'),
    platform: need('platform'),
    plan: { multisig: need('multisig'), txIndex: Number(need('index')), opId: need('op'), recipient: need('recipient'), amountUnits: Number(need('amount')) },
    send: args.includes('--send'),
  });
  console.log(JSON.stringify({ network: 'devnet', ...result, sent: result.signature !== null }, null, 2));
} catch (e) {
  console.error(e instanceof ArbiterRefusal ? e.message : `error: ${(e as Error).message}`);
  process.exit(1);
}
