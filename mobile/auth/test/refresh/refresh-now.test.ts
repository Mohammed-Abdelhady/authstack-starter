import { REFRESH_ROTATED_TOKEN } from '../support/token-values';
import { HTTP_METHOD, OAuthError } from '@app/sdk';
import type { TransportResponse } from '@app/sdk';
import { describe, expect, it } from 'vitest';
import { refreshRequests } from '../support/device-bound-support';
import { createAuthEngine } from '../support/engine';
import {
  REFRESH_TOKEN,
  CONFIG,
  Deferred,
  ScriptedTransport,
  apiReply,
  establishSession,
  oauthTokenReply,
  testPorts,
} from '../support/support';

const PROFILE = { method: HTTP_METHOD.GET, path: '/api/user/profile' } as const;
const ACCESS_TOKEN_LIFETIME_MS = 270_000;

async function signedIn() {
  const transport = new ScriptedTransport();
  const ports = testPorts(transport);
  const engine = createAuthEngine(CONFIG, ports);
  await establishSession(engine, ports, transport);
  return { transport, ports, engine };
}

describe('a refresh the app asks for', () => {
  it('rotates a token that has not expired and stores the new one', async () => {
    const { transport, ports, engine } = await signedIn();
    transport.enqueue(oauthTokenReply('access-rotated', REFRESH_ROTATED_TOKEN), apiReply({}));

    const outcome = await engine.refresh();
    await engine.transport.request(PROFILE);

    expect(outcome).toEqual({ kind: 'refreshed' });
    expect(refreshRequests(transport).map(({ body }) => body)).toMatchObject([
      { refresh_token: REFRESH_TOKEN },
    ]);
    expect(JSON.parse(ports.credentials.value ?? '{}')).toMatchObject({
      tokens: { refreshToken: REFRESH_ROTATED_TOKEN },
    });
    expect(transport.sent.at(-1)?.headers?.['Authorization']).toBe('Bearer access-rotated');
    expect(engine.snapshot).toMatchObject({ status: 'signedIn', operation: 'none' });
  });

  it('sends one refresh for two calls made at once', async () => {
    const { transport, engine } = await signedIn();
    const answer = new Deferred<TransportResponse>();
    transport.enqueue(() => answer.promise);

    const first = engine.refresh();
    const second = engine.refresh();
    answer.resolve(oauthTokenReply('access-rotated', REFRESH_ROTATED_TOKEN));

    expect(await Promise.all([first, second])).toEqual([
      { kind: 'refreshed' },
      { kind: 'refreshed' },
    ]);
    expect(refreshRequests(transport)).toHaveLength(1);
  });

  it('joins the refresh a request with an expired token already started', async () => {
    const { transport, ports, engine } = await signedIn();
    ports.clock.advance(ACCESS_TOKEN_LIFETIME_MS);
    const answer = new Deferred<TransportResponse>();
    const asked = new Deferred<void>();
    transport.respond = (request) => {
      if (request.path !== '/api/oauth/token') return Promise.resolve(apiReply({}));
      asked.resolve();
      return answer.promise;
    };

    const request = engine.transport.request(PROFILE);
    await asked.promise;
    const manual = engine.refresh();
    answer.resolve(oauthTokenReply('access-rotated', REFRESH_ROTATED_TOKEN));

    expect(await manual).toEqual({ kind: 'refreshed' });
    expect((await request).status).toBe(200);
    expect(refreshRequests(transport)).toHaveLength(1);
    expect(transport.sent.at(-1)?.headers?.['Authorization']).toBe('Bearer access-rotated');
  });

  it('answers notSignedIn without a request when there is no session', async () => {
    const transport = new ScriptedTransport();
    const engine = createAuthEngine(CONFIG, testPorts(transport));
    await engine.restore();

    expect(await engine.refresh()).toEqual({ kind: 'notSignedIn' });
    expect(transport.sent).toHaveLength(0);
  });

  it('answers disposed after dispose', async () => {
    const { transport, engine } = await signedIn();
    const sentBefore = transport.sent.length;
    engine.dispose();

    expect(await engine.refresh()).toEqual({ kind: 'disposed' });
    expect(transport.sent).toHaveLength(sentBefore);
  });

  it('ends the session like an automatic refresh when the server refuses the token', async () => {
    const { transport, ports, engine } = await signedIn();
    transport.enqueue({ status: 400, body: { error: 'invalid_grant' } });

    const outcome = await engine.refresh();

    expect(outcome.kind).toBe('failed');
    expect('error' in outcome && outcome.error instanceof OAuthError).toBe(true);
    expect(outcome).toMatchObject({ error: { error: 'invalid_grant' } });
    expect(engine.snapshot).toEqual({
      status: 'signedOut',
      operation: 'none',
      reason: 'oauthFailure',
    });
    expect(ports.credentials.value).toBeUndefined();
  });
});
