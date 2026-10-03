// TEST DOUBLE for browser E2E only: a loopback JSON-RPC that answers like Solana devnet
// (devnet genesis hash, a fixed blockhash, transactions the test registers). It lets the
// UI's pending → confirmed / failed states be exercised deterministically. It proves the
// app renders the server's verdict honestly; it is NOT evidence of a real devnet transfer.
import { createServer } from 'node:http';

const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const BLOCKHASH = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';
const txs = new Map();
const port = Number(process.env.FAKE_RPC_PORT ?? 8899);

createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const reply = (obj) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    if (req.url === '/__health') return reply({ ok: true });
    if (req.url === '/__set') {
      const { signature, tx } = JSON.parse(raw);
      txs.set(signature, tx);
      return reply({ ok: true });
    }
    const { id, method, params } = JSON.parse(raw || '{}');
    if (method === 'getGenesisHash') return reply({ jsonrpc: '2.0', id, result: DEVNET_GENESIS });
    if (method === 'getLatestBlockhash') return reply({ jsonrpc: '2.0', id, result: { context: { slot: 1 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 1000 } } });
    if (method === 'getTransaction') return reply({ jsonrpc: '2.0', id, result: txs.get(params[0]) ?? null });
    return reply({ jsonrpc: '2.0', id, error: { code: -32601, message: 'not supported by test double' } });
  });
}).listen(port, '127.0.0.1', () => console.log(`fake devnet rpc on http://127.0.0.1:${port}`));
