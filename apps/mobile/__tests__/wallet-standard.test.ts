import { connectWallet, signInWithWallet, signMessageWithWallet, solanaWallets, WalletUnsupported, type StandardWallet } from '../src/wallet/standard';

// ADR 0005 §2/§4 (and increment-2 review conditions): web wallet login uses solana:signIn
// with the server's challenge fields only; a wallet without signIn is refused honestly and
// signMessage is never used for login.
const input = {
  domain: 'app.pocketqa.example',
  address: 'AddrA111111111111111111111111111111111111111',
  statement: 'Sign in to Pocket QA at https://app.pocketqa.example …',
  uri: 'https://app.pocketqa.example',
  version: '1' as const,
  chainId: 'solana:devnet' as const,
  nonce: 'abcDEF1234567890xyz',
  issuedAt: '2026-10-04T00:00:00.000Z',
  expirationTime: '2026-10-04T00:05:00.000Z',
};

function wallet(features: string[], chains = ['solana:mainnet', 'solana:devnet']) {
  const calls: { feature: string; args: unknown[] }[] = [];
  const account = { address: input.address, publicKey: new Uint8Array(32), chains, features };
  const f: Record<string, unknown> = {};
  if (features.includes('standard:connect')) f['standard:connect'] = { version: '1.0.0', connect: async (...args: unknown[]) => (calls.push({ feature: 'connect', args }), { accounts: [account] }) };
  if (features.includes('solana:signIn')) {
    f['solana:signIn'] = {
      version: '1.0.0',
      signIn: async (...args: unknown[]) => (calls.push({ feature: 'signIn', args }), [{ account, signedMessage: new Uint8Array([1, 2]), signature: new Uint8Array(64).fill(7) }]),
    };
  }
  if (features.includes('solana:signMessage')) {
    f['solana:signMessage'] = {
      version: '1.0.0',
      signMessage: async (...args: unknown[]) => (calls.push({ feature: 'signMessage', args }), [{ signedMessage: new Uint8Array([3]), signature: new Uint8Array(64).fill(9) }]),
    };
  }
  const w = { name: `W-${features.join('+')}`, icon: 'data:image/svg+xml,', version: '1.0.0', chains, accounts: [], features: f } as unknown as StandardWallet;
  return { w, calls };
}

describe('wallet discovery', () => {
  it('lists only Solana devnet wallets that can connect', () => {
    const ok = wallet(['standard:connect', 'solana:signIn']).w;
    const noDevnet = wallet(['standard:connect', 'solana:signIn'], ['solana:mainnet']).w;
    const noConnect = wallet(['solana:signIn']).w;
    expect(solanaWallets([ok, noDevnet, noConnect])).toEqual([ok]);
  });
});

describe('sign-in (login)', () => {
  it('calls solana:signIn with exactly the server challenge fields, never signMessage', async () => {
    const { w, calls } = wallet(['standard:connect', 'solana:signIn', 'solana:signMessage']);
    const out = await signInWithWallet(w, input);
    expect(calls.map((c) => c.feature)).toEqual(['signIn']);
    expect(calls[0]!.args[0]).toEqual(input);
    expect(out).toEqual({ address: input.address, signedMessage: new Uint8Array([1, 2]), signature: new Uint8Array(64).fill(7) });
  });

  it('refuses a wallet without solana:signIn instead of falling back to signMessage', async () => {
    const { w, calls } = wallet(['standard:connect', 'solana:signMessage']);
    await expect(signInWithWallet(w, input)).rejects.toBeInstanceOf(WalletUnsupported);
    await expect(signInWithWallet(w, input)).rejects.toThrow(/doesn.t support Sign In With Solana/);
    expect(calls).toEqual([]);
  });

  it('refuses a signature from a different account than the challenge', async () => {
    const { w } = wallet(['standard:connect', 'solana:signIn']);
    await expect(signInWithWallet(w, { ...input, address: 'OtherAddr1111111111111111111111111111111111' })).rejects.toThrow(/different account/);
  });
});

describe('connect and link-message signing', () => {
  it('connects to get the address, and signs a link message with signMessage', async () => {
    const { w, calls } = wallet(['standard:connect', 'solana:signMessage']);
    const account = await connectWallet(w);
    expect(account.address).toBe(input.address);
    const sig = await signMessageWithWallet(w, account, new Uint8Array([3]));
    expect(sig.signature).toEqual(new Uint8Array(64).fill(9));
    expect(calls.map((c) => c.feature)).toEqual(['connect', 'signMessage']);
  });
});
