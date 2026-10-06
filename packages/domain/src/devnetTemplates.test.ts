import { describe, expect, it } from 'vitest';
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Blockhash,
} from '@solana/kit';
import { base64 } from '@scure/base';
import { associatedTokenAddress, squadsProposalPda } from './pda';
import { decodeServerTx } from './serverTx';
import { PILOT_MINT, verifyApprovalTx, verifyFundingTx, CU_LIMIT_MAX, CU_PRICE_MAX_MICROLAMPORTS } from './devnetTemplates';

// pqa-qa P2-CS1: every value the client shows for a server-built devnet transaction is read from the
// BYTES and must match an exact template per kind; the server's JSON is only compared against it.

const linked = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
const attacker = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const vaultAta = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';
const reference = 'Ref1111111111111111111111111111111111111111';
const multisig = 'Mu1tisig11111111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SQUADS = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const CB = 'ComputeBudget111111111111111111111111111111';
const SYSTEM = '11111111111111111111111111111111';
const OTHER_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const OP = `pqa-op1:${'ab'.repeat(32)}`;
const blockhash = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi' as Blockhash;

type Ix = { programAddress: ReturnType<typeof address>; accounts: { address: ReturnType<typeof address>; role: AccountRole }[]; data: Uint8Array };
const acc = (a: string, role = AccountRole.WRITABLE) => ({ address: address(a), role });
const u64 = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return b;
};
const u32 = (n: number) => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
};
const cat = (...p: Uint8Array[]) => Uint8Array.from(p.flatMap((x) => Array.from(x)));

function transferChecked(o: Partial<{ source: string; mint: string; dest: string; owner: string; ref: string | null; amount: bigint; decimals: number; tag: number }> = {}): Ix {
  const accounts = [acc(o.source ?? associatedTokenAddress(linked, PILOT_MINT)), acc(o.mint ?? PILOT_MINT, AccountRole.READONLY), acc(o.dest ?? vaultAta), acc(o.owner ?? linked, AccountRole.READONLY_SIGNER)];
  if ((o.ref === undefined ? reference : o.ref) !== null) accounts.push(acc(o.ref ?? reference, AccountRole.READONLY));
  return { programAddress: address(TOKEN), accounts, data: cat(Uint8Array.of(o.tag ?? 12), u64(o.amount ?? 2_200_000n), Uint8Array.of(o.decimals ?? 6)) };
}
const DISC = Uint8Array.of(144, 37, 164, 136, 188, 216, 42, 248);
function approve(o: Partial<{ multisig: string; member: string; index: bigint; proposal: string; memo: string | null; disc: Uint8Array }> = {}): Ix {
  const ms = o.multisig ?? multisig;
  const memo = o.memo === undefined ? null : o.memo;
  const memoBytes = memo === null ? Uint8Array.of(0) : cat(Uint8Array.of(1), u32(new TextEncoder().encode(memo).length), new TextEncoder().encode(memo));
  return {
    programAddress: address(SQUADS),
    accounts: [acc(ms, AccountRole.READONLY), acc(o.member ?? linked, AccountRole.WRITABLE_SIGNER), acc(o.proposal ?? squadsProposalPda(ms, o.index ?? 4n))],
    data: cat(o.disc ?? DISC, memoBytes),
  };
}
const memoIx = (text: string): Ix => ({ programAddress: address(MEMO), accounts: [], data: new TextEncoder().encode(text) });
const cuLimit = (n: number): Ix => ({ programAddress: address(CB), accounts: [], data: cat(Uint8Array.of(2), u32(n)) });
const cuPrice = (n: bigint): Ix => ({ programAddress: address(CB), accounts: [], data: cat(Uint8Array.of(3), u64(n)) });
const systemTransfer = (): Ix => ({ programAddress: address(SYSTEM), accounts: [acc(linked, AccountRole.WRITABLE_SIGNER), acc(attacker)], data: cat(u32(2), u64(1_000_000_000n)) });
const splIx = (tag: number): Ix => ({ programAddress: address(TOKEN), accounts: [acc(associatedTokenAddress(linked, PILOT_MINT)), acc(attacker, AccountRole.READONLY), acc(linked, AccountRole.READONLY_SIGNER)], data: Uint8Array.of(tag) });

function tx(ixs: Ix[], feePayer = linked) {
  const m = pipe(createTransactionMessage({ version: 0 }), (x) => setTransactionMessageFeePayer(address(feePayer), x), (x) => setTransactionMessageLifetimeUsingBlockhash({ blockhash, lastValidBlockHeight: 1n }, x), (x) => appendTransactionMessageInstructions(ixs, x));
  return decodeServerTx(base64.encode(new Uint8Array(getTransactionEncoder().encode(compileTransaction(m)))));
}
const fundingExpect = { owner: linked, amountUnits: 2_200_000, destination: vaultAta, reference, mint: PILOT_MINT };
const approvalExpect = { member: linked, multisig, txIndex: 4, opId: OP };

