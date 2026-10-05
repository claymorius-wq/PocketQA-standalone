import { Keypair, PublicKey, VersionedTransaction, type AccountInfo, type Connection } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { describe, expect, it } from 'vitest';
import { ataOf } from '../src/settlement/squads/adapter';
import { DEVNET_GENESIS, MAINNET_GENESIS, PILOT_MINT, SQUADS_PROGRAM, SQUADS_PROGRAM_DATA } from '../src/settlement/squads/pins';
import { RpcSquadsChain } from '../src/settlement/squads/rpcChain';
import { SettlementFailure } from '../src/settlement/types';

// The RPC chain offline: a stub Connection captures what it would send, and the Squads SDK's own
// codecs turn that into the account the program would store. This proves the round trip the live
// pilot relies on: the vault transaction Pocket QA proposes decodes back to exactly the planned
// TransferChecked, and nothing is signed off devnet.
const PROGRAM = new PublicKey(SQUADS_PROGRAM);
const roles = { builder: Keypair.generate(), pocketqa: Keypair.generate(), arbiter: Keypair.generate() };

function stub(over: Partial<Record<keyof Connection, unknown>> = {}) {
  const sent: VersionedTransaction[] = [];
  const accounts = new Map<string, AccountInfo<Buffer>>();
  const conn = {
    getGenesisHash: async () => DEVNET_GENESIS,
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    getAccountInfo: async (k: PublicKey) => accounts.get(k.toBase58()) ?? null,
    sendTransaction: async (tx: VersionedTransaction) => {
      sent.push(tx);
      return 'sig' + sent.length;
    },
    confirmTransaction: async () => ({ context: { slot: 1 }, value: { err: null } }),
    getTransaction: async () => ({ slot: 1, meta: { fee: 5000 } }),
    ...over,
  } as unknown as Connection;
  return { conn, sent, accounts };
}

/** The VaultTransaction account the program would store for a captured vault_transaction_create. */
function storedVaultTransaction(tx: VersionedTransaction, ms: PublicKey, index: bigint): AccountInfo<Buffer> {
  const ix = tx.message.compiledInstructions.find((i) => tx.message.staticAccountKeys[i.programIdIndex]!.equals(PROGRAM))!;
  const [args] = multisig.generated.vaultTransactionCreateStruct.deserialize(Buffer.from(ix.data));
  const [message] = multisig.types.transactionMessageBeet.deserialize(Buffer.from(args.args.transactionMessage));
  const vt = multisig.accounts.VaultTransaction.fromArgs({
    multisig: ms,
    creator: roles.pocketqa.publicKey,
    index: Number(index),
    bump: 255,
    vaultIndex: 0,
    vaultBump: 255,
    ephemeralSignerBumps: new Uint8Array(),
    message: {
      numSigners: message.numSigners,
      numWritableSigners: message.numWritableSigners,
      numWritableNonSigners: message.numWritableNonSigners,
      accountKeys: message.accountKeys,
      instructions: message.instructions.map((i) => ({ programIdIndex: i.programIdIndex, accountIndexes: new Uint8Array(i.accountIndexes), data: new Uint8Array(i.data) })),
      addressTableLookups: [],
    },
  });
  const [data] = vt.serialize();
  return { data, owner: PROGRAM, executable: false, lamports: 1, rentEpoch: 0 };
}

