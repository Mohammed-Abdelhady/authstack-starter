import { describe, expect, it } from 'vitest';
import { createApiClient, type ApiClient } from './client';
import { ApiError, OAuthError } from './errors';
import { SdkError } from './index';
import { answering, rejecting, respond, type FakeTransport } from './test-support';
import { TransportError, type TransportSignal } from './transport';

const SESSION_ID = '65a000000000000000000001';
const EXCHANGE = { code: 'c', codeVerifier: 'v', redirectUri: 'myapp://callback', clientId: 'app' };
const REFRESH = { refreshToken: 'rt-0', clientId: 'app' };

type Signal = { signal: TransportSignal };

/** Every client method, so a rule about all calls is checked on all of them. */
const CALLS: [string, (client: ApiClient, options?: Signal) => Promise<unknown>][] = [
  ['profile.get', (client, options) => client.profile.get(options)],
  ['profile.update', (client, options) => client.profile.update({ name: 'A B' }, options)],
  ['sessions.list', (client, options) => client.sessions.list(options)],
  ['sessions.revoke', (client, options) => client.sessions.revoke(SESSION_ID, options)],
  ['sessions.revokeOthers', (client, options) => client.sessions.revokeOthers(options)],
  ['auth.methods', (client, options) => client.auth.methods(options)],
  ['auth.signOut', (client, options) => client.auth.signOut(options)],
  ['oauth.exchangeCode', (client, options) => client.oauth.exchangeCode(EXCHANGE, options)],
  ['oauth.refresh', (client, options) => client.oauth.refresh(REFRESH, options)],
  ['oauth.revoke', (client, options) => client.oauth.revoke({ token: 'rt-1' }, options)],
];

describe('createApiClient failures', () => {
  it('raises an HTTP failure as ApiError, not as TransportError', async () => {
    const client = createApiClient(
      answering(401, {
        success: false,
        error: { code: 'SESSION_INVALID', message: 'Invalid session' },
      }),
    );

    const failure = client.profile.get();

    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.not.toBeInstanceOf(TransportError);
    await expect(failure).rejects.toMatchObject({ status: 401, code: 'SESSION_INVALID' });
  });

  it('raises a refused grant as OAuthError', async () => {
    const client = createApiClient(answering(400, { error: 'invalid_grant' }));

    const failure = client.oauth.refresh(REFRESH);

    await expect(failure).rejects.toBeInstanceOf(OAuthError);
    await expect(failure).rejects.toMatchObject({ status: 400, error: 'invalid_grant' });
  });

  it('passes the OAuth description and DPoP nonce through the typed client', async () => {
    const client = createApiClient({
      request: () =>
        Promise.resolve(
          respond(
            400,
            { error: 'use_dpop_nonce', error_description: 'NATIVE_DPOP_REQUIRED' },
            { 'dpop-nonce': 'nonce-2' },
          ),
        ),
    });

    await expect(client.oauth.refresh(REFRESH)).rejects.toMatchObject({
      error: 'use_dpop_nonce',
      errorDescription: 'NATIVE_DPOP_REQUIRED',
      dpopNonce: 'nonce-2',
    });
  });

  it('raises a refused revoke as OAuthError', async () => {
    const client = createApiClient(answering(400, { error: 'invalid_request' }));

    const failure = client.oauth.revoke({ token: '' });

    await expect(failure).rejects.toBeInstanceOf(OAuthError);
    await expect(failure).rejects.toMatchObject({ status: 400, error: 'invalid_request' });
  });

  it('refuses a token reply with no tokens in it', async () => {
    const client = createApiClient(answering(200, {}));

    const failure = client.oauth.exchangeCode(EXCHANGE);

    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 200, code: 'UNKNOWN_ERROR' });
  });
});

describe('createApiClient malformed replies', () => {
  it.each([
    ['profile.get', (client: ApiClient) => client.profile.get()],
    ['profile.update', (client: ApiClient) => client.profile.update({ name: 'A B' })],
    ['sessions.list', (client: ApiClient) => client.sessions.list()],
    ['sessions.revoke', (client: ApiClient) => client.sessions.revoke(SESSION_ID)],
    ['sessions.revokeOthers', (client: ApiClient) => client.sessions.revokeOthers()],
    ['auth.methods', (client: ApiClient) => client.auth.methods()],
    ['auth.signOut', (client: ApiClient) => client.auth.signOut()],
  ])('%s refuses a success envelope whose data is null', async (_name, call) => {
    const failure = call(createApiClient(answering(200, { success: true, data: null })));

    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ status: 200, code: 'UNKNOWN_ERROR' });
  });

  it('refuses sign-in methods without the password switch', async () => {
    const client = createApiClient(answering(200, { success: true, data: { methods: {} } }));

    await expect(client.auth.methods()).rejects.toMatchObject({ code: 'UNKNOWN_ERROR' });
  });
});

