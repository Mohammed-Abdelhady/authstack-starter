import { GoogleOAuthStrategy } from './google-oauth.strategy';
import {
  configFor,
  mockFetch,
  type SigningKey,
} from './oauth-strategy.harness-spec';
import {
  createSigningKey,
  signedNativeToken,
  NATIVE_METHOD,
  NATIVE_NONCE,
  NATIVE_NOW,
  NATIVE_SUBJECT,
  NATIVE_EMAIL,
} from './native-provider-proof.harness-spec';
import { resetJwksCache } from '../utils/id-token.util';

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const FETCH = global.fetch;

describe('native Google proofs', () => {
  let key: SigningKey;
  let otherKey: SigningKey;
  beforeAll(async () => {
    key = await createSigningKey();
    otherKey = await createSigningKey();
  });
  beforeEach(() => {
    jest.useFakeTimers({ now: NATIVE_NOW });
  });
  afterEach(() => {
    global.fetch = FETCH;
    resetJwksCache();
    jest.useRealTimers();
  });

  const google = () =>
    new GoogleOAuthStrategy(
      configFor('google', {
        clientId: 'web-client',
        clientSecret: 'test-secret',
      }),
    );
  async function googleProof(
    overrides = {},
    omitted: string[] = [],
    signingKey = key,
  ) {
    mockFetch([{ url: GOOGLE_JWKS, body: key.jwks }]);
    return google().verifyNativeCredential({
      method: NATIVE_METHOD.google,
      nonceDigest: NATIVE_NONCE,
      credential: {
        kind: 'googleIdentityToken',
        nonceDigest: NATIVE_NONCE,
        identityToken: await signedNativeToken(
          signingKey,
          'https://accounts.google.com',
          overrides,
          omitted,
        ),
      },
    });
  }

  it('uses Google signed claims for the native audience', async () => {
    expect(await googleProof()).toEqual({
      providerId: NATIVE_SUBJECT,
      email: NATIVE_EMAIL,
      emailVerified: true,
      name: NATIVE_EMAIL,
    });
  });

  it.each([
    { aud: 'other-client' },
    { iss: 'https://attacker.test' },
    { nonce: 'b'.repeat(64) },
    { exp: NATIVE_NOW.getTime() / 1000 },
    { sub: '' },
    { iat: NATIVE_NOW.getTime() / 1000 + 120 },
    { email: 42 },
    { email: 'invalid-address' },
  ])('rejects invalid Google claims %j', async (claims) => {
    await expect(googleProof(claims)).rejects.toMatchObject({ status: 502 });
  });

  it.each(['exp', 'iat', 'sub', 'nonce'])(
    'requires Google claim %s',
    async (claim) => {
      await expect(googleProof({}, [claim])).rejects.toMatchObject({
        status: 502,
      });
    },
  );

  it('rejects a Google signature from another key', async () => {
    await expect(googleProof({}, [], otherKey)).rejects.toMatchObject({
      status: 502,
    });
  });

  it('does not turn an unverified Google email into verified identity', async () => {
    expect((await googleProof({ email_verified: false })).emailVerified).toBe(
      false,
    );
  });
});
