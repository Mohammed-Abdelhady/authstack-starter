import { nativeProviderInput } from './native-provider-input';

const NONCE = 'a'.repeat(64);
describe('native provider request credentials', () => {
  it.each([
    {
      kind: 'googleIdentityToken',
      identityToken: 'signed-google-token',
      nonceDigest: NONCE,
    },
    {
      kind: 'appleIdentityTokenAndCode',
      identityToken: 'signed-apple-token',
      authorizationCode: 'one-use-code',
      nonceDigest: NONCE,
    },
    {
      kind: 'facebookLimitedToken',
      authenticationToken: 'signed-limited-token',
      nonceDigest: NONCE,
    },
    { kind: 'facebookAccessToken', accessToken: 'opaque-access-token' },
  ])('accepts the supported provider artifact %j', (credential) => {
    expect(nativeProviderInput(credential)).toEqual(credential);
  });

  it.each([
    null,
    undefined,
    [],
    {},
    { kind: 'system' },
    { kind: 'googleIdentityToken', identityToken: '', nonceDigest: NONCE },
    {
      kind: 'googleIdentityToken',
      identityToken: 'token',
      nonceDigest: 'bad-nonce',
    },
    {
      kind: 'googleIdentityToken',
      identityToken: 'token',
      nonceDigest: NONCE,
      email: 'untrusted@example.test',
    },
    { kind: 'facebookAccessToken', accessToken: 'token', nonceDigest: NONCE },
    { kind: 'facebookAccessToken', accessToken: ' '.repeat(4) },
    { kind: 'facebookAccessToken', accessToken: 't'.repeat(16_385) },
    {
      kind: 'appleIdentityTokenAndCode',
      identityToken: 'token',
      authorizationCode: 'c'.repeat(65),
      nonceDigest: NONCE,
    },
  ])('rejects malformed or excess input %j', (credential) => {
    expect(() => nativeProviderInput(credential)).toThrow();
  });

  it.each(['en', 'fr-CA', 'x'.repeat(35)])(
    'takes a body language of %j out before checking the credential',
    (locale) => {
      expect(
        nativeProviderInput({
          kind: 'googleIdentityToken',
          identityToken: 'signed-google-token',
          nonceDigest: NONCE,
          locale,
        }),
      ).toEqual({
        kind: 'googleIdentityToken',
        identityToken: 'signed-google-token',
        nonceDigest: NONCE,
      });
    },
  );

  it.each([
    { label: 'a language that is not text', extra: { locale: 7 } },
    {
      label: 'a language over 35 characters',
      extra: { locale: 'x'.repeat(36) },
    },
    {
      label: 'an unknown key beside a language',
      extra: { locale: 'en', email: 'untrusted@example.test' },
    },
  ])('refuses $label', ({ extra }) => {
    expect(() =>
      nativeProviderInput({
        kind: 'facebookAccessToken',
        accessToken: 'opaque-access-token',
        ...extra,
      }),
    ).toThrow();
  });

  it.each([16_383, 16_384])('accepts a token of %i characters', (length) => {
    expect(
      nativeProviderInput({
        kind: 'facebookAccessToken',
        accessToken: 't'.repeat(length),
      }),
    ).toEqual({ kind: 'facebookAccessToken', accessToken: 't'.repeat(length) });
  });
});
