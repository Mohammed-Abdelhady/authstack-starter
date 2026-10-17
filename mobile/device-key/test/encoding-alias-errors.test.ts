import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { keyAlias } from '../src/logic/alias';
import { base64Decode, base64Encode, base64UrlEncode } from '../src/logic/base64';
import { nativeCondition } from '../src/logic/native-errors';
import { readKeyRecord } from '../src/logic/key-record';
import { nativeError } from './support';
import { KEY_X_HEX, KEY_Y_HEX } from './vectors';

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe('base64', () => {
  it.each([
    [bytes(), '', ''],
    [bytes(0x66), 'Zg==', 'Zg'],
    [bytes(0x66, 0x6f), 'Zm8=', 'Zm8'],
    [bytes(0x66, 0x6f, 0x6f), 'Zm9v', 'Zm9v'],
    [bytes(0xfb, 0xff), '+/8=', '-_8'],
    [bytes(0x00, 0x00, 0x00, 0x00), 'AAAAAA==', 'AAAAAA'],
  ])('writes %j as %s for the bridge and %s for a JWK', (input, padded, url) => {
    expect(base64Encode(input)).toBe(padded);
    expect(base64UrlEncode(input)).toBe(url);
  });

  it.each([
    ['', []],
    ['Zg==', [0x66]],
    ['Zm8=', [0x66, 0x6f]],
    ['Zm9v', [0x66, 0x6f, 0x6f]],
    ['+/8=', [0xfb, 0xff]],
  ])('reads %s', (text, expected) => {
    expect(Array.from(base64Decode(text) ?? [-1])).toEqual(expected);
  });

  it('reads every byte value the way Node does', () => {
    const all = Uint8Array.from({ length: 256 }, (_, index) => index);

    expect(base64Encode(all)).toBe(Buffer.from(all).toString('base64'));
    expect(Array.from(base64Decode(Buffer.from(all).toString('base64')) ?? [])).toEqual(
      Array.from(all),
    );
  });

  it.each([
    ['a length that is not a multiple of four', 'Zm8'],
    ['a character outside the alphabet', 'Zm!v'],
    ['the JWK alphabet', '-_8='],
    ['padding in the middle', 'Zg=v'],
    ['padding first', '=Zg='],
    ['three padding characters', 'Z==='],
  ])('refuses %s', (_name, text) => {
    expect(base64Decode(text)).toBeUndefined();
  });
});

describe('key alias', () => {
  const settings = {
    clientId: 'native-client',
    environment: 'development',
    protection: 'hardwareOnly',
  } as const;

  it('escapes the separator, the escape character and anything a file name refuses', () => {
    expect(keyAlias({ ...settings, clientId: 'com.example.mobile', environment: 'dev_1' })).toBe(
      'devicekey.hw.com_002eexample_002emobile.dev_005f1',
    );
    expect(keyAlias({ ...settings, clientId: 'a b/é', environment: '../x' })).toBe(
      'devicekey.hw.a_0020b_002f_00e9._002e_002e_002fx',
    );
  });

  it('keeps apart settings whose parts would join to the same text', () => {
    expect(keyAlias({ ...settings, clientId: 'a.b', environment: 'c' })).toBe(
      'devicekey.hw.a_002eb.c',
    );
    expect(keyAlias({ ...settings, clientId: 'a', environment: 'b.c' })).toBe(
      'devicekey.hw.a.b_002ec',
    );
  });

  it('accepts an alias of 200 characters and refuses one of 201', () => {
    // "devicekey.hw." is 13 characters and ".e" is 2.
    expect(keyAlias({ ...settings, clientId: 'a'.repeat(185), environment: 'e' })).toHaveLength(
      200,
    );
    expect(() => keyAlias({ ...settings, clientId: 'a'.repeat(186), environment: 'e' })).toThrow(
      TypeError,
    );
  });
});

describe('native failure to condition', () => {
  it.each([
    ['ERR_DEVICE_KEY_UNAVAILABLE', 'unavailable'],
    ['ERR_DEVICE_KEY_NO_HARDWARE', 'noSecureHardware'],
    ['ERR_DEVICE_KEY_NOT_FOUND', 'notFound'],
    ['ERR_DEVICE_KEY_INVALIDATED', 'invalidated'],
    ['ERR_DEVICE_KEY_INVALID_ALIAS', 'unavailable'],
    ['ERR_SOMETHING_ELSE', 'unavailable'],
    ['constructor', 'unavailable'],
    ['', 'unavailable'],
  ])('reads the code %s as %s', (code, condition) => {
    expect(nativeCondition(nativeError(code))).toBe(condition);
  });

  it.each([
    ['an error without a code', new Error('ERR_DEVICE_KEY_INVALIDATED')],
    ['a code that is not text', { code: 7 }],
    ['text', 'ERR_DEVICE_KEY_INVALIDATED'],
    ['null', null],
    ['undefined', undefined],
  ])('reads %s as unavailable', (_name, error) => {
    expect(nativeCondition(error)).toBe('unavailable');
  });
});

describe('native key record', () => {
  const publicKey = Buffer.from(`04${KEY_X_HEX}${KEY_Y_HEX}`, 'hex').toString('base64');

  it.each(['secureEnclave', 'strongBox', 'trustedEnvironment', 'software'] as const)(
    'reads a key protected by %s',
    (protection) => {
      expect(readKeyRecord({ publicKey, protection })).toEqual({
        protection,
        jwk: {
          kty: 'EC',
          crv: 'P-256',
          x: 'kEkTQfzZyf-oZboWzbjN20L1Dq7hNYukIyvH3msY394',
          y: 'Dhwd2dUIhY_-YTgJDQNh7VMP7CMF7LhiwZAwaFo17BM',
          alg: 'ES256',
        },
      });
    },
  );

  it.each([
    ['a protection it does not know', { publicKey, protection: 'hardware' }],
    ['a public key that is not base64', { publicKey: 'not base64!', protection: 'strongBox' }],
    ['a public key that is not a point', { publicKey: 'Zm9v', protection: 'strongBox' }],
  ])('refuses %s', (_name, record) => {
    expect(readKeyRecord(record)).toBeUndefined();
  });
});
