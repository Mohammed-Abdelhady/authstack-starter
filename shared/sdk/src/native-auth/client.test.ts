import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { answering, respond } from '../test-support';
import type { TransportRequest } from '../transport';

const ATTEMPT_SECRET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const CODE_CHALLENGE = 'CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC';
const PASSWORD = ['Password', '123'].join('');
const RECOVERY_PASSWORD = ['Password', '456'].join('');
const ATTEMPT = { id: 'attempt/1', secret: ATTEMPT_SECRET };
const VIEW = {
  attemptId: 'attempt-1',
  stage: 'firstFactorRequired',
  expiresAt: '2026-10-12T15:30:00.000Z',
  factors: ['password', 'provider'],
};
const VIEW_RESPONSE = { success: true, data: VIEW };
const ASSERTION = {
  id: 'credential-id',
  rawId: 'credential-raw-id',
  response: {
    clientDataJSON: 'client-data',
    authenticatorData: 'authenticator-data',
    signature: 'signature',
    userHandle: null,
  },
  type: 'public-key' as const,
};

describe('native auth client routes', () => {
  it('encodes the client id in the public method catalogue route', async () => {
    const transport = answering(200, {
      success: true,
      data: {
        nativeEnabled: true,
        methods: { password: true, oauth: [] },
        capabilities: {
          password: true,
          emailLink: false,
          passkeys: false,
          registration: false,
          recovery: false,
        },
        providers: [],
      },
    });

    const methods = await createApiClient(transport).nativeAuth.methods('app +?');

    expect(
      transport.sent.map(({ method, path, body }) => ({
        method,
        path,
        ...(body === undefined ? {} : { body }),
      })),
    ).toStrictEqual([{ method: 'GET', path: '/api/auth/native/methods?clientId=app%20%2B%3F' }]);
    expect(methods.methods.magicLink).toBe(false);
    expect(methods.methods.twoFactor).toBe(false);
    expect(methods.methods.passkeys).toBe(false);
  });

  it('starts an attempt without sending an attempt credential', async () => {
    const result = {
      ...VIEW,
      attemptId: 'attempt-1',
      attemptSecret: ATTEMPT_SECRET,
      providerNonceDigest: 'b'.repeat(64),
    };
    const transport = answering(200, { success: true, data: result });

    await createApiClient(transport).nativeAuth.start({
      clientId: 'native-app',
      redirectUri: 'sampleapp://oauth/callback',
      codeChallenge: CODE_CHALLENGE,
      codeChallengeMethod: 'S256',
      state: 'state-value',
      scopes: ['profile:read'],
      flow: 'signIn',
    });

    expect(transport.sent).toStrictEqual([
      {
        method: 'POST',
        path: '/api/auth/native/attempts',
        body: {
          clientId: 'native-app',
          redirectUri: 'sampleapp://oauth/callback',
          codeChallenge: CODE_CHALLENGE,
          codeChallengeMethod: 'S256',
          state: 'state-value',
          scopes: ['profile:read'],
          flow: 'signIn',
        },
      },
    ]);
  });

  it('rejects malformed start and provider credentials before transport', async () => {
    const transport = answering(200, VIEW_RESPONSE);
    const api = createApiClient(transport).nativeAuth;

    await expect(
      api.start({
        clientId: 'native-app',
        redirectUri: 'sampleapp://oauth/callback',
        codeChallenge: 'invalid',
        codeChallengeMethod: 'S256',
        state: 'state-value',
        scopes: ['profile:read'],
        flow: 'signIn',
      }),
    ).rejects.toBeInstanceOf(TypeError);
    await expect(
      api.provider(ATTEMPT, {
        kind: 'googleIdentityToken',
        identityToken: 'identity-token',
        nonceDigest: 'not-a-sha256-digest',
      }),
    ).rejects.toBeInstanceOf(TypeError);
    expect(transport.sent).toEqual([]);
  });

  it('rejects a malformed provider nonce digest in the start reply', async () => {
    const transport = answering(200, {
      success: true,
      data: {
        ...VIEW,
        attemptId: 'attempt-1',
        attemptSecret: ATTEMPT_SECRET,
        providerNonceDigest: 'G'.repeat(64),
      },
    });

    await expect(
      createApiClient(transport).nativeAuth.start({
        clientId: 'native-app',
        redirectUri: 'sampleapp://oauth/callback',
        codeChallenge: CODE_CHALLENGE,
        codeChallengeMethod: 'S256',
        state: 'state-value',
        scopes: ['profile:read'],
        flow: 'signIn',
      }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 200 });
  });

  it('sends the exact native operation routes and bodies', async () => {
    const sent: TransportRequest[] = [];
    const transport = {
      sent,
      request: async (request: TransportRequest) => {
        sent.push(request);
        return request.path.endsWith('/passkey/options')
          ? respond(200, { success: true, data: { challenge: 'challenge-value' } })
          : respond(200, VIEW_RESPONSE);
      },
    };
    const api = createApiClient(transport).nativeAuth;
    const provider = {
      kind: 'googleIdentityToken' as const,
      identityToken: 'identity-token',
      nonceDigest: 'b'.repeat(64),
    };

    await api.resume(ATTEMPT);
    await api.password(ATTEMPT, { email: 'user@example.com', password: PASSWORD });
    await api.provider(ATTEMPT, provider);
    await api.passkeyOptions(ATTEMPT);
    await api.passkeyVerify(ATTEMPT, ASSERTION);
    await api.secondFactor(ATTEMPT, { code: '123456' });
    await api.secondFactor(ATTEMPT, { recoveryCode: 'K3M7QRTVWX' });
    await api.secondFactor(ATTEMPT, { passkeyResponse: ASSERTION });
    await api.requestEmailLink(ATTEMPT, 'user@example.com');
    await api.verifyEmailLink(ATTEMPT, { token: 'mail-token', state: 'state-value' });
    await api.register(ATTEMPT, 'user@example.com');
    await api.activate(ATTEMPT, {
      email: 'user@example.com',
      code: '123456',
      password: PASSWORD,
      name: 'Sam Example',
    });
    await api.requestRecovery(ATTEMPT, 'user@example.com');
    await api.confirmRecovery(ATTEMPT, {
      email: 'user@example.com',
      code: '123456',
      newPassword: RECOVERY_PASSWORD,
    });
    await api.consent(ATTEMPT);
    await api.cancel(ATTEMPT);

    expect(
      transport.sent.map(({ method, path, body }) => ({
        method,
        path,
        ...(body === undefined ? {} : { body }),
      })),
    ).toStrictEqual([
      { method: 'GET', path: '/api/auth/native/attempts/attempt%2F1' },
      {
        method: 'POST',
        path: '/api/auth/native/attempts/attempt%2F1/password',
        body: { email: 'user@example.com', password: PASSWORD },
      },
      {
        method: 'POST',
        path: '/api/auth/native/attempts/attempt%2F1/provider',
        body: provider,
      },
      { method: 'POST', path: '/api/auth/native/attempts/attempt%2F1/passkey/options' },
      {
        method: 'POST',
        path: '/api/auth/native/attempts/attempt%2F1/passkey/verify',
        body: { response: ASSERTION },
      },
      {
        method: 'POST',
        path: '/api/auth/native/attempts/attempt%2F1/second-factor',
        body: { code: '123456' },
      },
      {
        method: 'POST',
        path: '/api/auth/native/attempts/attempt%2F1/second-factor',
        body: { recoveryCode: 'K3M7QRTVWX' },
      },
      {
        method: 'POST',
        path: '/api/auth/native/attempts/attempt%2F1/second-factor',
        body: { passkeyResponse: ASSERTION },
      },
      {
        method: 'POST',
        path: '/api/auth/native/attempts/attempt%2F1/email-link/request',
        body: { email: 'user@example.com' },
      },
      {
        method: 'POST',
        path: '/api/auth/native/attempts/attempt%2F1/email-link/verify',
        body: { token: 'mail-token', state: 'state-value' },
      },
      {
        method: 'POST',
        path: '/api/auth/native/attempts/attempt%2F1/register',
        body: { email: 'user@example.com' },
      },
      {
        method: 'POST',
        path: '/api/auth/native/attempts/attempt%2F1/activate',
        body: {
          email: 'user@example.com',
          code: '123456',
          password: PASSWORD,
          name: 'Sam Example',
        },
      },
      {
        method: 'POST',
        path: '/api/auth/native/attempts/attempt%2F1/recovery/request',
        body: { email: 'user@example.com' },
      },
      {
        method: 'POST',
        path: '/api/auth/native/attempts/attempt%2F1/recovery/confirm',
        body: { email: 'user@example.com', code: '123456', newPassword: RECOVERY_PASSWORD },
      },
      { method: 'POST', path: '/api/auth/native/attempts/attempt%2F1/consent' },
      { method: 'POST', path: '/api/auth/native/attempts/attempt%2F1/cancel' },
    ]);
  });

  it('replaces caller credential headers while preserving safe headers and the signal', async () => {
    const transport = answering(200, VIEW_RESPONSE);
    const signal = { aborted: false };

    await createApiClient(transport).nativeAuth.password(
      ATTEMPT,
      { email: 'user@example.com', password: PASSWORD },
      {
        signal,
        headers: {
          Cookie: 'browser=1',
          authorization: 'Bearer wrong',
          'x-native-attempt': 'wrong-lowercase',
          'X-Native-Attempt': 'wrong-exact',
          'X-Trace-Id': 'trace-1',
        },
      },
    );

    expect(transport.sent).toStrictEqual([
      {
        method: 'POST',
        path: '/api/auth/native/attempts/attempt%2F1/password',
        body: { email: 'user@example.com', password: PASSWORD },
        headers: {
          'X-Trace-Id': 'trace-1',
          'X-Native-Attempt': ATTEMPT_SECRET,
        },
        signal,
      },
    ]);
  });

  it('rejects unsafe attempt ids and malformed secrets before sending', async () => {
    const transport = answering(200, VIEW_RESPONSE);
    const api = createApiClient(transport).nativeAuth;

    await expect(api.cancel({ id: '..', secret: ATTEMPT_SECRET })).rejects.toBeInstanceOf(
      TypeError,
    );
    await expect(api.cancel({ id: 'attempt-1', secret: 'short' })).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(transport.sent).toEqual([]);
  });

  it('keeps abort behavior on native operations', async () => {
    const transport = answering(200, VIEW_RESPONSE);
    const signal = { aborted: true };

    await expect(
      createApiClient(transport).nativeAuth.cancel(ATTEMPT, { signal }),
    ).rejects.toMatchObject({ name: 'TransportError', reason: 'aborted' });
    expect(transport.sent).toEqual([]);
  });
});
