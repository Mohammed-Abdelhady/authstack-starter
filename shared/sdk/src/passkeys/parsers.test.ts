import { NATIVE_AUTH_LIMITS } from '@app/core';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../errors';
import { respond } from '../test-support';
import { unwrapPasskeyList } from './parsers';

const STORED = {
  backedUp: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  lastUsedAt: null,
};

function readList(passkeys: unknown[]) {
  return unwrapPasskeyList(respond(200, { success: true, data: { passkeys } }));
}

describe('the passkey list', () => {
  it.each(['', '   '])(
    'keeps a passkey stored with the blank name %j beside a named one',
    (name) => {
      expect(
        readList([
          { id: 'blank', name, ...STORED },
          { id: 'phone', name: 'Phone', ...STORED },
        ]),
      ).toStrictEqual({
        passkeys: [
          { id: 'blank', name, ...STORED },
          { id: 'phone', name: 'Phone', ...STORED },
        ],
      });
    },
  );

  it('keeps a name at the length limit', () => {
    const name = 'x'.repeat(NATIVE_AUTH_LIMITS.NAME);
    expect(readList([{ id: 'long', name, ...STORED }]).passkeys[0]?.name).toBe(name);
  });

  it.each([null, 17, undefined, 'x'.repeat(NATIVE_AUTH_LIMITS.NAME + 1)])(
    'refuses the name %j',
    (name) => {
      expect(() => readList([{ id: 'odd', name, ...STORED }])).toThrow(ApiError);
    },
  );

  it.each(['', '   '])('still refuses the blank id %j', (id) => {
    expect(() => readList([{ id, name: 'Phone', ...STORED }])).toThrow(ApiError);
  });
});
