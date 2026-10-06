import { base58, base64 } from '@scure/base';
import type { ServerTxPlan } from '../src/wallet/serverTx';
import type { StandardWallet } from '../src/wallet/standard';

// The devnet pilot's server-built transactions (escrow funding; the builder's Squads approval,
// pqa-be3-interfaces.md §2): the client checks the server's plan and the transaction itself, shows
// the plan, and only then asks the wallet to sign and send; the signature is reported to the server.

const mockApi = jest.fn();
jest.mock('../src/api/client', () => ({ api: (...args: unknown[]) => mockApi(...args) }));
const mockMwa = { authorize: jest.fn(), signAndSendTransactions: jest.fn() };
const mockTransact = jest.fn(async (cb: (w: unknown) => unknown) => cb(mockMwa));
jest.mock('@solana-mobile/mobile-wallet-adapter-protocol', () => ({ transact: (cb: (w: unknown) => unknown) => mockTransact(cb) }));
const mockWallets: StandardWallet[] = [];
jest.mock('../src/wallet/registry', () => ({ availableWallets: () => mockWallets }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { checkServerTxPlan, DEVNET_PILOT_COPY, SQUADS_V4 } = require('../src/wallet/serverTx') as typeof import('../src/wallet/serverTx');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const android = require('../src/wallet/signServerTransaction.android') as typeof import('../src/wallet/signServerTransaction.android');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const web = require('../src/wallet/signServerTransaction.web') as typeof import('../src/wallet/signServerTransaction.web');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fallback = require('../src/wallet/signServerTransaction') as typeof import('../src/wallet/signServerTransaction');

const linked = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
const someone = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const vaultAta = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';
const OP = `pqa-op1:${'ab'.repeat(32)}`;

/** A hand-built v0 transaction: one signature slot per signer, static programs, no lookups. */
function v0Tx(o: { feePayer?: string; signers?: number; signed?: boolean; programs?: string[] } = {}): string {
  const signers = o.signers ?? 1;
  const programs = o.programs ?? [SQUADS_V4];
  const keys = [o.feePayer ?? linked, ...(signers > 1 ? [someone] : []), vaultAta, ...programs];
  const bytes: number[] = [signers];
  for (let i = 0; i < signers; i++) bytes.push(...new Array(64).fill(o.signed && i === 0 ? 9 : 0));
  bytes.push(0x80, signers, 0, programs.length, keys.length);
  for (const k of keys) bytes.push(...base58.decode(k));
  bytes.push(...base58.decode(vaultAta)); // blockhash (any 32 bytes)
  bytes.push(programs.length);
  programs.forEach((_, i) => bytes.push(keys.length - programs.length + i, 1, signers, 1, 7));
  bytes.push(0); // no lookup tables
  return base64.encode(Uint8Array.from(bytes));
}
const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const REF = 'AddressLookupTab1e1111111111111111111111111';
const COPY = 'Devnet test USDC, no value · test keys · not independent custody';
/** GET /settlements/:id/approval (contracts SettlementApproval). */
const plan = (over: Record<string, unknown> = {}) => ({ settlementId: 'set-1', kind: 'payout', transactionB64: v0Tx(), multisig: vaultAta, txIndex: 3, opId: OP, amountUnits: 1_500_000, destination: someone, mint: MINT, network: 'devnet', copy: COPY, ...over }) as unknown as ServerTxPlan;
/** GET /escrow/fundings/:id/transaction (contracts DevnetFundingTransaction): a reference, no op id. */
const fundingPlan = (over: Record<string, unknown> = {}) => ({ transactionB64: v0Tx({ programs: ['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'] }), fundingId: 'f-1', studyId: 's-1', reference: REF, amountUnits: 2_200_000, destination: vaultAta, mint: MINT, network: 'devnet', copy: COPY, ...over }) as unknown as ServerTxPlan;
const ctx = { settlement: 'squads_devnet' as const, linkedWallet: linked };

describe('checkServerTxPlan', () => {
  it('returns the plan to show: kind, amount in devnet test USDC, destination, op id and the pilot copy', () => {
    expect(checkServerTxPlan(plan(), ctx)).toEqual({
      kind: 'payout',
      opId: OP,
      reference: null,
      amountUnits: 1_500_000,
      amountText: '1.50 devnet test USDC', // the app's tokenAmount format; the exact units are amountUnits
      destination: someone,
      mint: MINT,
      signer: linked,
      programs: [SQUADS_V4],
      copy: COPY,
    });
    expect(DEVNET_PILOT_COPY).toBe(COPY); // the contracts' DEVNET_COPY
  });

  it('a funding transfer: shown with its reference (a funding has no Squads op id)', () => {
    expect(checkServerTxPlan(fundingPlan(), ctx)).toMatchObject({ kind: 'funding', opId: null, reference: REF, amountUnits: 2_200_000, destination: vaultAta, mint: MINT, copy: COPY });
    expect(() => checkServerTxPlan(fundingPlan({ reference: 'nope' }), ctx)).toThrow(/reference/);
  });

  it.each([
    ['settlement is not the devnet pilot', plan(), { ...ctx, settlement: 'simulated' as const }, /devnet pilot/],
    ['no network', plan({ network: undefined }), ctx, /isn’t for Solana devnet/],
    ['mainnet', plan({ network: 'mainnet-beta' }), ctx, /isn’t for Solana devnet/],
    ['no linked wallet', plan(), { ...ctx, linkedWallet: null }, /Link your devnet wallet/],
    ['another fee payer', plan({ transactionB64: v0Tx({ feePayer: someone }) }), ctx, /not for your linked wallet/],
    ['already signed', plan({ transactionB64: v0Tx({ signed: true }) }), ctx, /already signed/],
    ['a second signer', plan({ transactionB64: v0Tx({ signers: 2 }) }), ctx, /only your wallet/],
    ['an unexpected program', plan({ transactionB64: v0Tx({ programs: ['BPFLoaderUpgradeab1e11111111111111111111111'] }) }), ctx, /unexpected program/],
    ['a fractional amount', plan({ amountUnits: 1.5 }), ctx, /amount/],
    ['a zero amount', plan({ amountUnits: 0 }), ctx, /amount/],
    ['a bad destination', plan({ destination: 'nope' }), ctx, /destination/],
    ['a bad op id', plan({ opId: 'op-1' }), ctx, /operation/],
    ['garbage bytes', plan({ transactionB64: 'AAAA' }), ctx, /valid devnet transaction/],
  ])('refuses: %s', (_name, p, c, msg) => {
    expect(() => checkServerTxPlan(p, c)).toThrow(msg);
  });
});

describe('Android (Mobile Wallet Adapter)', () => {
  const submit = jest.fn(async () => ({}));
  beforeEach(() => {
    mockTransact.mockClear();
    mockMwa.authorize.mockReset();
    mockMwa.signAndSendTransactions.mockReset();
    submit.mockClear();
  });

  it('authorizes on devnet, checks the account, sends the server’s exact bytes and reports the signature', async () => {
    mockMwa.authorize.mockResolvedValue({ accounts: [{ address: base64.encode(base58.decode(linked)) }] });
    const sig = new Uint8Array(64).fill(5);
    mockMwa.signAndSendTransactions.mockResolvedValue({ signatures: [base64.encode(sig)] });
    const p = plan();
    const out = await android.signServerTransaction(p, ctx, submit);
    expect(mockMwa.authorize).toHaveBeenCalledWith(expect.objectContaining({ chain: 'solana:devnet' }));
    expect(mockMwa.signAndSendTransactions).toHaveBeenCalledWith({ payloads: [p.transactionB64] });
    expect(submit).toHaveBeenCalledWith(base58.encode(sig));
    expect(out.signature).toBe(base58.encode(sig));
  });

  it('a different wallet account: nothing is sent', async () => {
    mockMwa.authorize.mockResolvedValue({ accounts: [{ address: base64.encode(base58.decode(someone)) }] });
    await expect(android.signServerTransaction(plan(), ctx, submit)).rejects.toThrow(/not your linked devnet wallet/);
    expect(mockMwa.signAndSendTransactions).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('a refused plan never opens the wallet', async () => {
    await expect(android.signServerTransaction(plan({ network: 'mainnet-beta' }), ctx, submit)).rejects.toThrow(/devnet/);
    expect(mockTransact).not.toHaveBeenCalled();
  });
});

describe('web (Wallet Standard)', () => {
  const submit = jest.fn(async () => ({}));
  const signAndSendTransaction = jest.fn();
  const disconnect = jest.fn(async () => {});
  const account = (address: string) => ({ address, publicKey: base58.decode(address), chains: ['solana:devnet'], features: [] });
  const wallet = (address: string, withSend = true) =>
    ({
      name: 'Fake',
      icon: 'data:image/svg+xml,',
      chains: ['solana:devnet'],
      accounts: [],
      features: {
        'standard:connect': { connect: async () => ({ accounts: [account(address)] }) },
        'standard:disconnect': { disconnect: () => disconnect() },
        ...(withSend ? { 'solana:signAndSendTransaction': { signAndSendTransaction } } : {}),
      },
    }) as unknown as StandardWallet;
  beforeEach(() => {
    signAndSendTransaction.mockReset();
    disconnect.mockClear();
    submit.mockClear();
    mockWallets.length = 0;
  });

  it('signs and sends on solana:devnet with the server’s bytes, disconnects, reports the signature', async () => {
    const sig = new Uint8Array(64).fill(3);
    signAndSendTransaction.mockResolvedValue([{ signature: sig }]);
    const p = plan();
    mockWallets.push(wallet(linked));
    const out = await web.signServerTransaction(p, ctx, submit);
    const [input] = signAndSendTransaction.mock.calls[0]!;
    expect(input.chain).toBe('solana:devnet');
    expect(input.account.address).toBe(linked);
    expect(base64.encode(input.transaction)).toBe(p.transactionB64);
    expect(disconnect).toHaveBeenCalled();
    expect(submit).toHaveBeenCalledWith(base58.encode(sig));
    expect(out.signature).toBe(base58.encode(sig));
  });

  it('a different wallet account or a wallet without signAndSend: nothing is sent', async () => {
    await expect(web.signServerTransaction(plan(), ctx, submit, { wallet: wallet(someone) })).rejects.toThrow(/not your linked devnet wallet/);
    await expect(web.signServerTransaction(plan(), ctx, submit, { wallet: wallet(linked, false) })).rejects.toThrow(/can’t sign and send/);
    expect(signAndSendTransaction).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(disconnect).toHaveBeenCalledTimes(2);
  });

  it('no wallet extension', async () => {
    await expect(web.signServerTransaction(plan(), ctx, submit)).rejects.toThrow(/No Solana wallet/);
  });
});

it('other platforms (iOS) never sign: they say what is needed', async () => {
  await expect(fallback.signServerTransaction(plan(), ctx, jest.fn())).rejects.toThrow(/Android app|browser wallet/);
});
