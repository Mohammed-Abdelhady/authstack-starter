import { createLocalJWKSet, exportPKCS8, jwtVerify } from 'jose';
import { AppleOAuthStrategy } from './apple-oauth.strategy';
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
import { ConfigService } from '@nestjs/config';
import { FrozenClock } from '../../../../test/utils/frozen-clock';
import { ProviderTokenCrypto } from '../provider-tokens/services/provider-token-crypto';
import { ProviderTokenVault } from '../provider-tokens/services/provider-token-vault';
import { MemoryProviderTokenStore } from '../provider-tokens/testing/provider-token-memory.harness-spec';

const ISSUER = 'https://appleid.apple.com';
const JWKS_URI = `${ISSUER}/auth/keys`;
const TOKEN_URI = `${ISSUER}/auth/token`;
const FETCH = global.fetch;
const TEAM_ID = 'NATIVETEAM';
const KEY_ID = 'NATIVEKEY';

describe('native Apple identity and authorization code', () => {
  let key: SigningKey;
  let signingKey: SigningKey;
  let privateKey: string;
  beforeAll(async () => {
    key = await createSigningKey();
    signingKey = await createSigningKey('ES256', KEY_ID);
    privateKey = await exportPKCS8(signingKey.privateKey);
  });
  beforeEach(() => {
    jest.useFakeTimers({ now: NATIVE_NOW });
  });
  afterEach(() => {
    global.fetch = FETCH;
    resetJwksCache();
    jest.useRealTimers();
  });

  function strategy() {
    return new AppleOAuthStrategy(
      configFor('apple', {
        clientId: 'web-service-id',
        extra: { TEAM_ID, KEY_ID, PRIVATE_KEY: privateKey },
      }),
    );
  }

  async function proof(initial = {}, exchanged = {}, status = 200) {
    const initialToken = await signedNativeToken(key, ISSUER, initial);
    const codeToken = await signedNativeToken(key, ISSUER, exchanged);
    const transport = mockFetch([
      { url: JWKS_URI, body: key.jwks },
      { url: TOKEN_URI, body: { id_token: codeToken }, status },
    ]);
    const result = strategy().verifyNativeCredential({
      method: NATIVE_METHOD.apple,
      nonceDigest: NATIVE_NONCE,
      credential: {
        kind: 'appleIdentityTokenAndCode',
        identityToken: initialToken,
        authorizationCode: 'one-use-apple-code',
        nonceDigest: NATIVE_NONCE,
      },
    });
    return { result, transport };
  }

  it('exchanges the code for the native app audience and resolves the same signed subject', async () => {
    const { result, transport } = await proof();
    expect(await result).toEqual({
      providerId: NATIVE_SUBJECT,
      email: NATIVE_EMAIL,
      emailVerified: true,
      name: NATIVE_EMAIL,
    });
    const request = transport.callTo(TOKEN_URI);
    expect(request.body.client_id).toBe(NATIVE_AUDIENCE);
    expect(request.body.code).toBe('one-use-apple-code');
    expect(request.body.grant_type).toBe('authorization_code');
    const { payload } = await jwtVerify(
      request.body.client_secret,
      createLocalJWKSet(signingKey.jwks),
      { issuer: TEAM_ID, audience: ISSUER },
    );
    expect(payload.sub).toBe(NATIVE_AUDIENCE);
  });

  it.each([
    { sub: 'another-apple-account' },
    { aud: 'web-service-id' },
    { nonce: 'b'.repeat(64) },
    { iss: 'https://attacker.test' },
    { exp: NATIVE_NOW.getTime() / 1000 },
  ])('refuses the code exchange claims %j', async (claims) => {
    await expect((await proof({}, claims)).result).rejects.toMatchObject({
      status: 502,
    });
  });

  it('refuses a bad initial nonce before exchanging a code', async () => {
    const { result, transport } = await proof({ nonce: 'b'.repeat(64) });
    await expect(result).rejects.toMatchObject({ status: 502 });
    expect(transport.calls.some((call) => call.url === TOKEN_URI)).toBe(false);
  });

  // Erasing the account later revokes Apple's grant with this token.
  it("keeps the exchange's refresh token, readable only as this subject's for the app id", async () => {
    const tokens = new MemoryProviderTokenStore();
    const crypto = new ProviderTokenCrypto(
      new ConfigService({ providerTokens: { encryptionKey: 'k'.repeat(32) } }),
    );
    const vault = new ProviderTokenVault(
      tokens,
      crypto,
      new FrozenClock(NATIVE_NOW),
    );
    mockFetch([
      { url: JWKS_URI, body: key.jwks },
      {
        url: TOKEN_URI,
        body: {
          id_token: await signedNativeToken(key, ISSUER, {}),
          refresh_token: 'apple-refresh-1',
        },
      },
    ]);

    await new AppleOAuthStrategy(
      configFor('apple', {
        clientId: 'web-service-id',
        extra: { TEAM_ID, KEY_ID, PRIVATE_KEY: privateKey },
      }),
      vault,
    ).verifyNativeCredential({
      method: NATIVE_METHOD.apple,
      nonceDigest: NATIVE_NONCE,
      credential: {
        kind: 'appleIdentityTokenAndCode',
        identityToken: await signedNativeToken(key, ISSUER, {}),
        authorizationCode: 'one-use-apple-code',
        nonceDigest: NATIVE_NONCE,
      },
    });

    const owner = {
      provider: 'apple',
      subject: NATIVE_SUBJECT,
      clientId: NATIVE_AUDIENCE,
    };
    expect(
      tokens.tokens.map((kept) => ({
        owner: {
          provider: kept.provider,
          subject: kept.subject,
          clientId: kept.clientId,
        },
        token: crypto.open(kept.sealed, owner),
      })),
    ).toEqual([{ owner, token: 'apple-refresh-1' }]);
  });

  it('does not accept identity when the provider refuses the code', async () => {
    await expect((await proof({}, {}, 400)).result).rejects.toMatchObject({
      status: 400,
    });
  });
});
