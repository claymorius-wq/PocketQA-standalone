import { appIdentityUri, buildSiwsMessage, DEFAULT_SIWS_DOMAIN } from '@pocket-qa/contracts';
import { base58, base64 } from '@scure/base';

// Ledger W3: Android wallet sign-in over Mobile Wallet Adapter, one session. The wallet signs
// exactly the server-built text for an `mwa` challenge; nothing else is ever signed or sent.
const mockApi = jest.fn();
jest.mock('../src/api/client', () => ({ api: (...args: unknown[]) => mockApi(...args) }));
const mockWallet = { authorize: jest.fn(), signMessages: jest.fn(), signAndSendTransactions: jest.fn(), signTransactions: jest.fn() };
jest.mock('@solana-mobile/mobile-wallet-adapter-protocol', () => ({ transact: (cb: (w: unknown) => unknown) => cb(mockWallet) }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { walletLoginFlow } = require('../src/wallet/walletLogin.android') as typeof import('../src/wallet/walletLogin.android');

const pub = new Uint8Array(32).fill(9);
const address = base58.encode(pub);
const input = {
  domain: DEFAULT_SIWS_DOMAIN,
  address,
  statement: 'Sign in to Pocket QA in the Pocket QA Android app with this devnet wallet. Only sign this in the Pocket QA Android app, never on a website. This is not a payment and sends nothing.',
  uri: appIdentityUri(DEFAULT_SIWS_DOMAIN),
  version: '1',
  chainId: 'solana:devnet',
  nonce: 'abcDEF1234567890xyz',
  issuedAt: '2026-10-04T00:00:00.000Z',
  expirationTime: '2026-10-04T00:05:00.000Z',
} as const;

beforeEach(() => {
  mockApi.mockReset();
  for (const f of Object.values(mockWallet)) f.mockReset();
  mockWallet.authorize.mockResolvedValue({ accounts: [{ address: base64.encode(pub) }] });
});

it('authorize → mwa challenge → signMessages over the exact server text → walletLogin', async () => {
  const text = new TextEncoder().encode(buildSiwsMessage(input));
  const sig = new Uint8Array(64).fill(3);
  mockWallet.signMessages.mockResolvedValue({ signed_payloads: [base64.encode(new Uint8Array([...text, ...sig]))] });
  mockApi.mockImplementation(async (name: string) => (name === 'walletLoginChallenge' ? { input } : { user: { id: 'u' }, session: { kind: 'local', token: 't'.repeat(43) } }));
  await walletLoginFlow({ newAccount: { role: 'tester', displayName: 'Mo' } });

  expect(mockWallet.authorize).toHaveBeenCalledWith({ chain: 'solana:devnet', identity: { name: 'Pocket QA', uri: appIdentityUri(DEFAULT_SIWS_DOMAIN), icon: 'favicon.ico' } });
  expect(mockApi.mock.calls[0]).toEqual(['walletLoginChallenge', { body: { address, surface: 'mwa' }, token: null }]);
  const [{ payloads }] = mockWallet.signMessages.mock.calls[0] as [{ payloads: string[] }];
  expect(new TextDecoder().decode(base64.decode(payloads[0]!))).toBe(buildSiwsMessage(input));
  expect(mockApi.mock.calls[1]).toEqual([
    'walletLogin',
    { body: { address, nonce: input.nonce, signedMessage: base64.encode(text), signature: base64.encode(sig), newAccount: { role: 'tester', displayName: 'Mo' } }, token: null },
  ]);
  expect(mockWallet.signAndSendTransactions).not.toHaveBeenCalled();
  expect(mockWallet.signTransactions).not.toHaveBeenCalled();
});

it('a declined signature never reaches the login endpoint', async () => {
  mockWallet.signMessages.mockRejectedValue(Object.assign(new Error('declined'), { code: -3 }));
  mockApi.mockImplementation(async () => ({ input }));
  await expect(walletLoginFlow()).rejects.toMatchObject({ code: -3 });
  expect(mockApi.mock.calls.map(([n]) => n)).toEqual(['walletLoginChallenge']);
});
