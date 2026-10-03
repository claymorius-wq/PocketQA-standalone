#!/usr/bin/env node
// Generates apps/mobile/assets/textures/grain-256.png, the Lens grain tile (DIRECTION-A §4 and §12).
//
//   node apps/mobile/scripts/gen-grain.mjs           write the tile
//   node apps/mobile/scripts/gen-grain.mjs --check   exit 1 if the committed tile differs
//
// The boards draw grain with an SVG filter that React Native cannot run:
//   <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/>
//   <feColorMatrix values="0 0 0 0 0.86  0 0 0 0 0.88  0 0 0 0 1  1.8 0 0 0 -0.62"/>
// This script evaluates that filter once, on a 256×256 tile, and stores the result as a PNG that
// Grain.tsx repeats. The noise is the SVG 1.1 reference feTurbulence (seed 0, as browsers run it),
// stitched so the tile wraps without seams. Both primitives run in linearRGB (the default
// color-interpolation-filters), so the constant tint (0.86, 0.88, 1) is converted to sRGB once:
// #EFF1FF. Alpha is not a colour and is stored unchanged. The output is byte-for-byte
// deterministic: no randomness beyond the reference generator, fixed zlib level.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const SIZE = 256;
const BASE_FREQUENCY = 0.85;
const OCTAVES = 2;
const TINT_LINEAR = [0.86, 0.88, 1];
const ALPHA = { gain: 1.8, offset: -0.62 };
const OUT = fileURLToPath(new URL('../assets/textures/grain-256.png', import.meta.url));

// ---------- SVG 1.1 feTurbulence reference implementation (channel 0 only) ----------
const BSize = 0x100;
const BM = 0xff;
const PerlinN = 0x1000;
const RAND_m = 2147483647;
const RAND_a = 16807;
const RAND_q = 127773;
const RAND_r = 2836;

function setupSeed(seed) {
  if (seed <= 0) seed = -(seed % (RAND_m - 1)) + 1;
  if (seed > RAND_m - 1) seed = RAND_m - 1;
  return seed;
}
function random(seed) {
  let result = RAND_a * (seed % RAND_q) - RAND_r * Math.floor(seed / RAND_q);
  if (result <= 0) result += RAND_m;
  return result;
}

function init(seedIn) {
  const lattice = new Int32Array(BSize + BSize + 2);
  // Four channels are seeded in order even though only R is used: the shared generator state
  // must advance exactly as in a browser for channel 0's lattice shuffle to match.
  const gradient = Array.from({ length: 4 }, () => Array.from({ length: BSize + BSize + 2 }, () => [0, 0]));
  let seed = setupSeed(seedIn);
  let i = 0;
  for (let k = 0; k < 4; k++) {
    for (i = 0; i < BSize; i++) {
      lattice[i] = i;
      for (let j = 0; j < 2; j++) {
        seed = random(seed);
        gradient[k][i][j] = ((seed % (BSize + BSize)) - BSize) / BSize;
      }
      const g = gradient[k][i];
      const s = Math.sqrt(g[0] * g[0] + g[1] * g[1]);
      g[0] /= s;
      g[1] /= s;
    }
  }
  while (--i) {
    const k = lattice[i];
    seed = random(seed);
    const j = seed % BSize;
    lattice[i] = lattice[j];
    lattice[j] = k;
  }
  for (i = 0; i < BSize + 2; i++) {
    lattice[BSize + i] = lattice[i];
    for (let k = 0; k < 4; k++) gradient[k][BSize + i] = [gradient[k][i][0], gradient[k][i][1]];
  }
  return { lattice, gradient: gradient[0] };
}

const sCurve = (t) => t * t * (3 - 2 * t);
const lerp = (t, a, b) => a + t * (b - a);

