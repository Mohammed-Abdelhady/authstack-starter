import { parseSignIn } from './native-sign-in-config.util';

const CLIENT_ID = 'native-wire-client';
const RP_PREFIX = `${'a'.repeat(63)}.${'b'.repeat(63)}.`;
const RP_SUFFIX = '.example.test';
const SDK_FIELDS = [
  { mode: 'googleIdentityToken', id: 'google', field: 'webClientId' },
  { mode: 'googleIdentityToken', id: 'google', field: 'iosClientId' },
  { mode: 'appleIdentityTokenAndCode', id: 'apple', field: 'appId' },
  { mode: 'facebook', id: 'facebook', field: 'appId' },
];
const SDK_BOUNDARIES = SDK_FIELDS.flatMap((field) =>
  [127, 128].map((length) => ({ ...field, length })),
);

describe('native configuration wire bounds', () => {
  it.each([18, 19])(
    'accepts an RP ID within the existing wire bound %s',
    (length) => {
      const rpId = `${RP_PREFIX}${'c'.repeat(length)}${RP_SUFFIX}`;
      expect(
        parseSignIn(
          { passkeys: true, rpId, origins: [`https://${rpId}`] },
          0,
          CLIENT_ID,
        )?.rpId,
      ).toBe(rpId);
    },
  );

  it('rejects a 161-unit RP ID before advertising native passkeys', () => {
    const rpId = `${RP_PREFIX}${'c'.repeat(20)}${RP_SUFFIX}`;
    expect(() =>
      parseSignIn(
        { passkeys: true, rpId, origins: [`https://${rpId}`] },
        0,
        CLIENT_ID,
      ),
    ).toThrow('signIn.rpId');
  });

  it.each(SDK_BOUNDARIES)(
    'preserves a $length-unit $id $field identifier',
    ({ mode, id, field, length }) => {
      const identifier = 'a'.repeat(length);
      const provider = {
        mode,
        id,
        webClientId: 'normal-web-client',
        [field]: identifier,
      };
      const result = parseSignIn({ providers: [provider] }, 0, CLIENT_ID);
      expect(result?.providers?.[0]).toMatchObject({ [field]: identifier });
    },
  );

  it.each(SDK_FIELDS)(
    'rejects a 129-unit $id $field identifier',
    ({ mode, id, field }) => {
      const provider = {
        mode,
        id,
        webClientId: 'normal-web-client',
        [field]: 'a'.repeat(129),
      };
      expect(() =>
        parseSignIn({ providers: [provider] }, 0, CLIENT_ID),
      ).toThrow(field);
    },
  );
});
