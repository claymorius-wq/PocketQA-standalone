import { describe, expect, it } from 'vitest';
import { bytesEqual, utf8Bytes } from './utf8';

describe('utf8Bytes', () => {
  it('encodes ASCII, 2-, 3- and 4-byte code points per RFC 3629', () => {
    expect(Array.from(utf8Bytes('abc'))).toEqual([0x61, 0x62, 0x63]);
    expect(Array.from(utf8Bytes('é·'))).toEqual([0xc3, 0xa9, 0xc2, 0xb7]);
    expect(Array.from(utf8Bytes('日'))).toEqual([0xe6, 0x97, 0xa5]);
    expect(Array.from(utf8Bytes('🙂'))).toEqual([0xf0, 0x9f, 0x99, 0x82]);
    expect(Array.from(utf8Bytes('\ud800'))).toEqual([0xef, 0xbf, 0xbd]);
    expect(utf8Bytes('')).toHaveLength(0);
  });
  it('compares bytes', () => {
    expect(bytesEqual(utf8Bytes('a'), utf8Bytes('a'))).toBe(true);
    expect(bytesEqual(utf8Bytes('a'), utf8Bytes('b'))).toBe(false);
    expect(bytesEqual(utf8Bytes('a'), utf8Bytes('ab'))).toBe(false);
  });
});
