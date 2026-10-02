import { extractSignature } from '../src/wallet/signature';

const msg = new Uint8Array([1, 2, 3, 4]);
const sig = new Uint8Array(64).fill(9);

describe('extractSignature', () => {
  it('accepts a bare 64-byte signature', () => expect(extractSignature(sig, msg)).toEqual(sig));
  it('accepts message || signature', () => expect(Array.from(extractSignature(new Uint8Array([...msg, ...sig]), msg))).toEqual(Array.from(sig)));
  it('rejects anything else (e.g. a different message prefix)', () => {
    expect(() => extractSignature(new Uint8Array([9, 9, 9, 9, ...sig]), msg)).toThrow();
    expect(() => extractSignature(new Uint8Array(10), msg)).toThrow();
  });
});

describe('decodeWalletBase64', () => {
  const { decodeWalletBase64 } = jest.requireActual('../src/wallet/signature') as typeof import('../src/wallet/signature');
  const bytes = new Uint8Array(64).map((_, i) => (i * 37) % 256);
  const std = Buffer.from(bytes).toString('base64');
  it('accepts padded, unpadded and URL-safe forms', () => {
    for (const v of [std, std.replace(/=+$/, ''), Buffer.from(bytes).toString('base64url')]) {
      expect(Array.from(decodeWalletBase64(v))).toEqual(Array.from(bytes));
    }
  });
  it('rejects garbage', () => {
    expect(() => decodeWalletBase64('not base64!!')).toThrow();
    expect(() => decodeWalletBase64('A')).toThrow();
  });
});