describe('verifyFundingTx: exactly one TransferChecked of the pinned mint, linked wallet ATA -> vault, carrying the reference', () => {
  it('accepts the template and returns the values read from the bytes', () => {
    expect(verifyFundingTx(tx([transferChecked()]), fundingExpect)).toEqual({ amountUnits: 2_200_000, destination: vaultAta, source: associatedTokenAddress(linked, PILOT_MINT), mint: PILOT_MINT, reference });
  });
  it('accepts ComputeBudget within the fixed bounds', () => {
    expect(() => verifyFundingTx(tx([cuLimit(CU_LIMIT_MAX), cuPrice(BigInt(CU_PRICE_MAX_MICROLAMPORTS)), transferChecked()]), fundingExpect)).not.toThrow();
  });
  it.each([
    ['QA repro: a System transfer of 1 SOL to someone else', () => tx([systemTransfer()]), /System|unexpected|TransferChecked/],
    ['a System transfer next to the real transfer', () => tx([transferChecked(), systemTransfer()]), /extra|unexpected/],
    ['SPL Approve', () => tx([transferChecked(), splIx(4)]), /extra|unexpected|TransferChecked/],
    ['SPL SetAuthority', () => tx([transferChecked(), splIx(6)]), /extra|unexpected|TransferChecked/],
    ['SPL CloseAccount', () => tx([transferChecked(), splIx(9)]), /extra|unexpected|TransferChecked/],
    ['two TransferChecked', () => tx([transferChecked(), transferChecked()]), /exactly one/],
    ['a Memo (a funding has none)', () => tx([transferChecked(), memoIx(OP)]), /extra|unexpected|Memo/],
    ['plain Transfer (tag 3)', () => tx([transferChecked({ tag: 3 })]), /TransferChecked/],
    ['another mint', () => tx([transferChecked({ mint: OTHER_MINT })]), /mint/],
    ['other decimals', () => tx([transferChecked({ decimals: 9 })]), /decimals/],
    ['another amount', () => tx([transferChecked({ amount: 2_200_001n })]), /amount/],
    ['a source that is not the linked wallet’s token account', () => tx([transferChecked({ source: attacker })]), /source/],
    ['another destination', () => tx([transferChecked({ dest: attacker })]), /destination/],
    ['another owner', () => tx([transferChecked({ owner: attacker })]), /owner|signer|fee payer/],
    ['no reference', () => tx([transferChecked({ ref: null })]), /reference/],
    ['another reference', () => tx([transferChecked({ ref: attacker })]), /reference/],
    ['compute limit over the bound', () => tx([cuLimit(CU_LIMIT_MAX + 1), transferChecked()]), /compute/i],
    ['priority fee over the bound', () => tx([cuPrice(BigInt(CU_PRICE_MAX_MICROLAMPORTS) + 1n), transferChecked()]), /compute|fee/i],
    ['another fee payer', () => tx([transferChecked()], attacker), /fee payer|signer/],
  ])('refuses: %s', (_n, make, msg) => {
    expect(() => verifyFundingTx(make(), fundingExpect)).toThrow(msg);
  });
  it('refuses when the plan (JSON) differs from the bytes', () => {
    expect(() => verifyFundingTx(tx([transferChecked()]), { ...fundingExpect, amountUnits: 1 })).toThrow(/amount/);
    expect(() => verifyFundingTx(tx([transferChecked()]), { ...fundingExpect, destination: attacker })).toThrow(/destination/);
    expect(() => verifyFundingTx(tx([transferChecked()]), { ...fundingExpect, mint: OTHER_MINT })).toThrow(/mint/);
  });
});

describe('verifyApprovalTx: exactly one Squads v4 proposal_approve by the linked wallet, for this multisig and index', () => {
  it('accepts the template (memo none), and with the op id as memo / a Memo instruction', () => {
    const out = { multisig, txIndex: 4, proposal: squadsProposalPda(multisig, 4n), member: linked };
    expect(verifyApprovalTx(tx([approve()]), approvalExpect)).toEqual(out);
    expect(verifyApprovalTx(tx([approve({ memo: OP })]), approvalExpect)).toEqual(out);
    expect(verifyApprovalTx(tx([cuLimit(100_000), approve(), memoIx(OP)]), approvalExpect)).toEqual(out);
  });
  it.each([
    ['QA repro: a System transfer', () => tx([systemTransfer()]), /proposal_approve|unexpected/],
    ['a System transfer next to the vote', () => tx([approve(), systemTransfer()]), /extra|unexpected/],
    ['an SPL instruction next to the vote', () => tx([approve(), splIx(4)]), /extra|unexpected/],
    ['two votes', () => tx([approve(), approve()]), /exactly one/],
    ['another multisig', () => tx([approve({ multisig: attacker })]), /multisig/],
    ['another member', () => tx([approve({ member: attacker })]), /member|signer|fee payer/],
    ['another index (its proposal)', () => tx([approve({ index: 5n })]), /proposal|index/],
    ['a proposal account that is not the PDA', () => tx([approve({ proposal: attacker })]), /proposal/],
    ['proposal_reject (another discriminator)', () => tx([approve({ disc: Uint8Array.of(243, 62, 134, 156, 230, 106, 246, 135) })]), /proposal_approve/],
    ['a memo other than the op id', () => tx([approve({ memo: 'pay attacker' })]), /memo|operation/i],
    ['a Memo instruction other than the op id', () => tx([approve(), memoIx('pay attacker')]), /memo|operation/i],
    ['two Memo instructions', () => tx([approve(), memoIx(OP), memoIx(OP)]), /memo|extra/i],
    ['compute limit over the bound', () => tx([cuLimit(CU_LIMIT_MAX + 1), approve()]), /compute/i],
  ])('refuses: %s', (_n, make, msg) => {
    expect(() => verifyApprovalTx(make(), approvalExpect)).toThrow(msg);
  });
  it('refuses when the plan (JSON) differs from the bytes', () => {
    expect(() => verifyApprovalTx(tx([approve()]), { ...approvalExpect, txIndex: 5 })).toThrow(/proposal|index/);
    expect(() => verifyApprovalTx(tx([approve()]), { ...approvalExpect, multisig: attacker })).toThrow(/multisig/);
  });
});
