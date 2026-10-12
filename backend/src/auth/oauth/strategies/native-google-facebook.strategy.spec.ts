import { GoogleOAuthStrategy } from './google-oauth.strategy';
import { FacebookOAuthStrategy } from './facebook-oauth.strategy';
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
  NATIVE_AUDIENCE,
  NATIVE_SUBJECT,
  NATIVE_EMAIL,
} from './native-provider-proof.harness-spec';
import { resetJwksCache } from '../utils/id-token.util';

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const FACEBOOK_JWKS = 'https://www.facebook.com/.well-known/oauth/openid/jwks/';
const DEBUG_URL = 'https://graph.facebook.com/v26.0/debug_token';
const PROFILE_URL = 'https://graph.facebook.com/v26.0/me';
const FETCH = global.fetch;

describe('native Google and Facebook proofs', () => {
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
  const facebook = () =>
    new FacebookOAuthStrategy(
      configFor('facebook', {
        clientId: NATIVE_AUDIENCE,
        clientSecret: 'test-app-secret',
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

  async function limitedProof(overrides = {}) {
    mockFetch([{ url: FACEBOOK_JWKS, body: key.jwks }]);
    return facebook().verifyNativeCredential({
      method: NATIVE_METHOD.facebook,
      nonceDigest: NATIVE_NONCE,
      credential: {
        kind: 'facebookLimitedToken',
        nonceDigest: NATIVE_NONCE,
        authenticationToken: await signedNativeToken(
          key,
          'https://www.facebook.com',
          overrides,
        ),
      },
    });
  }

  it('verifies Facebook Limited Login signed identity', async () => {
    expect((await limitedProof()).providerId).toBe(NATIVE_SUBJECT);
    expect(facebook().autoLinksByEmail).toBe(false);
  });

  it.each([
    { aud: 'wrong-app' },
    { nonce: 'b'.repeat(64) },
    { iss: 'https://attacker.test' },
  ])('rejects mismatched Facebook Limited claims %j', async (claims) => {
    await expect(limitedProof(claims)).rejects.toMatchObject({ status: 502 });
  });

  function accessProof(
    data: Record<string, unknown> = {},
    profile: Record<string, unknown> = {},
  ) {
    const transport = mockFetch([
      {
        url: DEBUG_URL,
        body: {
          data: {
            is_valid: true,
            type: 'USER',
            app_id: NATIVE_AUDIENCE,
            user_id: NATIVE_SUBJECT,
            expires_at: NATIVE_NOW.getTime() / 1000 + 600,
            data_access_expires_at: NATIVE_NOW.getTime() / 1000 + 600,
            ...data,
          },
        },
      },
      {
        url: PROFILE_URL,
        body: { id: NATIVE_SUBJECT, email: NATIVE_EMAIL, ...profile },
      },
    ]);
    return {
      transport,
      result: facebook().verifyNativeCredential({
        method: NATIVE_METHOD.facebook,
        nonceDigest: NATIVE_NONCE,
        credential: {
          kind: 'facebookAccessToken',
          accessToken: 'native-access-token',
        },
      }),
    };
  }

  it('inspects Facebook app and user before loading the matching profile', async () => {
    const { result, transport } = accessProof();
    expect((await result).providerId).toBe(NATIVE_SUBJECT);
    expect(transport.callTo(DEBUG_URL).headers.Authorization).toBe(
      `Bearer ${NATIVE_AUDIENCE}|test-app-secret`,
    );
    expect(transport.callTo(PROFILE_URL).headers.Authorization).toBe(
      'Bearer native-access-token',
    );
  });

  it.each([
    { is_valid: false },
    { type: 'PAGE' },
    { app_id: 'other-app' },
    { user_id: '' },
    { expires_at: 0 },
    { data_access_expires_at: 0 },
    { expires_at: null },
  ])('rejects invalid Facebook token inspection %j', async (data) => {
    const { result, transport } = accessProof(data);
    await expect(result).rejects.toMatchObject({ status: 502 });
    expect(
      transport.calls.some((call) => call.url.startsWith(PROFILE_URL)),
    ).toBe(false);
  });

  it('rejects a Facebook profile with a different inspected subject', async () => {
    await expect(
      accessProof({}, { id: 'different-user' }).result,
    ).rejects.toMatchObject({ status: 502 });
  });
});
