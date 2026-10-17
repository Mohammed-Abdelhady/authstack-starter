// feature:google:start
import type { JWTPayload } from 'jose';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { GoogleOAuthStrategy } from '../../src/auth/oauth/strategies/google-oauth.strategy';
import {
  configFor,
  mockFetch,
} from '../../src/auth/oauth/strategies/oauth-strategy.harness-spec';
import {
  createSigningKey,
  signedNativeToken,
  NATIVE_AUDIENCE,
} from '../../src/auth/oauth/strategies/native-provider-proof.harness-spec';
import { resetJwksCache } from '../../src/auth/oauth/utils/id-token.util';
import {
  signAssertion,
  FLAG_USER_PRESENT,
  FLAG_USER_VERIFIED,
} from '../../src/auth/passkeys/services/software-authenticator.harness-spec';
import { reconcileStartupApplications } from '../../src/session/session.module';
import { SEED_ADMIN, SEED_USER } from '../constants/seed-users';
import { loginAs, type BootE2eAppOptions } from '../utils/e2e-app';
import { issueNativeGrantFor } from '../utils/native/native-authorize.fixtures';
import { bearerClient, publicClient } from '../utils/sdk/sdk-transport';
import type { ProofJourney } from './native-proof-cases.harness-spec';

const METHOD = {
  id: 'google',
  displayName: 'Google',
  mode: 'googleIdentityToken',
  sdk: { kind: 'google', webClientId: NATIVE_AUDIENCE },
} as const;
const PROVIDERS = [
  { id: METHOD.id, mode: METHOD.mode, webClientId: NATIVE_AUDIENCE },
];
const FETCH = global.fetch;

export function nativeProviderLinkBoot(): BootE2eAppOptions {
  return {
    browserStrategy: new GoogleOAuthStrategy(
      configFor('google', {
        clientId: 'web-client',
        clientSecret: 'test-secret',
      }),
    ),
  };
}

async function requiredAccount(journey: ProofJourney) {
  const { e2e, application, register, signIn, finish } = journey;
  const first = await issueNativeGrantFor(e2e, SEED_USER.email);
  const registered = await register(first.accessToken);
  expect(registered.verified.status).toBe(200);
  const configured = {
    ...application,
    requirePasskey: true,
    signIn: { ...application.signIn, providers: PROVIDERS },
  };
  e2e.app.get(ConfigService).set('auth.nativeApplications', [
    configured,
    {
      ...application,
      clientId: 'other-native-link-client',
    },
  ]);
  await reconcileStartupApplications(e2e.app);
  const login = await signIn(registered.key, 1);
  expect(login.answered.status).toBe(201);
  const tokens = await finish(login.attempt, login.verifier);
  const client = bearerClient(e2e, tokens.accessToken);
  const prove = async () => {
    const options = await client.passkeys.nativeProofOptions();
    const signed = signAssertion(registered.key, {
      rpId: application.signIn?.rpId ?? '',
      origin: application.signIn?.origins?.[0] ?? '',
      flags: FLAG_USER_PRESENT | FLAG_USER_VERIFIED,
      counter: 2,
      challenge: options.challenge,
    });
    await client.passkeys.nativeProofVerify({
      id: registered.key.credentialId,
      rawId: registered.key.credentialId,
      type: 'public-key',
      response: {
        clientDataJSON: signed.clientDataJSON.toString('base64url'),
        authenticatorData: signed.authenticatorData.toString('base64url'),
        signature: signed.signature.toString('base64url'),
      },
    });
  };
  return { client, tokens, configured, prove, key: registered.key };
}

async function googleCredential(nonceDigest: string, claims: JWTPayload = {}) {
  const signingKey = await createSigningKey();
  const identityToken = await signedNativeToken(
    signingKey,
    'https://accounts.google.com',
    {
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
      nonce: nonceDigest,
      ...claims,
    },
  );
  resetJwksCache();
  mockFetch([
    {
      url: 'https://www.googleapis.com/oauth2/v3/certs',
      body: signingKey.jwks,
    },
  ]);
  return { kind: 'googleIdentityToken', identityToken, nonceDigest } as const;
}

