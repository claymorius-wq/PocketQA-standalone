import { randomBytes } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import { Keypair, PublicKey, VersionedTransaction, type Connection } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { productionConnectors } from '../src/hosted/app';
import { RpcDevnetChain } from '../src/settlement/squads/rpcDevnetChain';
import { SettlementFailure, SettlementPending } from '../src/settlement/types';
import { DEVNET_GENESIS, MAINNET_GENESIS, PILOT_MINT } from '../src/settlement/squads/pins';

// pqa-qa N-1: the RPC DevnetChain holds ONE key (the platform signer) and signs only with it.
// A stub Connection: no network in this suite.
function stub(genesis = DEVNET_GENESIS) {
  const sent: Buffer[] = [];
  let blockhashCalls = 0;
  const conn = {
    getGenesisHash: async () => genesis,
    getLatestBlockhash: async () => {
      blockhashCalls += 1;
      return { blockhash: base58.encode(randomBytes(32)), lastValidBlockHeight: 1_234 };
    },
    getBlockHeight: async () => 1_000,
    sendRawTransaction: async (b: Buffer) => {
      sent.push(Buffer.from(b));
      return 'sig';
    },
  } as unknown as Connection;
  return { conn, sent, blockhashCalls: () => blockhashCalls };
}
const platform = Keypair.generate();
const arbiter = Keypair.generate().publicKey.toBase58();
const ms = Keypair.generate().publicKey.toBase58();
const decode = (b64: string) => VersionedTransaction.deserialize(Buffer.from(b64, 'base64'));

describe('RpcDevnetChain (pqa-qa N-1)', () => {
  it('roles.platform is the loaded key, and every prepared transaction is signed by exactly that key (fee payer, the only signature)', async () => {
    const { conn } = stub();
    const chain = new RpcDevnetChain(conn, platform, arbiter);
    expect(chain.roles).toEqual({ platform: platform.publicKey.toBase58(), arbiter });
    for (const step of ['proposal_create', 'approve_platform'] as const) {
      const p = await chain.prepare({ step, multisig: ms, index: 3n });
      const tx = decode(p.wireB64);
      expect(tx.message.staticAccountKeys[0]!.toBase58()).toBe(platform.publicKey.toBase58());
      expect(tx.message.header.numRequiredSignatures).toBe(1);
      expect(p.signature).toBe(base58.encode(tx.signatures[0]!));
      expect(ed25519.verify(tx.signatures[0]!, tx.message.serialize(), platform.publicKey.toBytes())).toBe(true);
      expect(Buffer.from(tx.message.serialize()).toString('base64')).toBe(p.messageB64);
    }
  });

  it('the platform vote names the platform as the member, never another key', async () => {
    const tx = decode((await new RpcDevnetChain(stub().conn, platform, arbiter).prepare({ step: 'approve_platform', multisig: ms, index: 1n })).wireB64);
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys).toContain(platform.publicKey.toBase58());
    expect(keys).not.toContain(arbiter);
  });

  it('a non-devnet genesis: refused before anything is built or signed', async () => {
    const s = stub(MAINNET_GENESIS);
    await expect(new RpcDevnetChain(s.conn, platform, arbiter).prepare({ step: 'proposal_create', multisig: ms, index: 1n })).rejects.toBeInstanceOf(SettlementFailure);
    expect(s.blockhashCalls()).toBe(0);
  });

  it('broadcast sends the exact prepared bytes; a rejected send is pending (the next run reads the signature)', async () => {
    const s = stub();
    const chain = new RpcDevnetChain(s.conn, platform, arbiter);
    const p = await chain.prepare({ step: 'proposal_create', multisig: ms, index: 1n });
    await chain.broadcast(p);
    expect(s.sent[0]!.toString('base64')).toBe(p.wireB64);
    (s.conn as unknown as { sendRawTransaction: () => never }).sendRawTransaction = () => {
      throw new Error('Blockhash not found');
    };
    await expect(chain.broadcast(p)).rejects.toBeInstanceOf(SettlementPending);
  });

  it('the funding transfer: unsigned, the builder pays, TransferChecked of the pinned mint to the vault, the reference as its 5th read-only account', async () => {
    const from = Keypair.generate().publicKey.toBase58();
    const vaultAta = Keypair.generate().publicKey.toBase58();
    const reference = Keypair.generate().publicKey.toBase58();
    const tx = decode((await new RpcDevnetChain(stub().conn, platform, arbiter).buildFundingTransfer({ from, vaultAta, amount: 3_000n, reference })).wireB64);
    const keys = tx.message.staticAccountKeys.map((k) => k.toBase58());
    expect(keys[0]).toBe(from);
    expect(tx.signatures.every((sig) => sig.every((b) => b === 0))).toBe(true);
    const [ix] = tx.message.compiledInstructions;
    const accounts = ix!.accountKeyIndexes.map((i) => keys[i]);
    expect(accounts[1]).toBe(PILOT_MINT);
    expect(accounts[2]).toBe(vaultAta);
    expect(accounts[3]).toBe(from);
    expect(accounts[4]).toBe(reference);
    expect(tx.message.isAccountSigner(ix!.accountKeyIndexes[4]!)).toBe(false);
    expect(tx.message.isAccountWritable(ix!.accountKeyIndexes[4]!)).toBe(false);
    expect(Buffer.from(ix!.data).readBigUInt64LE(1)).toBe(3_000n);
  });

  it('the cosigner vote: unsigned, the member pays and is the only required signer', async () => {
    const member = Keypair.generate().publicKey.toBase58();
    const tx = decode((await new RpcDevnetChain(stub().conn, platform, arbiter).buildCosignerApprove(ms, 2n, member)).wireB64);
    expect(tx.message.staticAccountKeys[0]!.toBase58()).toBe(member);
    expect(tx.message.staticAccountKeys.map((k) => k.toBase58())).not.toContain(platform.publicKey.toBase58());
    expect(tx.signatures.every((sig) => sig.every((b) => b === 0))).toBe(true);
  });

  it('create keys are derived per study from the platform secret, never the platform key itself', () => {
    const chain = new RpcDevnetChain(stub().conn, platform, arbiter);
    expect(chain.createKeyFor('s1')).toBe(chain.createKeyFor('s1'));
    expect(chain.createKeyFor('s1')).not.toBe(chain.createKeyFor('s2'));
    expect(chain.createKeyFor('s1')).not.toBe(platform.publicKey.toBase58());
    expect(new PublicKey(chain.createKeyFor('s1')).toBase58()).toBe(chain.createKeyFor('s1'));
  });
});