// Stitching compares the unmasked lattice index with the wrap point before masking, as browsers do
// (the spec's printed listing masks first, which would never stitch).
function noise2({ lattice, gradient }, vx, vy, stitch) {
  let t = vx + PerlinN;
  let bx0 = Math.trunc(t);
  let bx1 = bx0 + 1;
  const rx0 = t - Math.trunc(t);
  const rx1 = rx0 - 1;
  t = vy + PerlinN;
  let by0 = Math.trunc(t);
  let by1 = by0 + 1;
  const ry0 = t - Math.trunc(t);
  const ry1 = ry0 - 1;
  if (bx0 >= stitch.wrapX) bx0 -= stitch.width;
  if (bx1 >= stitch.wrapX) bx1 -= stitch.width;
  if (by0 >= stitch.wrapY) by0 -= stitch.height;
  if (by1 >= stitch.wrapY) by1 -= stitch.height;
  bx0 &= BM;
  bx1 &= BM;
  by0 &= BM;
  by1 &= BM;
  const i = lattice[bx0];
  const j = lattice[bx1];
  const b00 = lattice[i + by0];
  const b10 = lattice[j + by0];
  const b01 = lattice[i + by1];
  const b11 = lattice[j + by1];
  const sx = sCurve(rx0);
  const sy = sCurve(ry0);
  let q = gradient[b00];
  let u = rx0 * q[0] + ry0 * q[1];
  q = gradient[b10];
  let v = rx1 * q[0] + ry0 * q[1];
  const a = lerp(sx, u, v);
  q = gradient[b01];
  u = rx0 * q[0] + ry1 * q[1];
  q = gradient[b11];
  v = rx1 * q[0] + ry1 * q[1];
  const b = lerp(sx, u, v);
  return lerp(sy, a, b);
}

function stitchedFrequency(freq, tile) {
  const lo = Math.floor(tile * freq) / tile;
  const hi = Math.ceil(tile * freq) / tile;
  return freq / lo < hi / freq ? lo : hi;
}

/** fractalNoise channel 0 at pixel (x, y), as the filter's unclamped [0, 1] colour value. */
function fractalNoise(table, x, y) {
  const fx = stitchedFrequency(BASE_FREQUENCY, SIZE);
  const fy = stitchedFrequency(BASE_FREQUENCY, SIZE);
  const stitch = { width: Math.round(SIZE * fx), height: Math.round(SIZE * fy), wrapX: 0, wrapY: 0 };
  stitch.wrapX = PerlinN + stitch.width;
  stitch.wrapY = PerlinN + stitch.height;
  let vx = x * fx;
  let vy = y * fy;
  let sum = 0;
  let ratio = 1;
  for (let o = 0; o < OCTAVES; o++) {
    sum += noise2(table, vx, vy, stitch) / ratio;
    vx *= 2;
    vy *= 2;
    ratio *= 2;
    stitch.width *= 2;
    stitch.wrapX = 2 * stitch.wrapX - PerlinN;
    stitch.height *= 2;
    stitch.wrapY = 2 * stitch.wrapY - PerlinN;
  }
  return (sum + 1) / 2;
}

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

// ---------- PNG (colour type 3: one palette colour, alpha per index via tRNS) ----------
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

export function renderGrain() {
  const table = init(0);
  const rgb = TINT_LINEAR.map((c) => Math.round(clamp01(linearToSrgb(c)) * 255));
  // Index = stored alpha, so the palette is 256 copies of the tint with alpha 0..255.
  const plte = Buffer.alloc(256 * 3);
  const trns = Buffer.alloc(256);
  for (let a = 0; a < 256; a++) {
    plte[a * 3] = rgb[0];
    plte[a * 3 + 1] = rgb[1];
    plte[a * 3 + 2] = rgb[2];
    trns[a] = a;
  }
  const raw = Buffer.alloc(SIZE * (SIZE + 1));
  let sum = 0;
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE + 1)] = 0; // filter: none
    for (let x = 0; x < SIZE; x++) {
      const n = clamp01(fractalNoise(table, x, y));
      const alpha = Math.round(clamp01(ALPHA.gain * n + ALPHA.offset) * 255);
      raw[y * (SIZE + 1) + 1 + x] = alpha;
      sum += alpha;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // palette
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('tRNS', trns),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return { png, tint: rgb, meanAlpha: sum / (SIZE * SIZE * 255) };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const { png, tint, meanAlpha } = renderGrain();
  if (process.argv.includes('--check')) {
    let current = Buffer.alloc(0);
    try {
      current = readFileSync(OUT);
    } catch {
      // Missing file: reported as a mismatch below.
    }
    if (!current.equals(png)) {
      console.error(`grain tile out of date: run node apps/mobile/scripts/gen-grain.mjs`);
      process.exit(1);
    }
    console.log('grain tile up to date');
  } else {
    writeFileSync(OUT, png);
    const hex = tint.map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
    console.log(`wrote ${OUT} (${png.length} bytes, tint #${hex}, mean alpha ${meanAlpha.toFixed(3)})`);
  }
}
