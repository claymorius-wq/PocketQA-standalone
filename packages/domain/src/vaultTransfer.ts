import { base58 } from '@scure/base';
import { DomainError } from './errors';
import { associatedTokenAddress, findProgramAddress, sha256, SQUADS_V4_PROGRAM, TOKEN_PROGRAM } from './pda';
import { DEVNET_USDC_MINT } from './tokenTransfer';

/**
 * The payment a builder votes on (pqa-qa CS3). A vote's bytes only name (multisig, index); the
 * amount and recipient live in the Squads VaultTransaction account at that index, which the server
 * created as exactly [TransferChecked(vault token account → recipient token account), Memo(op id)]
 * (apps/api rpcChain.createVaultTransfer). The client reads that account on devnet itself and
 * checks it against this template; only then are the amount and recipient shown as checked.
 * Layout: Anchor discriminator, then VaultTransaction as @sqds/multisig serializes it (pinned in
 * vaultTransfer.test.ts).
 */
export const DEVNET_GENESIS_HASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
export const VAULT_TRANSACTION_DISCRIMINATOR = sha256(new TextEncoder().encode('account:VaultTransaction')).subarray(0, 8);
const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
/** Every pilot payment is paid from vault 0 (apps/api adapter getVaultPda index 0). */
const PILOT_VAULT_INDEX = 0;

const enc = new TextEncoder();
const le64 = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
};

export function squadsTransactionPda(multisig: string, index: bigint): string {
  return findProgramAddress([enc.encode('multisig'), base58.decode(multisig), enc.encode('transaction'), le64(index)], SQUADS_V4_PROGRAM).address;
}
export function squadsVaultPda(multisig: string, vaultIndex: number): string {
  return findProgramAddress([enc.encode('multisig'), base58.decode(multisig), enc.encode('vault'), Uint8Array.of(vaultIndex)], SQUADS_V4_PROGRAM).address;
}

export type DecodedVaultTx = {
  multisig: string;
  creator: string;
  index: bigint;
  vaultIndex: number;
  lookupTables: number;
  /** Accounts by static key only; an index into a lookup table is refused by verifyVaultTransfer (lookupTables > 0). */
  instructions: { programId: string; accounts: string[]; data: Uint8Array }[];
};

const notVault = (why: string) => new DomainError('VALIDATION', `Not a Squads vault transaction: ${why}.`);

export function decodeVaultTransaction(data: Uint8Array): DecodedVaultTx {
  let at = 0;
  const need = (n: number) => {
    if (at + n > data.length) throw notVault('truncated');
  };
  const take = (n: number) => {
    need(n);
    const out = data.subarray(at, at + n);
    at += n;
    return out;
  };
  const u8 = () => take(1)[0]!;
  const u32 = () => new DataView(data.buffer, data.byteOffset).getUint32((need(4), (at += 4) - 4), true);
  const key = () => base58.encode(take(32));
  const bytes = () => take(u32()).slice();

  need(8);
  if (VAULT_TRANSACTION_DISCRIMINATOR.some((b, i) => data[i] !== b)) throw notVault('another account type');
  at = 8;
  const multisig = key();
  const creator = key();
  const index = new DataView(data.buffer, data.byteOffset).getBigUint64((need(8), (at += 8) - 8), true);
  u8(); // bump
  const vaultIndex = u8();
  u8(); // vault bump
  bytes(); // ephemeral signer bumps
  u8(); // num signers
  u8(); // num writable signers
  u8(); // num writable non-signers
  const keyCount = u32();
  const keys: string[] = [];
  for (let i = 0; i < keyCount; i++) keys.push(key());
  const ixCount = u32();
  const raw: { p: number; a: number[]; d: Uint8Array }[] = [];
  for (let i = 0; i < ixCount; i++) raw.push({ p: u8(), a: Array.from(bytes()), d: bytes() });
  const lookupTables = u32();
  for (let i = 0; i < lookupTables; i++) {
    key();
    bytes();
    bytes();
  }
  // An account can be larger than its data; bytes after the message are not part of it.
  const k = (i: number) => keys[i] ?? `lookup-table:${i}`;
  return { multisig, creator, index, vaultIndex, lookupTables, instructions: raw.map((r) => ({ programId: k(r.p), accounts: r.a.map(k), data: r.d })) };
}

const refuse = (why: string) => new DomainError('VALIDATION', `The payment on Solana devnet doesn’t match what Pocket QA described: ${why}.`);

export function verifyVaultTransfer(
  vt: DecodedVaultTx,
  plan: { multisig: string; txIndex: number; recipient: string; amountUnits: number; opId: string },
): { amountUnits: number; recipient: string; destination: string; source: string } {
  if (vt.multisig !== plan.multisig) throw refuse('another multisig');
  if (!Number.isSafeInteger(plan.txIndex) || vt.index !== BigInt(plan.txIndex)) throw refuse('another transaction index');
  if (vt.vaultIndex !== PILOT_VAULT_INDEX) throw refuse('another vault');
  if (vt.lookupTables !== 0) throw refuse('it uses address lookup tables');
  const [t, m, ...more] = vt.instructions;
  if (!t || t.programId !== TOKEN_PROGRAM || t.data[0] !== 12) throw refuse('the first instruction is not a TransferChecked of devnet test USDC');
  if (!m || more.length) throw refuse('it is not exactly a TransferChecked and the operation memo');
  if (m.programId !== MEMO_PROGRAM || m.accounts.length || new TextDecoder().decode(m.data) !== plan.opId) throw refuse('the memo is not this payment’s operation id');
  if (t.data.length !== 10) throw refuse('the TransferChecked data is malformed');
  if (t.accounts.length !== 4) throw refuse('the TransferChecked has other accounts');
  const [source, mint, destination, authority] = t.accounts as [string, string, string, string];
  const amount = new DataView(t.data.buffer, t.data.byteOffset, t.data.byteLength).getBigUint64(1, true);
  if (mint !== DEVNET_USDC_MINT) throw refuse('the token mint is not the pinned devnet test USDC mint');
  if (t.data[9] !== 6) throw refuse('the decimals are not 6');
  const vault = squadsVaultPda(plan.multisig, PILOT_VAULT_INDEX);
  if (authority !== vault) throw refuse('the transfer authority is not the study vault');
  if (source !== associatedTokenAddress(vault, DEVNET_USDC_MINT)) throw refuse('the source is not the study vault’s token account');
  let recipientAta: string;
  try {
    if (base58.decode(plan.recipient).length !== 32) throw new Error();
    recipientAta = associatedTokenAddress(plan.recipient, DEVNET_USDC_MINT);
  } catch {
    throw refuse('the recipient is not a Solana address');
  }
  if (destination !== recipientAta) throw refuse('the recipient’s token account differs');
  if (amount > BigInt(Number.MAX_SAFE_INTEGER) || Number(amount) !== plan.amountUnits) throw refuse('the amount differs');
  return { amountUnits: Number(amount), recipient: plan.recipient, destination, source };
}