describe('the production connector signs with the checked key (pqa-qa N-1)', () => {
  const env = (signer: Keypair, pinned: string) => ({
    POCKETQA_ENV: 'devnet',
    POCKETQA_DATA_BACKEND: 'firestore',
    POCKETQA_AUTH_MODE: 'firebase',
    POCKETQA_FIREBASE_PROJECT_ID: 'pocketqa-optijara',
    POCKETQA_FIREBASE_WEB_API_KEY: 'public-web-key', // check-secrets: allow (placeholder public Firebase web config in tests)
    POCKETQA_PUBLIC_ORIGIN: 'https://pocketqa-devnet.example',
    POCKETQA_STORAGE: 'r2',
    POCKETQA_R2_ACCOUNT_ID: 'a'.repeat(32),
    POCKETQA_R2_BUCKET: 'pocketqa-evidence',
    POCKETQA_R2_ACCESS_KEY_ID: 'key-id',
    POCKETQA_R2_SECRET_ACCESS_KEY: 'not-a-real-secret', // check-secrets: allow (placeholder test value)
    POCKETQA_R2_ALLOW_DELETE: '1',
    POCKETQA_SETTLEMENT: 'squads_devnet',
    POCKETQA_DEVNET_PLATFORM_SIGNER: JSON.stringify(Array.from(signer.secretKey)),
    POCKETQA_DEVNET_PLATFORM_PUBKEY: pinned,
    POCKETQA_DEVNET_ARBITER_PUBKEY: arbiter,
    POCKETQA_DEVNET_FEE_WALLET: Keypair.generate().publicKey.toBase58(),
    POCKETQA_DEVNET_ALLOWED_EMAILS: 'devnet-builder@example.test',
  });
  it('the RPC chain it builds has roles.platform = the pinned, loaded key', () => {
    const e = env(platform, platform.publicKey.toBase58());
    const chain = productionConnectors.devnetChain(loadConfig(e), e);
    expect(chain).toBeInstanceOf(RpcDevnetChain);
    expect(chain.roles.platform).toBe(platform.publicKey.toBase58());
  });
  it('a signer that is not the pinned key never yields a chain', () => {
    const e = env(Keypair.generate(), platform.publicKey.toBase58());
    expect(() => productionConnectors.devnetChain(loadConfig(e), e)).toThrow(/not POCKETQA_DEVNET_PLATFORM_PUBKEY/);
  });
});
