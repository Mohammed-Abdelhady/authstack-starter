import { describe, expect, it } from 'vitest';
import { base64UrlEncode } from '../../src/proof/encoding';

const BASE64_CASES = [
  ['', ''],
  ['f', 'Zg'],
  ['fo', 'Zm8'],
  ['foo', 'Zm9v'],
  ['foob', 'Zm9vYg'],
  ['fooba', 'Zm9vYmE'],
  ['foobar', 'Zm9vYmFy'],
] as const;

function asciiBytes(value: string): Uint8Array {
  return Uint8Array.from(value, (character) => character.charCodeAt(0));
}

describe('base64url encoding', () => {
  it.each(BASE64_CASES)('encodes %s per RFC 4648', (input, expected) => {
    expect(base64UrlEncode(asciiBytes(input))).toBe(expected);
  });

  it('masks signed octets and encodes alphabet index 63', () => {
    expect(base64UrlEncode(new Int8Array([-1]))).toBe('_w');
    expect(base64UrlEncode(Uint8Array.from([0, 0, 63]))).toBe('AAA_');
  });
});
