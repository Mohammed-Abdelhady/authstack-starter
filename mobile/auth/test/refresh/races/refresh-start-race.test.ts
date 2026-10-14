import { REFRESH_AFTER_RESTORE_TOKEN } from '../../support/token-values';
import { describe, expect, it } from 'vitest';
import { AuthSessionError } from '../../../src';
import { HTTP_METHOD } from '@app/sdk';
import { createAuthEngine } from '../../support/engine';
import {
  CONFIG,
  ScriptedTransport,
  REFRESH_TOKEN,
  establishSession,
  oauthTokenReply,
  testPorts,
} from '../../support/support';
import { revokedTokens } from '../../support/tracking';

describe('refresh queued before sign out', () => {
  it('refuses a queued refresh after sign out clears the session', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    transport.sent.length = 0;
    ports.clock.advance(301_000);
    transport.enqueue({ status: 200, body: {} });

    const request = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    const signOut = engine.signOut();

    await expect(request).rejects.toBeInstanceOf(AuthSessionError);
    await signOut;

    expect(transport.sent.filter(({ path }) => path === '/api/user/profile')).toHaveLength(0);
    expect(
      transport.sent.filter(
        ({ path, body }) =>
          path === '/api/oauth/token' &&
          typeof body === 'object' &&
          body !== null &&
          'grant_type' in body &&
          body.grant_type === 'refresh_token',
      ),
    ).toHaveLength(0);
    expect(revokedTokens(transport)).toEqual([REFRESH_TOKEN]);
    expect(engine.snapshot.status).toBe('signedOut');
  });

  it('preserves an expired in-memory session when restore starts with its refresh queued', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(301_000);
    transport.enqueue(oauthTokenReply('access-after-restore', REFRESH_AFTER_RESTORE_TOKEN), {
      status: 200,
      body: { success: true, data: { id: 'profile' } },
    });
    const request = engine.transport.request({
      method: HTTP_METHOD.GET,
      path: '/api/user/profile',
    });
    const restore = engine.restore();
    const [requestResult, restoreResult] = await Promise.all([request, restore]);

    expect(transport.sent.filter(({ path, body }) => isRefreshRequest(path, body))).toHaveLength(1);
    expect(engine.snapshot.status).toBe('signedIn');
    expect(requestResult.status).toBe(200);
    expect(restoreResult).toEqual({ kind: 'restored', status: 'signedIn' });
  });
});

function isRefreshRequest(path: string, body: unknown): boolean {
  return (
    path === '/api/oauth/token' &&
    typeof body === 'object' &&
    body !== null &&
    'grant_type' in body &&
    body.grant_type === 'refresh_token'
  );
}
