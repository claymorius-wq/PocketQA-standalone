// READ-ONLY: derive Squads v4 ProgramConfig PDA and read its creation fee from public mainnet RPC.
import { createRequire } from 'node:module';
const require = createRequire(process.cwd() + '/package.json');
const kit = await import(require.resolve('@solana/kit'));
const PROGRAM = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const enc = new TextEncoder();
const [pda] = await kit.getProgramDerivedAddress({ programAddress: PROGRAM, seeds: [enc.encode('multisig'), enc.encode('program_config')] });
const r = await fetch('https://api.mainnet-beta.solana.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getAccountInfo', params: [pda, { encoding: 'base64' }] }) }).then((x) => x.json());
const v = r.result.value;
if (!v) { console.log('no account at', pda); process.exit(0); }
const b = Buffer.from(v.data[0], 'base64');
const b58 = kit.getBase58Decoder();
console.log({ programConfig: pda, owner: v.owner, authority: b58.decode(b.subarray(8, 40)), multisigCreationFeeLamports: b.readBigUInt64LE(40).toString(), treasury: b58.decode(b.subarray(48, 80)), slot: r.result.context.slot, at: new Date().toISOString() });
