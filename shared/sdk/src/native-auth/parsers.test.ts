import { describe, expect, it } from 'vitest';
import { createApiClient } from '../client';
import { answering } from '../test-support';

const ATTEMPT = {
  id: 'attempt-1',
  secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
};
const EXPIRY = '2026-10-12T15:30:00.000Z';

async function readAttempt(data: unknown) {
  const transport = answering(200, { success: true, data });
  const result = await createApiClient(transport).nativeAuth.cancel(ATTEMPT);
  return { result, transport };
}

describe('native auth response parsers', () => {
  it('parses the native catalogue separately from browser AuthMethods', async () => {
    const transport = answering(200, {
      success: true,
      data: {
        nativeEnabled: true,
        methods: {
          password: true,
          magicLink: true,
          twoFactor: true,
          passkeys: true,
          oauth: [
            { id: 'google', displayName: 'Google' },
            { id: 'microsoft', displayName: 'Microsoft' },
          ],
        },
        capabilities: {
          password: true,
          emailLink: true,
          passkeys: true,
          registration: true,
          recovery: true,
        },
        providers: [
          {
            id: 'google',
            displayName: 'Google',
            mode: 'googleIdentityToken',
            sdk: { kind: 'google', webClientId: 'web-client', iosClientId: 'ios-client' },
          },
          { id: 'microsoft', displayName: 'Microsoft', mode: 'system' },
        ],
      },
    });

    const catalogue = await createApiClient(transport).nativeAuth.methods('mobile-app');

    expect(catalogue).toStrictEqual({
      nativeEnabled: true,
      methods: {
        password: true,
        magicLink: true,
        emailCode: false,
        twoFactor: true,
        passkeys: true,
        oauth: [
          { id: 'google', displayName: 'Google' },
          { id: 'microsoft', displayName: 'Microsoft' },
        ],
      },
      capabilities: {
        password: true,
        emailLink: true,
        passkeys: true,
        registration: true,
        recovery: true,
      },
      providers: [
        {
          id: 'google',
          displayName: 'Google',
          mode: 'googleIdentityToken',
          sdk: { kind: 'google', webClientId: 'web-client', iosClientId: 'ios-client' },
        },
        { id: 'microsoft', displayName: 'Microsoft', mode: 'system' },
      ],
    });
  });

  // feature:email-code:start
  it('reads the email code capability and refuses one that is not a boolean', async () => {
    const reply = (emailCode: unknown) =>
      answering(200, {
        success: true,
        data: {
          nativeEnabled: true,
          methods: { password: false, emailCode: true, oauth: [] },
          capabilities: {
            password: false,
            emailLink: false,
            passkeys: false,
            registration: false,
            recovery: false,
            emailCode,
          },
          providers: [],
        },
      });

    const catalogue = await createApiClient(reply(true)).nativeAuth.methods('mobile-app');
    expect(catalogue.capabilities.emailCode).toBe(true);
    const disabled = await createApiClient(reply(false)).nativeAuth.methods('mobile-app');
    expect(disabled.methods.emailCode).toBe(true);
    expect(disabled.capabilities.emailCode).toBe(false);
    await expect(
      createApiClient(reply('yes')).nativeAuth.methods('mobile-app'),
    ).rejects.toMatchObject({ name: 'ApiError', status: 200 });
  });
  // feature:email-code:end

  it('rejects native provider configurations that do not match the enabled provider set', async () => {
    const transport = answering(200, {
      success: true,
      data: {
        nativeEnabled: true,
        methods: { password: true, oauth: [{ id: 'google', displayName: 'Google' }] },
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

    await expect(createApiClient(transport).nativeAuth.methods('mobile-app')).rejects.toMatchObject(
      {
        name: 'ApiError',
        status: 200,
      },
    );
  });

  it('rejects an SDK provider mode assigned to a different provider id', async () => {
    const transport = answering(200, {
      success: true,
      data: {
        nativeEnabled: true,
        methods: { password: true, oauth: [{ id: 'googleAlias', displayName: 'Google' }] },
        capabilities: {
          password: true,
          emailLink: false,
          passkeys: false,
          registration: false,
          recovery: false,
        },
        providers: [
          {
            id: 'googleAlias',
            displayName: 'Google',
            mode: 'googleIdentityToken',
            sdk: { kind: 'google', webClientId: 'web-client' },
          },
        ],
      },
    });

    await expect(createApiClient(transport).nativeAuth.methods('mobile-app')).rejects.toMatchObject(
      {
        name: 'ApiError',
        status: 200,
      },
    );
  });

  it('rejects a secret field in public provider configuration', async () => {
    const transport = answering(200, {
      success: true,
      data: {
        nativeEnabled: true,
        methods: { password: true, oauth: [{ id: 'facebook', displayName: 'Facebook' }] },
        capabilities: {
          password: true,
          emailLink: false,
          passkeys: false,
          registration: false,
          recovery: false,
        },
        providers: [
          {
            id: 'facebook',
            displayName: 'Facebook',
            mode: 'facebook',
            sdk: { kind: 'facebook', appId: 'public-app', appSecret: 'must-not-escape' },
          },
        ],
      },
    });

    await expect(createApiClient(transport).nativeAuth.methods('mobile-app')).rejects.toMatchObject(
      {
        name: 'ApiError',
        status: 200,
      },
    );
  });

  it('parses every display-safe attempt stage, including recovery completion', async () => {
    const cases = [
      {
        stage: 'firstFactorRequired',
        fields: { factors: ['password'], email: 'user@example.com' },
      },
      { stage: 'emailLinkSent', fields: { email: 'user@example.com' } },
      {
        stage: 'registrationCodeRequired',
        fields: { email: 'user@example.com', activationCompleted: false },
      },
      { stage: 'recoveryCodeRequired', fields: { email: 'user@example.com' } },
      {
        stage: 'secondFactorRequired',
        fields: { factors: ['totp', 'recoveryCode'], activationCompleted: true },
      },
      {
        stage: 'consentRequired',
        fields: {
          account: { id: 'account-1', email: 'user@example.com', name: 'Sam Example' },
          application: {
            clientId: 'mobile-app',
            displayName: 'Sample App',
            scopes: ['profile:read'],
            alreadyGranted: false,
          },
          activationCompleted: true,
        },
      },
      { stage: 'denied', fields: { reason: 'cancelled' } },
      { stage: 'recoveryComplete', fields: { passwordUpdated: true } },
    ];

    for (const { stage, fields } of cases) {
      const data = { attemptId: 'attempt-1', stage, expiresAt: EXPIRY, ...fields };
      const { result } = await readAttempt(data);

      expect(result).toStrictEqual(data);
    }
  });

  it('parses a code-ready callback URI without exposing standalone credentials', async () => {
    const data = {
      attemptId: 'attempt-1',
      stage: 'codeReady',
      expiresAt: EXPIRY,
      redirectUri: 'sampleapp://oauth/callback?code=authorization-code&state=state-value',
      activationCompleted: true,
    };

    const { result } = await readAttempt(data);

    expect(result).toStrictEqual(data);
  });

  it('rejects unknown stages, missing phase fields, and credentials in a display view', async () => {
    const malformed = [
      { attemptId: 'attempt-1', stage: 'unknown', expiresAt: EXPIRY },
      { attemptId: 'attempt-1', stage: 'emailLinkSent', expiresAt: EXPIRY },
      { attemptId: 'attempt-1', stage: 'secondFactorRequired', expiresAt: EXPIRY, factors: [] },
      {
        attemptId: 'attempt-1',
        stage: 'firstFactorRequired',
        expiresAt: EXPIRY,
        factors: ['password'],
        attemptSecret: ATTEMPT.secret,
      },
    ];

    for (const data of malformed) {
      await expect(readAttempt(data)).rejects.toMatchObject({ name: 'ApiError', status: 200 });
    }
  });

  it('requires a callback URI and valid expiry for terminal results', async () => {
    await expect(
      readAttempt({
        attemptId: 'attempt-1',
        stage: 'codeReady',
        expiresAt: EXPIRY,
        redirectUri: 'sampleapp://oauth/callback',
        code: 'authorization-code',
      }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 200 });
    await expect(
      readAttempt({
        attemptId: 'attempt-1',
        stage: 'codeReady',
        expiresAt: EXPIRY,
        redirectUri: `sampleapp://oauth/${'a'.repeat(4096)}`,
      }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 200 });
    await expect(
      readAttempt({
        attemptId: 'attempt-1',
        stage: 'recoveryComplete',
        expiresAt: 'yesterday',
        passwordUpdated: true,
      }),
    ).rejects.toMatchObject({ name: 'ApiError', status: 200 });
  });
});
