// READ-ONLY: for every write-ahead journal line, the transaction's on-chain blockTime (public RPC).
// Full signatures come from the private file (not in the repo); output carries prefix + sha256 only.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const require = createRequire(process.env.API_DIR + '/package.json');
const { Connection } = require('@solana/web3.js');
const conn = new Connection('https://api.devnet.solana.com', 'finalized');
const [journalPath, privatePath] = process.argv.slice(2);
const journal = readFileSync(journalPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((j) => j.seq);
const full = new Map(JSON.parse(readFileSync(privatePath, 'utf8')).map((s) => [s.seq, s.signature]));
const out = [];
for (const j of journal) {
  const sig = full.get(j.seq);
  if (createHash('sha256').update(sig).digest('hex') !== j.signatureSha256) throw new Error(`seq ${j.seq}: private signature does not match the journal hash`);
  let tx = null;
  for (let i = 0; i < 6 && !tx; i++) { tx = await conn.getTransaction(sig, { commitment: 'finalized', maxSupportedTransactionVersion: 0 }).catch(() => null); if (!tx) await new Promise((r) => setTimeout(r, 2500)); }
  await new Promise((r) => setTimeout(r, 800));
  const blockTimeMs = tx?.blockTime ? tx.blockTime * 1000 : null;
  const written = Date.parse(j.writtenAt);
  // blockTime has 1-second resolution; "before" means written no later than the block's second.
  out.push({ seq: j.seq, step: j.step, signaturePrefix: j.signaturePrefix, writtenAt: j.writtenAt, blockTime: blockTimeMs ? new Date(blockTimeMs).toISOString() : null, slot: tx?.slot ?? null, journalBeforeBlock: blockTimeMs !== null && written <= blockTimeMs + 999 });
}
console.log(JSON.stringify({ readAt: new Date().toISOString(), allBefore: out.every((o) => o.journalBeforeBlock), rows: out }, null, 2));
