/**
 * The challenge cookies are named when their constants are first read, so each
 * case loads the constants again under the environment it is about.
 */
function namesUnder(nodeEnv: string): Record<string, string> {
  const previous = process.env.NODE_ENV;
  const names: Record<string, string> = {};
  process.env.NODE_ENV = nodeEnv;
  try {
    jest.isolateModules(() => {
      // feature:totp:start
      names.twoFactor = jest.requireActual<
        typeof import('../two-factor/constants/two-factor.constants')
      >(
        '../two-factor/constants/two-factor.constants',
      ).TWO_FACTOR_CHALLENGE_COOKIE;
      // feature:totp:end
      // feature:passkeys:start
      names.passkey = jest.requireActual<
        typeof import('../passkeys/constants/passkeys.constants')
      >('../passkeys/constants/passkeys.constants').PASSKEY_CHALLENGE_COOKIE;
      // feature:passkeys:end
    });
  } finally {
    process.env.NODE_ENV = previous;
  }
  return names;
}

describe('challenge cookie names', () => {
  it('carry the host prefix in production', () => {
    expect(namesUnder('production')).toEqual({
      twoFactor: '__Host-mfa_challenge', // feature:totp
      passkey: '__Host-pk_challenge', // feature:passkeys
    });
  });

  it('stay plain outside production, where the cookie travels over http', () => {
    expect(namesUnder('development')).toEqual({
      twoFactor: 'mfa_challenge', // feature:totp
      passkey: 'pk_challenge', // feature:passkeys
    });
  });
});
