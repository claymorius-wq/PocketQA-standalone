import { base58, base64 } from '@scure/base';
import { DomainError } from './errors';

/**
 * What the client checks in a SERVER-BUILT devnet transaction (escrow funding, the builder's Squads
 * approval) before asking a wallet to sign it: the message version, who pays (the first signer),
 * how many signatures it needs, which slots are already signed, the programs it calls and its
 * blockhash. Hand-written over the wire format (legacy and v0); @solana/kit pins the layout in
 * serverTx.test.ts. Programs must be static keys: a program reached through an address lookup
 * table can't be checked offline, so it is refused.
 */
export type DecodedServerTx = {
  version: 'legacy' | 0;
  requiredSignatures: number;
  signed: boolean[];
  feePayer: string;
  programIds: string[];
  recentBlockhash: string;
  lookupTables: number;
  /** Every instruction: its program, its accounts (static keys; anything else is refused) and data. */
  instructions: { programId: string; accounts: string[]; data: Uint8Array }[];
};

const bad = (why: string) => new DomainError('VALIDATION', `Not a valid devnet transaction: ${why}.`);

export function decodeServerTx(transactionB64: string): DecodedServerTx {
  let bytes: Uint8Array;
  try {
    bytes = base64.decode(transactionB64);
  } catch {
    throw bad('not base64');
  }
  let at = 0;
  const need = (n: number) => {
    if (at + n > bytes.length) throw bad('truncated');
  };
  const u8 = () => {
    need(1);
    return bytes[at++]!;
  };
  // Solana "shortvec": 7 bits per byte, little-endian, at most 3 bytes.
  const shortvec = () => {
    let v = 0;
    for (let i = 0; i < 3; i++) {
      const b = u8();
      v |= (b & 0x7f) << (7 * i);
      if (!(b & 0x80)) return v;
    }
    throw bad('length prefix too long');
  };
  const take = (n: number) => {
    need(n);
    const out = bytes.subarray(at, at + n);
    at += n;
    return out;
  };

  const sigCount = shortvec();
  const signed: boolean[] = [];
  for (let i = 0; i < sigCount; i++) signed.push(take(64).some((b) => b !== 0));

  let version: DecodedServerTx['version'] = 'legacy';
  need(1);
  if (bytes[at]! & 0x80) {
    const v = u8() & 0x7f;
    if (v !== 0) throw bad(`unsupported message version ${v}`);
    version = 0;
  }
  const requiredSignatures = u8();
  u8(); // readonly signed
  u8(); // readonly unsigned
  const keyCount = shortvec();
  const keys: string[] = [];
  for (let i = 0; i < keyCount; i++) keys.push(base58.encode(take(32)));
  const recentBlockhash = base58.encode(take(32));
  const ixCount = shortvec();
  const programIds: string[] = [];
  const instructions: DecodedServerTx['instructions'] = [];
  for (let i = 0; i < ixCount; i++) {
    const p = u8();
    if (p >= keys.length) throw bad('a program is not a static account (lookup-table programs are refused)');
    programIds.push(keys[p]!);
    const accountIdx = Array.from(take(shortvec()));
    // Accounts from lookup tables can't be checked offline: every account must be a static key.
    if (accountIdx.some((a) => a >= keys.length)) throw bad('an instruction uses an account from a lookup table');
    instructions.push({ programId: keys[p]!, accounts: accountIdx.map((a) => keys[a]!), data: take(shortvec()).slice() });
  }
  let lookupTables = 0;
  if (version === 0) {
    lookupTables = shortvec();
    for (let i = 0; i < lookupTables; i++) {
      take(32);
      take(shortvec()); // writable indices
      take(shortvec()); // readonly indices
    }
  }
  if (at !== bytes.length) throw bad('trailing bytes');
  if (requiredSignatures < 1 || requiredSignatures !== sigCount || keys.length < requiredSignatures) throw bad('signature count does not match the message');
  return { version, requiredSignatures, signed, feePayer: keys[0]!, programIds, recentBlockhash, lookupTables, instructions };
}