export function nativeProviderLinkCases(current: () => ProofJourney): void {
  afterEach(() => {
    global.fetch = FETCH;
    resetJwksCache();
  });

  it('links a configured provider from required-native account metadata while sign-in stays passkey only', async () => {
    const journey = current();
    const { e2e, application } = journey;
    const { client, tokens, configured, prove } =
      await requiredAccount(journey);
    const methods = await publicClient(e2e).nativeAuth.methods(
      application.clientId,
    );
    expect({
      providers: methods.providers,
      oauth: methods.methods.oauth,
    }).toEqual({ providers: [], oauth: [] });
    const listed = await client.providers.list();
    expect(listed.nativeLinkMethods).toEqual([METHOD]);
    const browser = await loginAs(e2e.httpServer, SEED_USER);
    const browserList = await browser
      .get('/api/user/linked-providers')
      .query({ clientId: application.clientId })
      .expect(200);
    expect(
      (browserList.body as { data: { nativeLinkMethods: unknown } }).data
        .nativeLinkMethods,
    ).toEqual([]);
    await expect(client.providers.linkStart('google')).rejects.toMatchObject({
      code: 'REAUTH_REQUIRED',
    });
    await prove();
    const start = await client.providers.linkStart('google');
    const input = {
      linkId: start.linkId,
      credential: await googleCredential(start.nonceDigest, {
        sub: 'required-native-link-identity',
        email: 'provider-different@example.test',
      }),
    };
    const admin = await loginAs(e2e.httpServer, SEED_ADMIN);
    const wrongAccount = await admin
      .post('/api/user/providers/link/finish')
      .send(input)
      .expect(400);
    expect(wrongAccount.body).toMatchObject({
      error: { code: 'OAUTH_STATE_INVALID' },
    });
    await client.providers.linkFinish(input);
    expect((await client.providers.list()).providers).toEqual([
      'email',
      'google',
    ]);
    const adminList = await admin.get('/api/user/linked-providers').expect(200);
    expect(
      (adminList.body as { data: { providers: string[] } }).data.providers,
    ).toEqual(['email']);
    await expect(client.providers.linkFinish(input)).rejects.toMatchObject({
      code: 'OAUTH_STATE_INVALID',
    });
    e2e.app
      .get(ConfigService)
      .set('auth.nativeApplications', [
        { ...configured, signIn: { ...configured.signIn, providers: [] } },
      ]);
    await reconcileStartupApplications(e2e.app);
    await request(e2e.httpServer)
      .get('/api/user/linked-providers')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(401);
  });

  it('refuses a required-native provider link with wrong nonce, audience or client configuration', async () => {
    const { e2e } = current();
    const journey = current();
    const { client, prove, key } = await requiredAccount(journey);
    await prove();
    for (const [nonceOverride, audience] of [
      [true, NATIVE_AUDIENCE],
      [false, 'wrong-client'],
    ] as const) {
      const start = await client.providers.linkStart('google');
      const credential = await googleCredential(start.nonceDigest, {
        aud: audience,
      });
      await expect(
        client.providers.linkFinish({
          linkId: start.linkId,
          credential: {
            ...credential,
            nonceDigest: nonceOverride ? 'f'.repeat(64) : start.nonceDigest,
          },
        }),
      ).rejects.toMatchObject({
        code: nonceOverride
          ? 'OAUTH_STATE_INVALID'
          : 'OAUTH_AUTHENTICATION_FAILED',
      });
    }
    expect((await client.providers.list()).providers).toEqual(['email']);
    await expect(client.providers.linkStart('apple')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    const ticket = await client.providers.linkStart('google');
    const credential = await googleCredential(ticket.nonceDigest);
    const other = await issueNativeGrantFor(
      e2e,
      SEED_USER.email,
      'other-native-link-client',
    );
    const otherClient = bearerClient(e2e, other.accessToken);
    await expect(
      otherClient.providers.linkFinish({ linkId: ticket.linkId, credential }),
    ).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });
    expect((await otherClient.providers.list()).nativeLinkMethods).toEqual([]);
    await expect(
      otherClient.providers.linkStart('google'),
    ).rejects.toMatchObject({ code: 'FEATURE_DISABLED' });
    const another = await journey.signIn(key, 3);
    const anotherTokens = await journey.finish(
      another.attempt,
      another.verifier,
    );
    await expect(
      bearerClient(e2e, anotherTokens.accessToken).providers.linkStart(
        'google',
      ),
    ).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
  });
}
// feature:google:end
