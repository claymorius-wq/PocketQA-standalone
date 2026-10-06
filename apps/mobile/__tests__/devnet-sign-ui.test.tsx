import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { base58 } from '@scure/base';
import type { SettlementApproval, Study } from '@pocket-qa/contracts';
import { ThemeProvider } from '../src/theme/ThemeProvider';

// Devnet pilot UI for server-built transactions: the builder reviews the decoded plan (what, how
// much, to whom, the operation id or funding reference, the pilot copy), then signs in the wallet.

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const linked = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV';
let mockUser: { id: string; role: string; wallet: { address: string } | null } = { id: 'b1', role: 'builder', wallet: { address: linked } };
jest.mock('../src/auth/SessionProvider', () => ({ useSession: () => ({ user: mockUser }) }));
const mockApi = jest.fn();
jest.mock('../src/api/client', () => {
  class ApiError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { ApiError, api: (...a: unknown[]) => mockApi(...a) };
});
const mockSign = jest.fn();
jest.mock('../src/wallet/signServerTransaction', () => ({ signServerTransaction: (...a: unknown[]) => mockSign(...a) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ServerTxSign } = require('../src/wallet/ServerTxSign') as typeof import('../src/wallet/ServerTxSign');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { EscrowPanel } = require('../src/screens/EscrowPanel') as typeof import('../src/screens/EscrowPanel');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { SQUADS_V4 } = require('../src/wallet/serverTx') as typeof import('../src/wallet/serverTx');

const someone = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';
const vault = 'GHtXQBsoZHVnNFa9YevAzFr17DJjgHXk3ycTKD5xD3Zi';
const MINT = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
const REF = 'AddressLookupTab1e1111111111111111111111111';
const COPY = 'Devnet test USDC, no value · test keys · not independent custody';
const OP = `pqa-op1:${'ab'.repeat(32)}`;
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
function v0Tx(program: string): string {
  const keys = [linked, vault, program];
  const bytes = [1, ...new Array(64).fill(0), 0x80, 1, 0, 1, keys.length];
  for (const k of keys) bytes.push(...base58.decode(k));
  bytes.push(...base58.decode(vault), 1, 2, 1, 1, 1, 7, 0);
  return Buffer.from(Uint8Array.from(bytes)).toString('base64');
}
const approval = (over: Record<string, unknown> = {}) => ({ settlementId: 'set-1', kind: 'payout', transactionB64: v0Tx(SQUADS_V4), multisig: vault, txIndex: 3, opId: OP, amountUnits: 1_000_000, destination: someone, mint: MINT, network: 'devnet', copy: COPY, ...over }) as unknown as SettlementApproval;
const fundingTx = { transactionB64: v0Tx(TOKEN), fundingId: 'f1', studyId: 's1', reference: REF, amountUnits: 3_300_000, destination: vault, mint: MINT, network: 'devnet', copy: COPY };

const METRICS = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 24, left: 0, right: 0, bottom: 16 } };
const tree = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
    <SafeAreaProvider initialMetrics={METRICS}>
      <ThemeProvider fonts="system">{ui}</ThemeProvider>
    </SafeAreaProvider>
  </QueryClientProvider>
);
/** Substring match (a string argument would have to equal the whole text). */
const has = (t: string) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
const settle = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => {
  mockApi.mockReset();
  mockSign.mockReset();
  mockUser = { id: 'b1', role: 'builder', wallet: { address: linked } };
});

