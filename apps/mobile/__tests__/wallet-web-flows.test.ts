import { buildSiwsMessage } from '@pocket-qa/contracts';
import type { StandardWallet } from '../src/wallet/standard';

// Web wallet flows against a mocked API: login uses the server challenge + solana:signIn;
// linking signs the server's exact link text with signMessage.
const mockApi = jest.fn();
jest.mock('../src/api/client', () => ({ api: (...args: unknown[]) => mockApi(...args) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { walletLoginFlow } = require('../src/wallet/walletLogin.web') as typeof import('../src/wallet/walletLogin.web');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { linkWalletWithMwa } = require('../src/wallet/link.web') as typeof import('../src/wallet/link.web');

const address = 'AddrA111111111111111111111111111111111111111';
const input = { domain: 'app.pocketqa.example', address, statement: 'Sign in …', uri: 'https://app.pocketqa.example', version: '1', chainId: 'solana:devnet', nonce: 'abcDEF1234567890xyz', issuedAt: '2026-10-04T00:00:00.000Z', expirationTime: '2026-10-04T00:05:00.000Z' };
const account = { address, publicKey: new Uint8Array(32), chains: ['solana:devnet'], features: [] };
const signIn = jest.fn(async () => [{ account, signedMessage: new Uint8Array([104, 105]), signature: new Uint8Array(64).fill(1) }]);
const disconnect = jest.fn(async () => {});
const signMessage = jest.fn(async () => [{ signedMessage: new Uint8Array([7]), signature: new Uint8Array(64).fill(2) }]);
const wallet = {
  name: 'Fake',
  icon: 'data:image/svg+xml,',
  chains: ['solana:devnet'],
  accounts: [],
  features: { 'standard:connect': { connect: async () => ({ accounts: [account] }) }, 'standard:disconnect': { disconnect: () => disconnect() }, 'solana:signIn': { signIn }, 'solana:signMessage': { signMessage } },
} as unknown as StandardWallet;

beforeEach(() => {
  mockApi.mockReset();
  signIn.mockClear();
  signMessage.mockClear();
  disconnect.mockClear();
});

it('login: challenge for the connected address → signIn with exactly that challenge → submit the wallet output', async () => {
  mockApi.mockImplementation(async (name: string) => (name === 'walletLoginChallenge' ? { input } : { user: { id: 'u' }, session: { kind: 'local', token: 't'.repeat(43) } }));
  await walletLoginFlow({ wallet, newAccount: { role: 'tester', displayName: 'W' } });
  expect(mockApi.mock.calls[0]).toEqual(['walletLoginChallenge', { body: { address, surface: 'web' }, token: null }]);
  expect(signIn).toHaveBeenCalledWith(input);
  expect(signMessage).not.toHaveBeenCalled();
  expect(mockApi.mock.calls[1]).toEqual([
    'walletLogin',
    { body: { address, nonce: input.nonce, signedMessage: btoa('hi'), signature: btoa(String.fromCharCode(...new Uint8Array(64).fill(1))), newAccount: { role: 'tester', displayName: 'W' } }, token: null },
  ]);
});

it('login without newAccount does not ask to create one', async () => {
  mockApi.mockImplementation(async (name: string) => (name === 'walletLoginChallenge' ? { input } : { user: { id: 'u' }, session: { kind: 'local', token: 't'.repeat(43) } }));
  await walletLoginFlow({ wallet });
  expect((mockApi.mock.calls[1]![1] as { body: Record<string, unknown> }).body).not.toHaveProperty('newAccount');
});

it('link: signs the server’s exact link message with signMessage, then links', async () => {
  const linkInput = { ...input, statement: 'Link this devnet wallet to your Pocket QA account. This is not a payment.' };
  mockApi.mockImplementation(async (name: string) => (name === 'walletNonce' ? { input: linkInput } : {}));
  await linkWalletWithMwa({ wallet });
  const [{ message }] = signMessage.mock.calls[0] as unknown as [{ message: Uint8Array }];
  expect(new TextDecoder().decode(message)).toBe(buildSiwsMessage(linkInput as never));
  expect(signIn).not.toHaveBeenCalled();
  expect(mockApi.mock.calls[1]![0]).toBe('walletLink');
  expect(mockApi.mock.calls[0]).toEqual(['walletNonce', { body: { address, surface: 'web' } }]);
});

it('every web flow disconnects the wallet afterwards, also when the user declines (no lingering connection)', async () => {
  mockApi.mockImplementation(async (name: string) => (name === 'walletLoginChallenge' ? { input } : { user: { id: 'u' }, session: { kind: 'local', token: 't'.repeat(43) } }));
  await walletLoginFlow({ wallet });
  expect(disconnect).toHaveBeenCalledTimes(1);
  signIn.mockRejectedValueOnce(Object.assign(new Error('User rejected the request.'), { code: 4001 }));
  await expect(walletLoginFlow({ wallet })).rejects.toThrow(/rejected/);
  expect(disconnect).toHaveBeenCalledTimes(2);
  // The login was never submitted for the declined attempt.
  expect(mockApi.mock.calls.filter(([n]) => n === 'walletLogin')).toHaveLength(1);
});

it('uses the wallet the user chose, not the first installed one (ledger W1)', async () => {
  const other = { ...wallet, name: 'Other', features: { ...wallet.features, 'solana:signIn': { signIn: jest.fn() } } } as unknown as StandardWallet;
  mockApi.mockImplementation(async (name: string) => (name === 'walletLoginChallenge' ? { input } : { user: { id: 'u' }, session: { kind: 'local', token: 't'.repeat(43) } }));
  await walletLoginFlow({ wallet });
  expect(signIn).toHaveBeenCalledTimes(1);
  expect((other.features['solana:signIn'] as { signIn: jest.Mock }).signIn).not.toHaveBeenCalled();
});