describe('RpcSquadsChain', () => {
  const ms = multisig.getMultisigPda({ createKey: Keypair.generate().publicKey })[0];
  const vault = multisig.getVaultPda({ multisigPda: ms, index: 0 })[0];
  const plan = { multisig: ms.toBase58(), index: 1n, vaultAuthority: vault.toBase58(), source: ataOf(vault.toBase58()), destination: ataOf(roles.builder.publicKey.toBase58()), amount: 1_234_567n };

  it('proposes one TransferChecked that decodes back to exactly the plan (C3)', async () => {
    const { conn, sent, accounts } = stub();
    const chain = new RpcSquadsChain(conn, roles);
    await chain.createVaultTransfer(plan);
    expect(sent).toHaveLength(1);
    // Fee payer Pocket QA; only Pocket QA signs a proposal.
    expect(sent[0]!.message.staticAccountKeys[0]!.equals(roles.pocketqa.publicKey)).toBe(true);
    expect(sent[0]!.message.header.numRequiredSignatures).toBe(1);
    const [txPda] = multisig.getTransactionPda({ multisigPda: ms, index: 1n });
    accounts.set(txPda.toBase58(), storedVaultTransaction(sent[0]!, ms, 1n));
    expect(await chain.getVaultTransfer(plan.multisig, 1n)).toEqual({
      instructions: 1,
      program: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      opcode: 12,
      source: plan.source,
      mint: PILOT_MINT,
      destination: plan.destination,
      authority: plan.vaultAuthority,
      amount: 1_234_567n,
      decimals: 6,
    });
  });

  it('refuses to sign when the RPC is not devnet: nothing is sent', async () => {
    const { conn, sent } = stub({ getGenesisHash: async () => MAINNET_GENESIS });
    const chain = new RpcSquadsChain(conn, roles);
    await expect(chain.createVaultTransfer(plan)).rejects.toBeInstanceOf(SettlementFailure);
    await expect(chain.approve(plan.multisig, 1n, 'builder')).rejects.toBeInstanceOf(SettlementFailure);
    expect(sent).toEqual([]);
  });

  it('an approval is signed by that member, with Pocket QA paying the fee', async () => {
    const { conn, sent } = stub();
    await new RpcSquadsChain(conn, roles).approve(plan.multisig, 1n, 'arbiter');
    const keys = sent[0]!.message.staticAccountKeys.slice(0, sent[0]!.message.header.numRequiredSignatures).map((k) => k.toBase58());
    expect(keys).toEqual([roles.pocketqa.publicKey.toBase58(), roles.arbiter.publicKey.toBase58()]);
  });

  it('reports a failed landed transaction as an error, never as success', async () => {
    const { conn } = stub({ confirmTransaction: async () => ({ context: { slot: 1 }, value: { err: { InstructionError: [0, { Custom: 6012 }] } } }) });
    await expect(new RpcSquadsChain(conn, roles).createProposal(plan.multisig, 1n)).rejects.toThrow(/failed on devnet/);
  });

  it('accepts only the pinned upgradeable program and program-data account', async () => {
    const programAccount = (programData: PublicKey, owner = 'BPFLoaderUpgradeab1e11111111111111111111111') => {
      const data = Buffer.alloc(36);
      data.writeUInt32LE(2, 0);
      programData.toBuffer().copy(data, 4);
      return { data, owner: new PublicKey(owner), executable: true, lamports: 1, rentEpoch: 0 };
    };
    for (const [info, ok] of [
      [programAccount(new PublicKey(SQUADS_PROGRAM_DATA)), true],
      [programAccount(Keypair.generate().publicKey), false],
      [programAccount(new PublicKey(SQUADS_PROGRAM_DATA), 'BPFLoader2111111111111111111111111111111111'), false],
      [null, false],
    ] as const) {
      const { conn, accounts } = stub();
      if (info) accounts.set(SQUADS_PROGRAM, info);
      expect(await new RpcSquadsChain(conn, roles).programExecutable()).toBe(ok);
    }
  });

  it('reads the mint owner and decimals from the account', async () => {
    const { conn, accounts } = stub();
    const data = Buffer.alloc(82);
    data[44] = 6;
    accounts.set(PILOT_MINT, { data, owner: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), executable: false, lamports: 1, rentEpoch: 0 });
    expect(await new RpcSquadsChain(conn, roles).mintInfo(PILOT_MINT)).toEqual({ owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', decimals: 6 });
  });
});
