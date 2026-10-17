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
  it('retains each relying-party removal decision across the wire', () => {
    expect(
      readList([
        {
          id: 'required',
          name: 'Web',
          ...STORED,
          canRemove: false,
          removalBlockedCode: 'PASSKEY_REQUIRED_LAST',
        },
        { id: 'optional', name: 'App', ...STORED, canRemove: true },
      ]).passkeys,
    ).toEqual([
      {
        id: 'required',
        name: 'Web',
        ...STORED,
        canRemove: false,
        removalBlockedCode: 'PASSKEY_REQUIRED_LAST',
      },
      { id: 'optional', name: 'App', ...STORED, canRemove: true },
    ]);
  });
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

  it.each([
    { stored: '64 emoji', name: '\u{1F600}'.repeat(64) },
    { stored: '64 emoji with a variation selector', name: '\u{1F600}\u{FE0F}'.repeat(64) },
  ])('keeps a name of $stored, which the server counts as 64 characters', ({ name }) => {
    expect(readList([{ id: 'long', name, ...STORED }]).passkeys[0]?.name).toBe(name);
  });

  it.each([null, 17, undefined])('refuses the name %j', (name) => {
    expect(() => readList([{ id: 'odd', name, ...STORED }])).toThrow(ApiError);
  });

  it('refuses a name longer than any the server can have stored', () => {
    expect(() => readList([{ id: 'odd', name: 'x'.repeat(193), ...STORED }])).toThrow(ApiError);
  });

  it.each(['', '   '])('still refuses the blank id %j', (id) => {
    expect(() => readList([{ id, name: 'Phone', ...STORED }])).toThrow(ApiError);
  });
});
