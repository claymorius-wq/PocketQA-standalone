// The strings the deploy scan looks for, per server-only variable (values are never printed).
// POCKETQA_DEVNET_PLATFORM_SIGNER (devnet-phase-contract.md CH-D4) is a JSON array of the 64-byte
// ed25519 secret key; a bundle could carry it in another encoding, so the scan also looks for the
// key bytes and the 32-byte seed as hex, base64 and base58.
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = '';
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

export function needlesFor(name, value) {
  const needles = [value];
  if (name === 'FIREBASE_SERVICE_ACCOUNT_JSON') {
    try {
      const sa = JSON.parse(value);
      for (const k of ['private_key', 'private_key_id', 'client_id']) if (sa[k]) needles.push(String(sa[k]));
    } catch {
      /* the value itself is still scanned */
    }
  }
  if (name === 'POCKETQA_DEVNET_PLATFORM_SIGNER') {
    try {
      const bytes = JSON.parse(value);
      if (Array.isArray(bytes) && bytes.length === 64) {
        for (const part of [Uint8Array.from(bytes), Uint8Array.from(bytes.slice(0, 32))]) {
          const buf = Buffer.from(part);
          needles.push(buf.toString('hex'), buf.toString('base64'), base58(part), bytes.slice(0, part.length).join(','));
        }
      }
    } catch {
      /* the value itself is still scanned */
    }
  }
  return needles;
}
