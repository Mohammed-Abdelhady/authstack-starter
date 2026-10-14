import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors';
import { respond } from '../test-support';
import { unwrapNativePasskeyOptions } from './parsers';

function readOptions(data: unknown) {
  return unwrapNativePasskeyOptions(respond(200, { success: true, data }));
}

describe('native passkey optional fields', () => {
  it('omits absent and undefined options', () => {
    expect(readOptions({ challenge: 'challenge-1' })).toStrictEqual({ challenge: 'challenge-1' });
    expect(
      readOptions({
        challenge: 'challenge-1',
        timeout: undefined,
        rpId: undefined,
        allowCredentials: undefined,
        userVerification: undefined,
      }),
    ).toStrictEqual({ challenge: 'challenge-1' });
  });

  it('returns validated credential descriptors and relying party', () => {
    expect(
      readOptions({
        challenge: 'challenge-1',
        rpId: 'example.test',
        allowCredentials: [{ type: 'public-key', id: 'credential-1', transports: ['internal'] }],
      }),
    ).toStrictEqual({
      challenge: 'challenge-1',
      rpId: 'example.test',
      allowCredentials: [{ type: 'public-key', id: 'credential-1', transports: ['internal'] }],
    });
  });
});

describe('native passkey verification preference', () => {
  it.each(['required', 'preferred', 'discouraged'])('accepts %s', (userVerification) => {
    expect(readOptions({ challenge: 'challenge-1', userVerification })).toStrictEqual({
      challenge: 'challenge-1',
      userVerification,
    });
  });

  it.each([null, '', false, 17, 'unsupported'])('rejects %j', (userVerification) => {
    expect(() => readOptions({ challenge: 'challenge-1', userVerification })).toThrow(ApiError);
  });
});

describe('native passkey timeout', () => {
  it.each([1, 120_000])('accepts the boundary %i', (timeout) => {
    expect(readOptions({ challenge: 'challenge-1', timeout })).toStrictEqual({
      challenge: 'challenge-1',
      timeout,
    });
  });

  it.each([0, 120_001, 1.5, null, '1', Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects %j',
    (timeout) => {
      expect(() => readOptions({ challenge: 'challenge-1', timeout })).toThrow(ApiError);
    },
  );
});

describe('native passkey credential count', () => {
  it.each([0, 64])('accepts %i descriptors', (count) => {
    const allowCredentials = Array.from({ length: count }, () => ({
      type: 'public-key',
      id: 'credential-1',
    }));

    expect(
      readOptions({ challenge: 'challenge-1', allowCredentials }).allowCredentials,
    ).toHaveLength(count);
  });

  it('rejects more than 64 descriptors', () => {
    const allowCredentials = Array.from({ length: 65 }, () => ({
      type: 'public-key',
      id: 'credential-1',
    }));

    expect(() => readOptions({ challenge: 'challenge-1', allowCredentials })).toThrow(ApiError);
  });
});
