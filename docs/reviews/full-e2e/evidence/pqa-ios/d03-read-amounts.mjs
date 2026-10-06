// READ-ONLY: public devnet RPC reads (no keys, nothing signed or sent).
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(process.env.API_DIR + '/package.json');
const { Connection, PublicKey } = require('@solana/web3.js');
const conn = new Connection('https://api.devnet.solana.com', 'finalized');
const pace = () => new Promise((r) => setTimeout(r, 1200));
const MAINNET_USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const rb = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const out = { readAt: new Date().toISOString(), rpc: 'https://api.devnet.solana.com' };
out.genesis = await conn.getGenesisHash(); await pace();
const mintInfo = await conn.getParsedAccountInfo(new PublicKey(rb.mint), 'finalized'); await pace();
out.mint = { address: rb.mint, owner: mintInfo.value?.owner.toBase58(), parsed: mintInfo.value?.data?.parsed?.info, equalsMainnetUsdc: rb.mint === MAINNET_USDC, mainnetUsdc: MAINNET_USDC };
const mainOnDevnet = await conn.getAccountInfo(new PublicKey(MAINNET_USDC), 'finalized'); await pace();
out.mainnetUsdcAddressOnDevnet = mainOnDevnet ? { exists: true, owner: mainOnDevnet.owner.toBase58() } : { exists: false };
out.tokenMovements = [];
for (const t of rb.transactions) {
  if (!/funding|execute|unmatched|extra/.test(t.step)) continue;
  let tx = null;
  for (let i = 0; i < 5 && !tx; i++) { try { tx = await conn.getParsedTransaction(t.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }); } catch { await pace(); await pace(); } }
  await pace();
  const keys = tx?.transaction.message.accountKeys.map((k) => k.pubkey.toBase58()) ?? [];
  const pre = Object.fromEntries((tx?.meta?.preTokenBalances ?? []).map((b) => [b.accountIndex, b]));
  const deltas = (tx?.meta?.postTokenBalances ?? []).map((b) => ({ account: keys[b.accountIndex], owner: b.owner, mint: b.mint, preUnits: pre[b.accountIndex]?.uiTokenAmount.amount ?? '0', postUnits: b.uiTokenAmount.amount, deltaUnits: String(BigInt(b.uiTokenAmount.amount) - BigInt(pre[b.accountIndex]?.uiTokenAmount.amount ?? '0')) })).filter((d) => d.deltaUnits !== '0');
  out.tokenMovements.push({ step: t.step, signature: t.signature, slot: tx?.slot ?? null, blockTime: tx?.blockTime ? new Date(tx.blockTime * 1000).toISOString() : null, err: tx?.meta?.err ?? null, feeLamports: tx?.meta?.fee ?? null, tokenDeltas: deltas });
}
console.log(JSON.stringify(out, null, 2));
