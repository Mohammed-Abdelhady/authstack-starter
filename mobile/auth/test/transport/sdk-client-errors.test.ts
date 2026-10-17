import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_DELETION_PATHS,
  API_PATHS,
  BROWSER_PROOF_PATHS,
  HTTP_METHOD,
  createApiClient,
  OAuthError,
} from '@app/sdk';
import { AuthPortError, AuthSessionError } from '../../src';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  ScriptedTransport,
  apiReply,
  establishSession,
  failedApiReply,
  oauthTokenReply,
  refreshToken,
  testPorts,
} from '../support/support';

describe('engine errors through the SDK client', () => {
  it('preserves the signed-out session error and sends no protected request', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.enqueue({ status: 200, body: {} });
    await engine.signOut();
    const sentBefore = transport.sent.length;

    const failure = await createApiClient(engine.transport)
      .profile.get()
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(transport.sent).toHaveLength(sentBefore);
    expect(failure).toBeInstanceOf(AuthSessionError);
    expect(engine.snapshot.status).toBe('signedOut');
    expect(engine.snapshot.reason).toBeUndefined();
  });

  it('preserves the server kill switch OAuth error during refresh', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    transport.enqueue({
      status: 400,
      body: { error: 'unauthorized_client', error_description: 'NATIVE_AUTH_DISABLED' },
    });

    const failure = createApiClient(engine.transport).profile.get();

    await expect(failure).rejects.toBeInstanceOf(OAuthError);
    await expect(failure).rejects.toMatchObject({
      error: 'unauthorized_client',
      errorDescription: 'NATIVE_AUTH_DISABLED',
    });
    expect(engine.snapshot.status).toBe('signedOut');
    expect(engine.snapshot.reason).toBe('disabled');
  });

  it('preserves a replayed refresh OAuth error through the SDK client', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    transport.enqueue({ status: 400, body: { error: 'invalid_grant' } });

    const failure = createApiClient(engine.transport).profile.get();

    await expect(failure).rejects.toBeInstanceOf(OAuthError);
    await expect(failure).rejects.toMatchObject({ error: 'invalid_grant', status: 400 });
    expect(engine.snapshot.status).toBe('signedOut');
    expect(engine.snapshot.reason).toBe('oauthFailure');
  });

  it('preserves a typed engine port failure through the SDK client', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.monotonicTime = () => {
      throw new Error('clock unavailable');
    };

    const failure = createApiClient(engine.transport).profile.get();

    await expect(failure).rejects.toBeInstanceOf(AuthPortError);
    await expect(failure).rejects.toMatchObject({
      operation: 'clock.monotonicTime',
      reason: 'failed',
    });
  });

  it('preserves a storage failure raised while preparing refresh', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    ports.credentials.beforeReplace = (value) =>
      value.includes('"refreshInFlight":true')
        ? Promise.reject(new Error('storage unavailable'))
        : Promise.resolve();
    transport.enqueue({
      status: 401,
      body: { success: false, error: { code: 'SESSION_INVALID', message: 'invalid' } },
    });

    const failure = createApiClient(engine.transport).profile.get();

    await expect(failure).rejects.toBeInstanceOf(AuthPortError);
    await expect(failure).rejects.toMatchObject({
      operation: 'credentials.replace',
      reason: 'failed',
    });
    expect(engine.snapshot).toMatchObject({ status: 'signedIn', operation: 'none' });
  });
  it.each([
    'REAUTH_REQUIRED',
    'ACTIVATION_CODE_INVALID',
    'PASSKEY_VERIFICATION_FAILED',
    'PASSKEY_CHALLENGE_INVALID',
  ])('delivers action refusal %s once without renewing a valid session', async (code) => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    const stored = ports.credentials.value;
    transport.sent.length = 0;
    const refusal = failedApiReply(401, code);
    transport.respond = async ({ path }) =>
      path === API_PATHS.oauth.token
        ? oauthTokenReply('refreshed-access', refreshToken('refreshed'))
        : refusal;

    const result = await engine.transport.request({
      method: HTTP_METHOD.DELETE,
      path: ACCOUNT_DELETION_PATHS.account,
      body: {},
    });

    expect(result).toEqual(refusal);
    expect(transport.sent.map(({ path }) => path)).toEqual([ACCOUNT_DELETION_PATHS.account]);
    expect(engine.snapshot.status).toBe('signedIn');
    expect(ports.credentials.value).toBe(stored);
  });

  it('spends one wrong email-proof attempt and accepts a later correction without refreshing', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.sent.length = 0;
    let wrongAttempts = 0;
    const provedAt = '2026-10-17T00:00:00.000Z';
    transport.respond = async ({ path, body }) => {
      if (path === API_PATHS.oauth.token)
        return oauthTokenReply('refreshed-access', refreshToken('refreshed'));
      if (path === BROWSER_PROOF_PATHS.code) return { status: 200, body: { expiresInMinutes: 10 } };
      if (typeof body === 'object' && body !== null && 'code' in body && body.code === '111111')
        return { status: 200, body: { provedAt } };
      wrongAttempts += 1;
      return failedApiReply(401, 'ACTIVATION_CODE_INVALID');
    };
    const client = createApiClient(engine.transport);
    await client.proof.sendCode();

    await expect(client.proof.verifyCode({ code: '000000' })).rejects.toMatchObject({
      status: 401,
      code: 'ACTIVATION_CODE_INVALID',
    });
    expect(wrongAttempts).toBe(1);
    await expect(client.proof.verifyCode({ code: '111111' })).resolves.toEqual({ provedAt });
    expect(transport.sent.map(({ path }) => path)).toEqual([
      BROWSER_PROOF_PATHS.code,
      BROWSER_PROOF_PATHS.verifyCode,
      BROWSER_PROOF_PATHS.verifyCode,
    ]);
    expect(engine.snapshot.status).toBe('signedIn');
  });

  it.each([
    ['invalid credential', failedApiReply(401, 'SESSION_INVALID')],
    ['missing error envelope', { status: 401, body: { error: { code: 'REAUTH_REQUIRED' } } }],
    [
      'malformed error',
      { status: 401, body: { success: false, error: 'ACTIVATION_CODE_INVALID' } },
    ],
  ] as const)('refreshes and replays a %s 401 exactly once', async (_label, first) => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.sent.length = 0;
    transport.enqueue(
      first,
      oauthTokenReply('refreshed-access', refreshToken('refreshed')),
      apiReply({ message: 'deleted' }),
    );

    await expect(createApiClient(engine.transport).accountDeletion.delete({})).resolves.toEqual({
      message: 'deleted',
    });
    expect(transport.sent.map(({ path }) => path)).toEqual([
      ACCOUNT_DELETION_PATHS.account,
      API_PATHS.oauth.token,
      ACCOUNT_DELETION_PATHS.account,
    ]);
    expect(transport.sent.at(-1)?.headers?.['Authorization']).toBe('Bearer refreshed-access');
  });
});