describe('createApiClient without a response', () => {
  it('surfaces a transport rejection as the same TransportError', async () => {
    const offline = new TransportError();
    const client = createApiClient(rejecting(offline));

    await expect(client.profile.get()).rejects.toBe(offline);
    expect(offline).toBeInstanceOf(SdkError);
    expect(offline.reason).toBe('no_response');
  });

  it.each([
    ['ApiError', new ApiError({ status: 409, code: 'CONFLICT', message: 'Conflict' })],
    ['OAuthError', new OAuthError({ status: 400, error: 'invalid_grant' })],
  ])('preserves a transport-thrown %s by identity', async (_name, typedError) => {
    const received = await createApiClient(rejecting(typedError))
      .profile.get()
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(received).toBe(typedError);
    expect(typedError).toBeInstanceOf(SdkError);
  });

  it('preserves a branded SDK error created by a second package copy', async () => {
    const duplicateCopyError = new Error('session is required');
    Object.defineProperty(duplicateCopyError, Symbol.for('@app/sdk/SdkError'), { value: true });
    const received = await createApiClient(rejecting(duplicateCopyError))
      .profile.get()
      .then(
        () => undefined,
        (error: unknown) => error,
      );

    expect(received).toBe(duplicateCopyError);
  });

  it('wraps an untyped rejection as a network failure that keeps the cause', async () => {
    const cause = new TypeError('Network request failed');
    const failure = createApiClient(rejecting(cause)).sessions.list();

    await expect(failure).rejects.toBeInstanceOf(TransportError);
    await expect(failure).rejects.not.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({ reason: 'no_response', cause });
  });
});

describe('createApiClient signal forwarding', () => {
  it.each(CALLS)('%s hands the signal to the transport untouched', async (_name, call) => {
    const signal = { aborted: false };
    const transport = answering(200, { success: true, data: {} });

    await call(createApiClient(transport), { signal }).catch(() => undefined);

    expect(transport.sent).toHaveLength(1);
    for (const request of transport.sent) expect(request.signal).toBe(signal);
  });

  it.each(CALLS)('%s sends no signal key when the caller gave none', async (_name, call) => {
    const transport = answering(200, { success: true, data: {} });

    await call(createApiClient(transport)).catch(() => undefined);

    expect(transport.sent).toHaveLength(1);
    for (const request of transport.sent) expect('signal' in request).toBe(false);
  });

  it.each(CALLS)('%s does not send once the signal is aborted', async (_name, call) => {
    const transport: FakeTransport = answering(200, { success: true, data: {} });

    const failure = call(createApiClient(transport), { signal: { aborted: true } });

    await expect(failure).rejects.toBeInstanceOf(TransportError);
    await expect(failure).rejects.toMatchObject({ reason: 'aborted' });
    expect(transport.sent).toEqual([]);
  });
});

describe('createApiClient abort races', () => {
  it('reports an abort during the request as aborted, whatever the transport threw', async () => {
    const signal = { aborted: false };
    const abortError = new Error('The operation was aborted');
    const client = createApiClient({
      request: () => {
        signal.aborted = true;
        return Promise.reject(abortError);
      },
    });

    const failure = client.profile.get({ signal });

    await expect(failure).rejects.toBeInstanceOf(TransportError);
    await expect(failure).rejects.toMatchObject({ reason: 'aborted', cause: abortError });
  });

  it('reports abort when a no-response transport error follows the signal abort', async () => {
    const signal = { aborted: false };
    const mislabelled = new TransportError('no_response');
    const client = createApiClient({
      request: () => {
        signal.aborted = true;
        return Promise.reject(mislabelled);
      },
    });

    await expect(client.profile.get({ signal })).rejects.toMatchObject({
      reason: 'aborted',
      cause: mislabelled,
    });
  });

  it('reports a network failure as no_response while the signal is still live', async () => {
    const failure = createApiClient(rejecting(new Error('offline'))).profile.get({
      signal: { aborted: false },
    });

    await expect(failure).rejects.toMatchObject({ reason: 'no_response' });
  });

  it('keeps a response that arrived even if the signal aborted afterwards', async () => {
    const signal = { aborted: false };
    const client = createApiClient({
      request: () => {
        signal.aborted = true;
        return Promise.resolve({ status: 200, body: { success: true, data: { message: 'ok' } } });
      },
    });

    await expect(client.auth.signOut({ signal })).resolves.toEqual({ message: 'ok' });
  });
});
