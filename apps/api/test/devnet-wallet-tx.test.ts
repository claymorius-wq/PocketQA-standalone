import { randomBytes } from 'node:crypto';
import { base58 } from '@scure/base';
import { Keypair, type Connection } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { decodeServerTx, decodeVaultTransaction, observeTokenTransfer, squadsTransactionPda, squadsVaultPda, verifyApprovalTx, verifyFundingTx, verifyVaultTransfer } from '@pocket-qa/domain';
import { ataOf } from '../src/settlement/squads/adapter';
import { PILOT_MINT } from '../src/settlement/squads/pins';
import { RpcDevnetChain } from '../src/settlement/squads/rpcDevnetChain';
import { buildApproveTx, buildFundingTx } from '../src/settlement/squads/walletTx';
import { FakeDevnetChain, walletSign } from './fakeDevnetChain';

// The two transactions the builder's WALLET signs (escrow funding; the builder's Squads vote) are
// built by pure functions (no network: the blockhash and its last valid height are passed in),
// shared by RpcDevnetChain and FakeDevnetChain. The contract with the client: their bytes pass the
// exact templates the app checks before any wallet opens (@pocket-qa/domain devnetTemplates.ts,
// pqa-qa P2-CS1), so server and client cannot drift.
const pk = () => Keypair.generate().publicKey.toBase58();
const blockhash = base58.encode(randomBytes(32));
const decode = (b64: string) => decodeServerTx(b64);

describe('pure wallet-transaction builders: the contract with the client templates', () => {
  it('funding: passes verifyFundingTx (pinned mint, 6 decimals, ATA(builder) → vault ATA, the amount, the reference 5th)', () => {
    const builder = pk();
    const vaultAta = ataOf(pk());
    const reference = pk();
    const tx = buildFundingTx({ from: builder, vaultAta, amount: 2_200_000n, reference, recentBlockhash: blockhash, lastValidBlockHeight: 77 });
    expect(tx.lastValidBlockHeight).toBe(77);
    const d = decode(tx.wireB64);
    expect(d.recentBlockhash).toBe(blockhash);
    expect(verifyFundingTx(d, { owner: builder, amountUnits: 2_200_000, destination: vaultAta, reference, mint: PILOT_MINT })).toEqual({ amountUnits: 2_200_000, destination: vaultAta, source: ataOf(builder), mint: PILOT_MINT, reference });
    expect(Buffer.from(tx.wireB64, 'base64').subarray(65).toString('base64')).toBe(tx.messageB64);
  });

  it('approve: passes verifyApprovalTx (one proposal_approve, member = fee payer, this multisig and index; memo None)', () => {
    const member = pk();
    const ms = pk();
    const tx = buildApproveTx({ multisig: ms, index: 7n, member, recentBlockhash: blockhash, lastValidBlockHeight: 77 });
    expect(verifyApprovalTx(decode(tx.wireB64), { member, multisig: ms, txIndex: 7, opId: `pqa-op1:${'ab'.repeat(32)}` })).toMatchObject({ multisig: ms, txIndex: 7, member });
  });

  it('pure: the same input gives the same bytes', () => {
    const i = { from: pk(), vaultAta: pk(), amount: 1n, reference: pk(), recentBlockhash: blockhash, lastValidBlockHeight: 1 };
    expect(buildFundingTx(i)).toEqual(buildFundingTx(i));
  });

  it('RpcDevnetChain builds with them: its bytes equal the pure builders’ for the RPC’s blockhash', async () => {
    const conn = { getLatestBlockhash: async () => ({ blockhash, lastValidBlockHeight: 1_234 }) } as unknown as Connection;
    const chain = new RpcDevnetChain(conn, Keypair.generate(), pk());
    const f = { from: pk(), vaultAta: pk(), amount: 3_000n, reference: pk() };
    expect(await chain.buildFundingTransfer(f)).toEqual(buildFundingTx({ ...f, recentBlockhash: blockhash, lastValidBlockHeight: 1_234 }));
    const ms = pk();
    const member = pk();
    expect(await chain.buildCosignerApprove(ms, 2n, member)).toEqual(buildApproveTx({ multisig: ms, index: 2n, member, recentBlockhash: blockhash, lastValidBlockHeight: 1_234 }));
  });
});

