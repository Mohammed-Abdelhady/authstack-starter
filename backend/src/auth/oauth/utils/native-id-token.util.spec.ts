import { nativeProfileFromClaims } from './native-id-token.util';

const CLAIMS = {
  iss: 'https://issuer.example.test',
  aud: 'client',
  sub: 'subject',
  exp: 4_000_000_000,
  email: 'identity@example.test',
  email_verified: true,
};

describe('native provider profile bounds', () => {
  it.each([
    [99, 99],
    [100, 100],
    [101, 100],
  ])(
    'bounds a %i character name to %i characters',
    (length, expectedLength) => {
      expect(
        nativeProfileFromClaims({ ...CLAIMS, name: 'n'.repeat(length) }).name,
      ).toBe('n'.repeat(expectedLength));
    },
  );

  it('bounds the address fallback when the provider returns no name', () => {
    expect(
      nativeProfileFromClaims({
        ...CLAIMS,
        email: `${'a'.repeat(101)}@example.test`,
      }).name,
    ).toBe('a'.repeat(100));
  });
});
