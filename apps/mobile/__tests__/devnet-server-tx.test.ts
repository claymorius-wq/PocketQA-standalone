import { base58, base64 } from '@scure/base';
import { approvalPlan, approveIx, ATTACKER, COPY, encodeV0, fundingPlan, LINKED, MINT, MULTISIG, OP, REFERENCE, systemTransferIx, transferCheckedIx, VAULT_ATA } from '../test-support/devnetTx';
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
const { checkServerTxPlan, DEVNET_PILOT_COPY } = require('../src/wallet/serverTx') as typeof import('../src/wallet/serverTx');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const android = require('../src/wallet/signServerTransaction.android') as typeof import('../src/wallet/signServerTransaction.android');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const web = require('../src/wallet/signServerTransaction.web') as typeof import('../src/wallet/signServerTransaction.web');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fallback = require('../src/wallet/signServerTransaction') as typeof import('../src/wallet/signServerTransaction');

const linked = LINKED;
const someone = ATTACKER;
const plan = (over: Record<string, unknown> = {}) => approvalPlan(over) as unknown as ServerTxPlan;
const funding = (over: Record<string, unknown> = {}) => fundingPlan(over) as unknown as ServerTxPlan;
const ctx = { settlement: 'squads_devnet' as const, linkedWallet: linked };

describe('checkServerTxPlan (the bytes must match the template; pqa-qa P2-CS1)', () => {
  it('a vote: the multisig and proposal are checked in the bytes; the payment details are only described', () => {
    const c = checkServerTxPlan(plan(), ctx);
    expect(c.kind).toBe('payout');
    expect(c.signer).toBe(linked);
    expect(c.checked.map((r) => r.label)).toEqual(['Vote in multisig', 'On payment proposal']);
    expect(c.checked[0]!.value).toBe(MULTISIG);
    expect(c.checked[1]!.value).toMatch(/^#4 \(/);
    expect(c.described).toEqual([
      { label: 'Amount', value: '1.50 devnet test USDC' },
      { label: 'To', value: someone },
      { label: 'Operation id', value: OP },
    ]);
    expect(c.copy).toBe(COPY);
    expect(DEVNET_PILOT_COPY).toBe(COPY); // the contracts' DEVNET_COPY
  });

  it('a funding: amount, vault, source, reference and mint all come from the bytes', () => {
    const c = checkServerTxPlan(funding(), { ...ctx, expectedDestination: VAULT_ATA });
    expect(c.kind).toBe('funding');
    expect(c.described).toEqual([]);
    expect(Object.fromEntries(c.checked.map((r) => [r.label, r.value]))).toMatchObject({ Amount: '2.20 devnet test USDC', 'To the study vault (token account)': VAULT_ATA, Reference: REFERENCE, 'Token mint': MINT });
  });

  it.each([
    ['settlement is not the devnet pilot', plan(), { ...ctx, settlement: 'simulated' as const }, /devnet pilot/],
    ['no network', plan({ network: undefined }), ctx, /isn’t for Solana devnet/],
    ['mainnet', plan({ network: 'mainnet-beta' }), ctx, /isn’t for Solana devnet/],
    ['no linked wallet', plan(), { ...ctx, linkedWallet: null }, /Link your devnet wallet/],
    ['another fee payer', plan({ transactionB64: encodeV0([approveIx()], ATTACKER) }), ctx, /fee payer/],
    ['already signed', plan({ transactionB64: encodeV0([approveIx()], LINKED, true) }), ctx, /already signed/],
    ['QA repro: a System transfer of 1 SOL presented as a funding', funding({ transactionB64: encodeV0([systemTransferIx()]) }), ctx, /TransferChecked/],
    ['a System transfer next to the vote', plan({ transactionB64: encodeV0([approveIx(), systemTransferIx()]) }), ctx, /extra instruction/],
    ['a vote for another payment index', plan({ transactionB64: encodeV0([approveIx(5n)]) }), ctx, /proposal/],
    ['a funding whose bytes move another amount than the plan says', funding({ transactionB64: encodeV0([transferCheckedIx({ amount: 9_999_999n })]) }), ctx, /amount/],
    ['a funding to another destination', funding({ transactionB64: encodeV0([transferCheckedIx({ dest: ATTACKER })]) }), ctx, /destination/],
    ['a funding to a destination that is not this study’s vault', funding({ destination: ATTACKER, transactionB64: encodeV0([transferCheckedIx({ dest: ATTACKER })]) }), { ...ctx, expectedDestination: VAULT_ATA }, /vault/],
    ['a fractional amount', plan({ amountUnits: 1.5 }), ctx, /amount/],
    ['a zero amount', plan({ amountUnits: 0 }), ctx, /amount/],
    ['a bad destination', plan({ destination: 'nope' }), ctx, /addresses/],
    ['a bad op id', plan({ opId: 'op-1' }), ctx, /operation/],
    ['garbage bytes', plan({ transactionB64: 'AAAA' }), ctx, /valid devnet transaction/],
  ])('refuses: %s', (_name, p, c, msg) => {
    expect(() => checkServerTxPlan(p, c)).toThrow(msg);
    expect(() => checkServerTxPlan(p, c)).toThrow(/Nothing was signed\./);
  });
});

describe('checkServerTxPlan: the approval is the one this screen asked for', () => {
  const expectRefund = { settlementId: 'set-1', kind: 'refund' as const, amountUnits: 1_500_000, destination: someone };
  const refund = (over: Record<string, unknown> = {}) => plan({ kind: 'refund', ...over });

  it('a refund vote that matches the study’s refund (id, kind, amount, funding wallet)', () => {
    const c = checkServerTxPlan(refund(), { ...ctx, expectedApproval: expectRefund });
    expect(c.kind).toBe('refund');
  });

  it.each([
    ['another settlement', refund({ settlementId: 'set-2' }), /not the payment you are approving/],
    ['another kind (a payout offered as the refund)', refund({ kind: 'payout' }), /not the payment you are approving/],
    ['another amount than the study’s refund', refund({ amountUnits: 2_000_000 }), /amount differs/],
    ['another recipient than the funding wallet', refund({ destination: LINKED }), /recipient differs/],
  ])('refuses: %s', (_n, p, msg) => {
    expect(() => checkServerTxPlan(p, { ...ctx, expectedApproval: expectRefund })).toThrow(msg);
    expect(() => checkServerTxPlan(p, { ...ctx, expectedApproval: expectRefund })).toThrow(/Nothing was signed\./);
  });

  it('a funding plan is never accepted where an approval is expected', () => {
    expect(() => checkServerTxPlan(funding(), { ...ctx, expectedApproval: expectRefund })).toThrow(/not the payment you are approving/);
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