describe('FakeDevnetChain speaks real transaction bytes', () => {
  /** A fake with a multisig whose proposal #1 is Active and a vault transfer of 1.5 test USDC to `recipient`. */
  async function withProposal(builder: Keypair, recipient = pk()) {
    const chain = new FakeDevnetChain();
    const ms = pk();
    const vault = squadsVaultPda(ms, 0);
    chain.multisigs.set(ms, { createKey: pk(), configAuthority: pk(), threshold: 2, timeLock: 0, transactionIndex: 1n, rentCollector: null, members: [{ key: builder.publicKey.toBase58(), mask: 7 }] });
    chain.vaultTxs.set(`${ms}:1`, { creator: chain.roles.platform, operation: `pqa-op1:${'cd'.repeat(32)}`, instructions: 2, program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', opcode: 12, source: ataOf(vault), mint: PILOT_MINT, destination: ataOf(recipient), authority: vault, amount: 1_500_000n, decimals: 6 });
    chain.proposals.set(`${ms}:1`, { status: 'Active', approved: [] });
    return { chain, ms, vault, recipient, builder };
  }

  it('its builders pass the client templates too', async () => {
    const chain = new FakeDevnetChain();
    const builder = pk();
    const vaultAta = pk();
    const reference = pk();
    const ms = pk();
    const f = decode((await chain.buildFundingTransfer({ from: builder, vaultAta, amount: 5n, reference })).wireB64);
    const a = decode((await chain.buildCosignerApprove(ms, 3n, builder)).wireB64);
    expect(() => verifyFundingTx(f, { owner: builder, amountUnits: 5, destination: vaultAta, reference, mint: PILOT_MINT })).not.toThrow();
    expect(() => verifyApprovalTx(a, { member: builder, multisig: ms, txIndex: 3, opId: `pqa-op1:${'ab'.repeat(32)}` })).not.toThrow();
  });

  it('walletSend: the member’s signed vote is verified and counted; its signature is the wallet’s', async () => {
    const kp = Keypair.generate();
    const { chain, ms } = await withProposal(kp);
    const signed = walletSign((await chain.buildCosignerApprove(ms, 1n, kp.publicKey.toBase58())).wireB64, kp);
    const sig = chain.walletSend(signed);
    expect(sig).toBe(base58.encode(Buffer.from(signed, 'base64').subarray(1, 65)));
    expect((await chain.getProposal(ms, 1n))!.approved).toEqual([kp.publicKey.toBase58()]);
    expect(await chain.signatureStatus(sig)).toBe('finalized');
    expect(chain.landed.at(-1)).toEqual({ step: 'cosigner_approve', signature: sig });
  });

  it.each([
    ['unsigned bytes', (w: string) => w],
    ['a tampered message (signature no longer verifies)', (w: string, kp: Keypair) => {
      const b = Buffer.from(walletSign(w, kp), 'base64');
      b.writeUInt8(b.readUInt8(100) ^ 1, 100); // inside a static account key: still decodes, the signature no longer matches
      return b.toString('base64');
    }],
    ['signed by another key', (w: string) => walletSign(w, Keypair.generate())],
  ])('walletSend refuses %s; nothing counted', async (_n, mutate) => {
    const kp = Keypair.generate();
    const { chain, ms } = await withProposal(kp);
    const wire = (await chain.buildCosignerApprove(ms, 1n, kp.publicKey.toBase58())).wireB64;
    expect(() => chain.walletSend(mutate(wire, kp))).toThrow(/signature/);
    expect((await chain.getProposal(ms, 1n))!.approved).toEqual([]);
  });

  it('walletSend refuses a vote for a proposal that does not exist, and anything that is neither a vote nor a funding', async () => {
    const kp = Keypair.generate();
    const { chain, ms } = await withProposal(kp);
    const missing = walletSign((await chain.buildCosignerApprove(ms, 9n, kp.publicKey.toBase58())).wireB64, kp);
    expect(() => chain.walletSend(missing)).toThrow(/proposal/);
    const { buildSystemTransferForTest } = await import('./fakeDevnetChain');
    expect(() => chain.walletSend(walletSign(buildSystemTransferForTest(kp.publicKey.toBase58(), pk()), kp))).toThrow(/neither/);
  });

  it('walletSend of a funding: the vault is credited and the server observes it like an RPC transaction (reference, amount, funder)', async () => {
    const chain = new FakeDevnetChain();
    const kp = Keypair.generate();
    const vaultAta = ataOf(pk());
    chain.atas.add(vaultAta);
    const reference = pk();
    const sig = chain.walletSend(walletSign((await chain.buildFundingTransfer({ from: kp.publicKey.toBase58(), vaultAta, amount: 2_200_000n, reference })).wireB64, kp));
    expect(await chain.tokenBalance(vaultAta)).toBe(2_200_000n);
    const tx = (await chain.getParsedTransaction(sig))!;
    expect(observeTokenTransfer(tx, { vault: vaultAta, mint: PILOT_MINT, reference }, 'devnet')).toEqual({
      transfer: { status: 'finalized', network: 'devnet', mint: PILOT_MINT, destination: vaultAta, amountUnits: 2_200_000, reference, blockTimeMs: expect.any(Number) },
      source: kp.publicKey.toBase58(),
    });
    expect(chain.landed.at(-1)).toEqual({ step: 'funding', signature: sig });
  });

  it('vaultTransactionAccount: the bytes at (multisig, index) decode and pass the client’s verifyVaultTransfer', async () => {
    const { chain, ms, recipient } = await withProposal(Keypair.generate());
    const acc = chain.vaultTransactionAccount(squadsTransactionPda(ms, 1n))!;
    expect(acc.owner).toBe('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');
    expect(verifyVaultTransfer(decodeVaultTransaction(acc.data), { multisig: ms, txIndex: 1, recipient, amountUnits: 1_500_000, opId: `pqa-op1:${'cd'.repeat(32)}` })).toMatchObject({ amountUnits: 1_500_000, recipient });
    expect(chain.vaultTransactionAccount(squadsTransactionPda(ms, 2n))).toBeNull();
  });
});
