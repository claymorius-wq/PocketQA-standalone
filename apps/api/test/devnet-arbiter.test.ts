import { Keypair, PublicKey } from '@solana/web3.js';
import * as multisig from '@sqds/multisig';
import { beforeEach, describe, expect, it } from 'vitest';
import { arbiterApprove, ArbiterRefusal, type ArbiterChain, type ArbiterPlan } from '../src/settlement/squads/arbiter';
import { ataOf, operationId, sortMembers } from '../src/settlement/squads/adapter';
import { MAINNET_GENESIS, PERM } from '../src/settlement/squads/pins';
import { FakeDevnetChain } from './fakeDevnetChain';

// The arbiter's operator CLI logic (devnet-phase-contract.md §2): it reads the Squads vault
// transaction on devnet itself, refuses anything but the exact payment created by the pinned
// platform key, and only with `send` signs ONE proposal_approve with the arbiter's key.
let chain: FakeDevnetChain;
let plan: ArbiterPlan;
const builder = Keypair.generate().publicKey.toBase58();
const recipient = Keypair.generate().publicKey.toBase58();

const asArbiterChain = (c: FakeDevnetChain): ArbiterChain => ({
  genesisHash: () => c.genesisHash(),
  account: async (address) => c.vaultTransactionAccount(address),
  getProposal: (ms, i) => c.getProposal(ms, i),
  getMultisig: (ms) => c.getMultisig(ms),
  blockhash: async () => ({ recentBlockhash: new PublicKey(new Uint8Array(32).fill(3)).toBase58(), lastValidBlockHeight: 1_150 }),
  send: async (wire) => c.walletSend(wire),
});
const run = (over: Partial<ArbiterPlan> = {}, send = false, arbiter = chain.arbiterKp, platform = chain.roles.platform, arbiterPubkey = arbiter.publicKey.toBase58()) =>
  arbiterApprove({ chain: asArbiterChain(chain), arbiter, arbiterPubkey, platform, plan: { ...plan, ...over }, send });

beforeEach(async () => {
  chain = new FakeDevnetChain();
  const createKey = new PublicKey(chain.createKeyFor('s1'));
  const [ms] = multisig.getMultisigPda({ createKey });
  const [vault] = multisig.getVaultPda({ multisigPda: ms, index: 0 });
  const members = sortMembers([
    { key: builder, mask: PERM.vote },
    { key: chain.roles.platform, mask: PERM.initiate | PERM.vote | PERM.execute },
    { key: chain.roles.arbiter, mask: PERM.vote },
  ]);
  const op = operationId('payout', 's1', 'p1');
  const steps = [
    { step: 'multisig_create' as const, studyId: 's1', multisig: ms.toBase58(), members, threshold: 2 },
    { step: 'vault_tx_create' as const, multisig: ms.toBase58(), index: 1n, vaultAuthority: vault.toBase58(), source: ataOf(vault.toBase58()), destination: ataOf(recipient), amount: 1_000n, operation: op },
    { step: 'proposal_create' as const, multisig: ms.toBase58(), index: 1n },
  ];
  for (const s of steps) await chain.broadcast(await chain.prepare(s));
  plan = { multisig: ms.toBase58(), txIndex: 1, opId: op, recipient, amountUnits: 1_000 };
});

describe('arbiterApprove (operator CLI, dispute overturn)', () => {
  it('the exact payment: a dry run checks and sends nothing; --send votes once, with the arbiter key', async () => {
    const dry = await run();
    expect(dry).toMatchObject({ checked: { amountUnits: 1_000, recipient }, signature: null });
    expect(chain.landed.filter((l) => l.step === 'cosigner_approve')).toHaveLength(0);
    const sent = await run({}, true);
    expect(sent.signature).toBeTruthy();
    expect((await chain.getProposal(plan.multisig, 1n))!.approved).toEqual([chain.roles.arbiter]);
    expect(await run({}, true)).toMatchObject({ alreadyApproved: true, signature: null });
    expect(chain.landed.filter((l) => l.step === 'cosigner_approve')).toHaveLength(1);
  });

  it.each([
    ['another amount', { amountUnits: 1_001 }, /amount/],
    ['another recipient', { recipient: Keypair.generate().publicKey.toBase58() }, /recipient/],
    ['another payment (op id)', { opId: operationId('payout', 's1', 'p2') }, /operation id/],
    ['another index', { txIndex: 2 }, /no Squads vault transaction/],
  ])('%s: refused, nothing signed', async (_, over, why) => {
    await expect(run(over, true)).rejects.toThrow(why);
    expect(chain.landed.filter((l) => l.step === 'cosigner_approve')).toHaveLength(0);
  });

  it('a vault transaction not created by the pinned platform key, a non-devnet genesis, or a key that is not the arbiter: refused', async () => {
    await expect(run({}, true, chain.arbiterKp, Keypair.generate().publicKey.toBase58())).rejects.toThrow(/platform key/);
    await expect(run({}, true, Keypair.generate())).rejects.toThrow(/not a voting member/);
    chain.genesis = MAINNET_GENESIS;
    await expect(run({}, true)).rejects.toBeInstanceOf(ArbiterRefusal);
    expect(chain.landed.filter((l) => l.step === 'cosigner_approve')).toHaveLength(0);
  });
});

describe('the arbiter key itself (pqa-qa P3-A1)', () => {
  it('refuses the PLATFORM key as --key-file: the server key never casts the arbiter vote', async () => {
    await expect(run({}, true, chain.platformKp, chain.roles.platform, chain.roles.platform)).rejects.toThrow(/platform key/);
    expect(chain.landed.filter((l) => l.step === 'cosigner_approve')).toHaveLength(0);
  });
  it('refuses a key file that is not the pinned --arbiter public key', async () => {
    await expect(run({}, true, Keypair.generate(), chain.roles.platform, chain.roles.arbiter)).rejects.toThrow(/--arbiter/);
    expect(chain.landed.filter((l) => l.step === 'cosigner_approve')).toHaveLength(0);
  });
});