describe('ServerTxSign', () => {
  it('review first: the decoded plan with the pilot copy; then the wallet signs and the signature is submitted', async () => {
    const load = jest.fn(async () => approval());
    const submit = jest.fn(async () => ({}));
    const onDone = jest.fn();
    mockSign.mockImplementation(async (plan: unknown, ctx: unknown, send: (s: string) => Promise<unknown>) => {
      await send('5igSent');
      return { signature: '5igSent' };
    });
    await render(tree(<ServerTxSign testID="t" settlement="squads_devnet" reviewLabel="Review payment" signLabel="Approve in your wallet" load={load} submit={submit} onDone={onDone} />));
    expect(screen.queryByTestId('t-sign')).toBeNull(); // nothing to sign before the plan is shown
    await act(async () => fireEvent.press(screen.getByTestId('t-review')));
    await settle();
    const planCard = screen.getByTestId('t-plan');
    expect(planCard).toHaveTextContent(/Reward to the tester/);
    expect(planCard).toHaveTextContent(has('1.00 devnet test USDC'));
    expect(planCard).toHaveTextContent(has(someone));
    expect(planCard).toHaveTextContent(has(OP));
    expect(planCard).toHaveTextContent(has(linked));
    expect(screen.getByTestId('t-copy')).toHaveTextContent(COPY);
    await act(async () => fireEvent.press(screen.getByTestId('t-sign')));
    await settle();
    expect(mockSign).toHaveBeenCalledWith(approval(), { settlement: 'squads_devnet', linkedWallet: linked }, expect.any(Function));
    expect(submit).toHaveBeenCalledWith('5igSent', approval());
    expect(onDone).toHaveBeenCalled();
  });

  it('a plan the client refuses shows why and never offers to sign', async () => {
    await render(tree(<ServerTxSign testID="t" settlement="squads_devnet" reviewLabel="Review" signLabel="Sign" load={async () => approval({ network: 'mainnet-beta' })} submit={jest.fn()} />));
    await act(async () => fireEvent.press(screen.getByTestId('t-review')));
    await settle();
    expect(screen.getByTestId('t-error')).toHaveTextContent(/isn’t for Solana devnet\. Nothing was signed\./);
    expect(screen.queryByTestId('t-sign')).toBeNull();
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('no linked wallet: says to link one', async () => {
    mockUser = { ...mockUser, wallet: null };
    await render(tree(<ServerTxSign testID="t" settlement="squads_devnet" reviewLabel="Review" signLabel="Sign" load={async () => approval()} submit={jest.fn()} />));
    await act(async () => fireEvent.press(screen.getByTestId('t-review')));
    await settle();
    expect(screen.getByTestId('t-error')).toHaveTextContent(/Link your devnet wallet/);
  });

  it('a wallet error is shown, and the plan stays for another try', async () => {
    mockSign.mockRejectedValue(new Error('The wallet account is not your linked devnet wallet. Nothing was sent.'));
    await render(tree(<ServerTxSign testID="t" settlement="squads_devnet" reviewLabel="Review" signLabel="Sign" load={async () => approval()} submit={jest.fn()} />));
    await act(async () => fireEvent.press(screen.getByTestId('t-review')));
    await settle();
    await act(async () => fireEvent.press(screen.getByTestId('t-sign')));
    await settle();
    expect(screen.getByTestId('t-error')).toHaveTextContent(/not your linked devnet wallet/);
    expect(screen.getByTestId('t-plan')).toBeTruthy();
  });
});

describe('EscrowPanel · devnet funding with the wallet', () => {
  const escrowStudy = (): Study & { payment: Extract<Study['payment'], { mode: 'escrow' }> } =>
    ({
      id: 's1',
      payment: {
        mode: 'escrow',
        settlement: 'squads_devnet',
        asset: 'USDC',
        decimals: 6,
        network: 'solana:devnet',
        mint: MINT,
        quote: { rewardUnits: 1_000_000, slots: 3, feeBps: 1000, perTestFeeUnits: 100_000, perTestTotalUnits: 1_100_000, rewardPoolUnits: 3_000_000, platformFeeUnits: 300_000, totalUnits: 3_300_000 },
        funded: false,
        balances: null,
        fundingWallet: null,
        refund: null,
      },
    }) as unknown as Study & { payment: Extract<Study['payment'], { mode: 'escrow' }> };

  it('request → review the server-built transfer → sign in the wallet → the signature is verified', async () => {
    const request = { id: 'f1', status: 'awaiting_payment', amountUnits: 3_300_000, vault, reference: REF, failureReason: null };
    mockApi.mockImplementation(async (name: string) => (name === 'createEscrowFunding' ? request : name === 'escrowFundingTransaction' ? fundingTx : { ...request, status: 'pending' }));
    mockSign.mockImplementation(async (_plan: unknown, _ctx: unknown, send: (s: string) => Promise<unknown>) => {
      await send('5igFund');
      return { signature: '5igFund' };
    });
    await render(tree(<EscrowPanel study={escrowStudy()} />));
    await act(async () => fireEvent.press(screen.getByTestId('escrow-fund')));
    await settle();
    // The manual path stays (paste a signature); the wallet path is offered beside it.
    expect(screen.getByTestId('escrow-pilot-signature')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('escrow-wallet-review')));
    await settle();
    expect(mockApi).toHaveBeenCalledWith('escrowFundingTransaction', { params: { id: 'f1' } });
    expect(screen.getByTestId('escrow-wallet-plan')).toHaveTextContent(has(REF));
    expect(screen.getByTestId('escrow-wallet-plan')).toHaveTextContent(has('3.30 devnet test USDC'));
    await act(async () => fireEvent.press(screen.getByTestId('escrow-wallet-sign')));
    await settle();
    expect(mockApi).toHaveBeenCalledWith('submitFundingSignature', { params: { id: 'f1' }, body: { signature: '5igFund' } });
  });
});
