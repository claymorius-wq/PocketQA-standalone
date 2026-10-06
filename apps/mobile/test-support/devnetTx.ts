import { base58, base64 } from '@scure/base';
import { associatedTokenAddress, PILOT_MINT, squadsProposalPda } from '@pocket-qa/domain';

// Test fixture: hand-encoded v0 transactions for the devnet pilot's server-built templates
// (packages/domain devnetTemplates.ts). The fee payer is the first static key and the only signer.

export const LINKED = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
export const ATTACKER = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
export const VAULT_ATA = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';
export const REFERENCE = 'Ref1111111111111111111111111111111111111111';
export const MULTISIG = 'Mu1tisig11111111111111111111111111111111111';
export const MINT = PILOT_MINT;
export const OP = `pqa-op1:${'ab'.repeat(32)}`;
export const COPY = 'Devnet test USDC, no value · test keys · not independent custody';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SQUADS = 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf';
const SYSTEM = '11111111111111111111111111111111';

type Ix = { program: string; accounts: string[]; data: number[] };
const u64 = (n: bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return Array.from(b);
};

export function encodeV0(ixs: Ix[], feePayer = LINKED, signed = false): string {
  const keys: string[] = [feePayer];
  for (const ix of ixs) for (const k of [...ix.accounts, ix.program]) if (!keys.includes(k)) keys.push(k);
  const bytes: number[] = [1, ...new Array(64).fill(signed ? 9 : 0), 0x80, 1, 0, 0, keys.length];
  for (const k of keys) bytes.push(...base58.decode(k));
  bytes.push(...base58.decode(VAULT_ATA)); // blockhash
  bytes.push(ixs.length);
  for (const ix of ixs) bytes.push(keys.indexOf(ix.program), ix.accounts.length, ...ix.accounts.map((a) => keys.indexOf(a)), ix.data.length, ...ix.data);
  bytes.push(0);
  return base64.encode(Uint8Array.from(bytes));
}

export const transferCheckedIx = (o: { amount?: bigint; dest?: string; ref?: string } = {}): Ix => ({
  program: TOKEN,
  accounts: [associatedTokenAddress(LINKED, MINT), MINT, o.dest ?? VAULT_ATA, LINKED, o.ref ?? REFERENCE],
  data: [12, ...u64(o.amount ?? 2_200_000n), 6],
});
export const approveIx = (index = 4n): Ix => ({
  program: SQUADS,
  accounts: [MULTISIG, LINKED, squadsProposalPda(MULTISIG, index)],
  data: [144, 37, 164, 136, 188, 216, 42, 248, 0],
});
export const systemTransferIx = (): Ix => ({ program: SYSTEM, accounts: [LINKED, ATTACKER], data: [2, 0, 0, 0, ...u64(1_000_000_000n)] });

/** GET /settlements/:id/approval (contracts SettlementApproval), template-valid by default. */
export const approvalPlan = (over: Record<string, unknown> = {}) => ({
  settlementId: 'set-1', kind: 'payout', transactionB64: encodeV0([approveIx()]), multisig: MULTISIG, txIndex: 4, opId: OP,
  amountUnits: 1_500_000, destination: ATTACKER, mint: MINT, network: 'devnet', copy: COPY, ...over,
});
/** GET /escrow/fundings/:id/transaction (contracts DevnetFundingTransaction), template-valid by default. */
export const fundingPlan = (over: Record<string, unknown> = {}) => ({
  transactionB64: encodeV0([transferCheckedIx()]), fundingId: 'f-1', studyId: 's-1', reference: REFERENCE, amountUnits: 2_200_000,
  destination: VAULT_ATA, mint: MINT, network: 'devnet', copy: COPY, ...over,
});
