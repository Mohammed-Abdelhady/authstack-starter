import { describe, expect, it } from 'vitest';
import {
  AUTHORIZATION_CODE,
  FakeServer,
  SERVER_CLIENT_ID,
  SERVER_ORIGIN,
  SERVER_RETURN_ADDRESS,
} from './support/fake-server';

/**
 * The fake stands in for the server in every shell test, so what it answers is
 * written here by hand from the server's own constants and guard.
 */
async function ask(server: FakeServer, path: string, body?: unknown, bearer?: string) {
  const response = await server.fetch(`${SERVER_ORIGIN}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: bearer === undefined ? {} : { Authorization: `Bearer ${bearer}` },
    credentials: 'omit',
    signal: server.createAbort().signal,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const parsed: unknown = JSON.parse(await response.text());
  return { status: response.status, body: parsed };
}

const EXCHANGE = {
  grant_type: 'authorization_code',
  code: AUTHORIZATION_CODE,
  client_id: SERVER_CLIENT_ID,
  redirect_uri: SERVER_RETURN_ADDRESS,
  code_verifier: 'verifier',
};

describe('the fake server answers as the real one does', () => {
  it('issues a bearer token that lives five minutes', async () => {
    expect(await ask(new FakeServer(), '/api/oauth/token', EXCHANGE)).toEqual({
      status: 200,
      body: {
        access_token: 'access-1',
        refresh_token: 'refresh-1',
        expires_in: 300,
        token_type: 'Bearer',
        scope: 'api',
      },
    });
  });

  it.each([
    ['no credential', undefined, 'SESSION_REQUIRED'],
    ['a token it does not know', 'access-0', 'SESSION_INVALID'],
  ] as const)('refuses a request with %s as the guard does', async (_name, bearer, code) => {
    const server = new FakeServer();
    await ask(server, '/api/oauth/token', EXCHANGE);

    expect(await ask(server, '/api/user/profile', undefined, bearer)).toEqual({
      status: 401,
      body: { success: false, error: { code, message: code } },
    });
  });

  it('answers a revoke with an empty body', async () => {
    const server = new FakeServer();
    await ask(server, '/api/oauth/token', EXCHANGE);

    expect(await ask(server, '/api/oauth/revoke', { token: 'refresh-1' })).toEqual({
      status: 200,
      body: {},
    });
  });

  it('refuses a spent or unknown refresh token as an invalid grant', async () => {
    const server = new FakeServer();
    await ask(server, '/api/oauth/token', EXCHANGE);

    expect(
      await ask(server, '/api/oauth/token', {
        grant_type: 'refresh_token',
        refresh_token: 'refresh-0',
      }),
    ).toEqual({ status: 400, body: { error: 'invalid_grant' } });
  });
});
