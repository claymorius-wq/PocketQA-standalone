import { base58 } from '@scure/base';

/**
 * Addresses the client derives itself to check a server-built devnet transaction (pda.test.ts pins
 * every function against node:crypto and @solana/kit): the linked wallet's associated token
 * account and the Squads proposal of exactly one payment. sha256 is pure JS so the app needs no
 * native crypto module; nothing here is secret.
 */

// ── sha256 (FIPS 180-4) ──────────────────────────────────────────────────────────────────
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

export function sha256(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const padded = new Uint8Array(Math.ceil((len + 9) / 64) * 64);
  padded.set(msg);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((len * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (len * 8) >>> 0);
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15]!, 7) ^ rotr(w[i - 15]!, 18) ^ (w[i - 15]! >>> 3);
      const s1 = rotr(w[i - 2]!, 17) ^ rotr(w[i - 2]!, 19) ^ (w[i - 2]! >>> 10);
      w[i] = (w[i - 16]! + s0 + w[i - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as [number, number, number, number, number, number, number, number];
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i]! + w[i]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0]! + a) >>> 0;
    h[1] = (h[1]! + b) >>> 0;
    h[2] = (h[2]! + c) >>> 0;
    h[3] = (h[3]! + d) >>> 0;
    h[4] = (h[4]! + e) >>> 0;
    h[5] = (h[5]! + f) >>> 0;
    h[6] = (h[6]! + g) >>> 0;
    h[7] = (h[7]! + hh) >>> 0;
  }
  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  h.forEach((x, i) => ov.setUint32(i * 4, x));
  return out;
}

// ── ed25519 on-curve check (curve25519-dalek CompressedEdwardsY::decompress().is_some()) ──────
const P = 2n ** 255n - 19n;
const D = (-121665n * modPow(121666n, P - 2n)) % P;
function mod(a: bigint) {
  const r = a % P;
  return r < 0n ? r + P : r;
}
function modPow(b: bigint, e: bigint): bigint {
  let r = 1n;
  b = ((b % P) + P) % P;
  while (e > 0n) {
    if (e & 1n) r = (r * b) % P;
    b = (b * b) % P;
    e >>= 1n;
  }
  return r;
}

/** Whether 32 bytes are a valid compressed ed25519 point (a PDA must NOT be). */
export function isOnCurve(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;
  let y = 0n;
  for (let i = 31; i >= 0; i--) y = (y << 8n) | BigInt(i === 31 ? bytes[i]! & 0x7f : bytes[i]!);
  y = mod(y); // dalek reduces the field element; it does not reject y >= p
  const yy = mod(y * y);
  const u = mod(yy - 1n);
  const v = mod(D * yy + 1n);
  // sqrt_ratio_i(u, v): x = u v^3 (u v^7)^((p-5)/8); valid iff v x^2 = ±u.
  const v3 = mod(v * v * v);
  const x = mod(u * v3 * modPow(mod(u * v3 * v3 * v), (P - 5n) / 8n));
  const vxx = mod(v * x * x);
  return vxx === u || vxx === mod(-u); // -u: the root is x·sqrt(-1), still a valid point
}

// ── program-derived addresses ─────────────────────────────────────────────────────────────
const PDA_MARKER = new TextEncoder().encode('ProgramDerivedAddress');

export function findProgramAddress(seeds: Uint8Array[], programId: string): { address: string; bump: number } {
  const program = base58.decode(programId);
  for (const s of seeds) if (s.length > 32) throw new Error('seed longer than 32 bytes');
  for (let bump = 255; bump >= 0; bump--) {
    const parts = [...seeds, Uint8Array.of(bump), program, PDA_MARKER];
    const buf = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
      buf.set(p, at);
      at += p.length;
    }
    const hash = sha256(buf);
    if (!isOnCurve(hash)) return { address: base58.encode(hash), bump };
  }
  throw new Error('no viable program address');
}

export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const SQUADS_V4_PROGRAM = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';

/** The owner's associated token account for `mint` (classic SPL Token). */
export function associatedTokenAddress(owner: string, mint: string): string {
  return findProgramAddress([base58.decode(owner), base58.decode(TOKEN_PROGRAM), base58.decode(mint)], ASSOCIATED_TOKEN_PROGRAM).address;
}

/** The Squads v4 proposal of transaction `index` in `multisig` (@sqds/multisig getProposalPda seeds). */
export function squadsProposalPda(multisig: string, index: bigint): string {
  const le = new Uint8Array(8);
  new DataView(le.buffer).setBigUint64(0, index, true);
  const enc = new TextEncoder();
  return findProgramAddress([enc.encode('multisig'), base58.decode(multisig), enc.encode('transaction'), le, enc.encode('proposal')], SQUADS_V4_PROGRAM).address;
}
