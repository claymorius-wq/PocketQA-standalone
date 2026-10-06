import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { SettlementApproval, Study } from '@pocket-qa/contracts';
import { ThemeProvider } from '../src/theme/ThemeProvider';
import { approvalPlan, ATTACKER, COPY, encodeV0, fundingPlan, MINT, MULTISIG, OP, REFERENCE, systemTransferIx, transferCheckedIx, VAULT_ATA } from '../test-support/devnetTx';

// Devnet pilot UI for server-built transactions: the builder reviews the decoded plan (what, how
// much, to whom, the operation id or funding reference, the pilot copy), then signs in the wallet.

jest.mock('lucide-react-native', () =>
  jest.requireActual(jest.requireActual<typeof import('node:path')>('node:path').join(process.cwd(), '../../node_modules/lucide-react-native/dist/cjs/lucide-react-native.js')),
);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
const linked = '7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV'; // test-support LINKED (jest.mock factories can't import)
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
const mockRead = jest.fn();
// The devnet read of a vote's payment (devnetRpc.ts, tested on its own); never the network here.
jest.mock('../src/wallet/devnetRpc', () => ({ readVaultTransfer: (...a: unknown[]) => mockRead(...a) }));
const mockSign = jest.fn();
jest.mock('../src/wallet/signServerTransaction', () => ({ signServerTransaction: (...a: unknown[]) => mockSign(...a) }));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { ServerTxSign } = require('../src/wallet/ServerTxSign') as typeof import('../src/wallet/ServerTxSign');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { EscrowPanel } = require('../src/screens/EscrowPanel') as typeof import('../src/screens/EscrowPanel');
const vault = VAULT_ATA;
const REF = REFERENCE;
const approval = (over: Record<string, unknown> = {}) => approvalPlan(over) as unknown as SettlementApproval;
const fundingTx = fundingPlan({ fundingId: 'f1', studyId: 's1', amountUnits: 3_300_000, transactionB64: encodeV0([transferCheckedIx({ amount: 3_300_000n })]) });

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
  mockRead.mockReset();
  mockRead.mockResolvedValue({ state: 'unavailable', reason: 'We couldn’t reach Solana devnet to read the payment' });
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
    expect(screen.getByText(/Reward to the tester · checked in this transaction/)).toBeTruthy();
    // Checked (read from the bytes): the multisig, the proposal, the signer.
    const planCard = screen.getByTestId('t-plan');
    expect(planCard).toHaveTextContent(has(MULTISIG));
    expect(planCard).toHaveTextContent(/#4 \(/);
    expect(planCard).toHaveTextContent(has(linked));
    // A vote's bytes don't hold the amount or destination: shown as described, never as checked (P2-CS1).
    expect(planCard).not.toHaveTextContent(has('1.50 devnet test USDC'));
    expect(planCard).not.toHaveTextContent(has(ATTACKER));
    expect(mockRead).toHaveBeenCalledWith(approval());
    expect(screen.getByText(/As described by Pocket QA \(not in this transaction\)/)).toBeTruthy();
    expect(screen.queryByText(/checked on chain/)).toBeNull(); // pqa-qa CS3: no claim the client didn't make
    expect(screen.getByTestId('t-described-note')).toHaveTextContent(/couldn’t reach Solana devnet/);
    const described = screen.getByTestId('t-described');
    expect(described).toHaveTextContent(has('1.50 devnet test USDC'));
    expect(described).toHaveTextContent(has(ATTACKER));
    expect(described).toHaveTextContent(has(OP));
    expect(screen.getByTestId('t-copy')).toHaveTextContent(COPY);
    await act(async () => fireEvent.press(screen.getByTestId('t-sign')));
    await settle();
    expect(mockSign).toHaveBeenCalledWith(approval(), { settlement: 'squads_devnet', linkedWallet: linked }, expect.any(Function));
    expect(submit).toHaveBeenCalledWith('5igSent', approval());
    expect(onDone).toHaveBeenCalled();
  });

  it('pqa-qa CS3: the payment read on devnet matches → amount, recipient and op id are checked, nothing is described', async () => {
    mockRead.mockResolvedValue({ state: 'checked', amountUnits: 1_500_000, recipient: ATTACKER, opId: OP });
    await render(tree(<ServerTxSign testID="t" settlement="squads_devnet" reviewLabel="Review" signLabel="Sign" load={async () => approval()} submit={jest.fn()} />));
    await act(async () => fireEvent.press(screen.getByTestId('t-review')));
    await settle();
    const planCard = screen.getByTestId('t-plan');
    expect(planCard).toHaveTextContent(has('1.50 devnet test USDC'));
    expect(planCard).toHaveTextContent(has(ATTACKER));
    expect(planCard).toHaveTextContent(has(OP));
    expect(screen.queryByTestId('t-described')).toBeNull();
    expect(screen.queryByText(/As described by Pocket QA/)).toBeNull();
    expect(screen.getByTestId('t-sign')).toBeTruthy();
  });

  it('pqa-qa CS3: the payment on devnet differs from the plan → refused, nothing to sign', async () => {
    mockRead.mockResolvedValue({ state: 'mismatch', reason: 'The payment on Solana devnet doesn’t match what Pocket QA described: the amount differs.' });
    await render(tree(<ServerTxSign testID="t" settlement="squads_devnet" reviewLabel="Review" signLabel="Sign" load={async () => approval()} submit={jest.fn()} />));
    await act(async () => fireEvent.press(screen.getByTestId('t-review')));
    await settle();
    expect(screen.getByTestId('t-error')).toHaveTextContent(/the amount differs\. Nothing was signed\./);
    expect(screen.queryByTestId('t-sign')).toBeNull();
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('a funding is never read as a vote on devnet (its bytes already hold the transfer)', async () => {
    await render(tree(<ServerTxSign testID="t" settlement="squads_devnet" expectedDestination={vault} reviewLabel="Review" signLabel="Sign" load={async () => fundingPlan() as never} submit={jest.fn()} />));
    await act(async () => fireEvent.press(screen.getByTestId('t-review')));
    await settle();
    expect(screen.getByTestId('t-plan')).toBeTruthy();
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('every address on the card wraps inside it (a value you must verify is never cut off at phone width)', async () => {
    mockRead.mockResolvedValue({ state: 'checked', amountUnits: 1_500_000, recipient: ATTACKER, opId: OP });
    await render(tree(<ServerTxSign testID="t" settlement="squads_devnet" reviewLabel="Review" signLabel="Sign" load={async () => approval()} submit={jest.fn()} />));
    await act(async () => fireEvent.press(screen.getByTestId('t-review')));
    await settle();
    for (const value of [MULTISIG, ATTACKER, OP, linked]) {
      const style = StyleSheet.flatten(screen.getByText(value).props.style) as Record<string, unknown>;
      expect(style).toMatchObject({ flexShrink: 1, textAlign: 'right' });
      expect(style.flex).toBeGreaterThan(0);
    }
  });

  it('a plan the client refuses shows why and never offers to sign', async () => {
    await render(tree(<ServerTxSign testID="t" settlement="squads_devnet" reviewLabel="Review" signLabel="Sign" load={async () => approval({ network: 'mainnet-beta' })} submit={jest.fn()} />));
    await act(async () => fireEvent.press(screen.getByTestId('t-review')));
    await settle();
    expect(screen.getByTestId('t-error')).toHaveTextContent(/isn’t for Solana devnet\. Nothing was signed\./);
    expect(screen.queryByTestId('t-sign')).toBeNull();
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('QA repro (P2-CS1): a funding plan whose bytes are a System transfer is refused; nothing to sign', async () => {
    const evil = fundingPlan({ transactionB64: encodeV0([systemTransferIx()]) });
    await render(tree(<ServerTxSign testID="t" settlement="squads_devnet" expectedDestination={vault} reviewLabel="Review" signLabel="Sign" load={async () => evil as never} submit={jest.fn()} />));
    await act(async () => fireEvent.press(screen.getByTestId('t-review')));
    await settle();
    expect(screen.getByTestId('t-error')).toHaveTextContent(/TransferChecked.*Nothing was signed\./);
    expect(screen.queryByTestId('t-sign')).toBeNull();
    expect(screen.queryByTestId('t-plan')).toBeNull();
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('a funding whose destination is not the vault of this request is refused', async () => {
    const other = fundingPlan({ destination: ATTACKER, transactionB64: encodeV0([transferCheckedIx({ dest: ATTACKER })]) });
    await render(tree(<ServerTxSign testID="t" settlement="squads_devnet" expectedDestination={vault} reviewLabel="Review" signLabel="Sign" load={async () => other as never} submit={jest.fn()} />));
    await act(async () => fireEvent.press(screen.getByTestId('t-review')));
    await settle();
    expect(screen.getByTestId('t-error')).toHaveTextContent(/vault.*Nothing was signed\./);
    expect(screen.queryByTestId('t-sign')).toBeNull();
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
    // A funding transfer's amount, vault, reference and mint are all checked in the bytes.
    expect(screen.getByTestId('escrow-wallet-plan')).toHaveTextContent(has(REF));
    expect(screen.getByTestId('escrow-wallet-plan')).toHaveTextContent(has('3.30 devnet test USDC'));
    expect(screen.getByTestId('escrow-wallet-plan')).toHaveTextContent(has(vault));
    expect(screen.getByTestId('escrow-wallet-plan')).toHaveTextContent(has(MINT));
    expect(screen.queryByTestId('escrow-wallet-described')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('escrow-wallet-sign')));
    await settle();
    expect(mockApi).toHaveBeenCalledWith('submitFundingSignature', { params: { id: 'f1' }, body: { signature: '5igFund' } });
  });

  it('devnet refund awaiting the builder’s vote: review the vote (refund) → sign → submitted with its index and op id', async () => {
    const study = escrowStudy();
    study.payment = { ...study.payment, funded: true, fundingWallet: ATTACKER, refund: { settlementId: 'set-r', status: 'awaiting_approval', amountUnits: 1_500_000 } } as typeof study.payment;
    const plan = approvalPlan({ settlementId: 'set-r', kind: 'refund' });
    mockApi.mockImplementation(async (name: string) => (name === 'settlementApproval' ? plan : { settlementId: 'set-r', kind: 'refund', status: 'submitted', signature: '5igRefund', network: 'devnet' }));
    mockSign.mockImplementation(async (_p: unknown, _c: unknown, send: (s: string) => Promise<unknown>) => {
      await send('5igRefund');
      return { signature: '5igRefund' };
    });
    await render(tree(<EscrowPanel study={study} />));
    expect(screen.queryByTestId('escrow-refund-approval-sign')).toBeNull();
    await act(async () => fireEvent.press(screen.getByTestId('escrow-refund-approval-review')));
    await settle();
    expect(mockApi).toHaveBeenCalledWith('settlementApproval', { params: { id: 'set-r' } });
    expect(screen.getByText(/Refund to the funding wallet · checked in this transaction/)).toBeTruthy();
    expect(screen.getByTestId('escrow-refund-approval-described')).toHaveTextContent(has(ATTACKER));
    await act(async () => fireEvent.press(screen.getByTestId('escrow-refund-approval-sign')));
    await settle();
    expect(mockApi).toHaveBeenCalledWith('submitSettlementApproval', { params: { id: 'set-r' }, body: { signature: '5igRefund', txIndex: 4, opId: OP } });
  });

  it('a refund vote is refused when the server offers a different payment than the study’s refund', async () => {
    const study = escrowStudy();
    study.payment = { ...study.payment, funded: true, fundingWallet: ATTACKER, refund: { settlementId: 'set-r', status: 'awaiting_approval', amountUnits: 1_500_000 } } as typeof study.payment;
    mockApi.mockImplementation(async () => approvalPlan({ settlementId: 'set-r', kind: 'refund', destination: linked }));
    await render(tree(<EscrowPanel study={study} />));
    await act(async () => fireEvent.press(screen.getByTestId('escrow-refund-approval-review')));
    await settle();
    expect(screen.getByTestId('escrow-refund-approval-error')).toHaveTextContent(/recipient differs.*Nothing was signed/);
    expect(screen.queryByTestId('escrow-refund-approval-sign')).toBeNull();
  });

  it.each(['pending', 'submitted', 'confirmed', 'failed'])('no refund vote is offered when the refund is %s', async (status) => {
    const study = escrowStudy();
    study.payment = { ...study.payment, funded: true, fundingWallet: ATTACKER, refund: { settlementId: 'set-r', status, amountUnits: 1_500_000 } } as typeof study.payment;
    await render(tree(<EscrowPanel study={study} />));
    expect(screen.queryByTestId('escrow-refund-approval-review')).toBeNull();
  });
});
