import { describe, expect, it } from 'vitest';
import { createAuthEngine } from '../support/engine';
import { revokedTokens } from '../support/tracking';
import { apiReply, CONFIG, Deferred, ScriptedTransport, testPorts } from '../support/support';
import { ATTEMPT_ID, startReply } from './native-fixtures';

describe('native authorization exchange races', () => {
  it('revokes an issued refresh token when disposal wins during exchange', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const expiresAt = new Date(ports.clock.wall + 10 * 60_000).toISOString();
    const exchangeStarted = new Deferred<void>();
    const revokeStarted = new Deferred<void>();
    const tokenAnswer = new Deferred<{ status: number; body: unknown }>();
    transport.onRequest = ({ path }) => {
      if (path === '/api/oauth/token') exchangeStarted.resolve();
      if (path === '/api/oauth/revoke') revokeStarted.resolve();
    };
    transport.respond = (request) => {
      if (request.path === '/api/auth/native/attempts')
        return Promise.resolve(startReply(expiresAt));
      if (request.path.endsWith('/password')) {
        const saved = JSON.parse(ports.credentials.value ?? '{}') as {
          transaction?: { state?: string };
        };
        return Promise.resolve(
          apiReply({
            attemptId: ATTEMPT_ID,
            stage: 'codeReady',
            expiresAt,
            redirectUri: `${CONFIG.redirectUri}?code=issued-code&state=${saved.transaction?.state ?? ''}`,
          }),
        );
      }
      if (request.path === '/api/oauth/token') return tokenAnswer.promise;
      if (request.path === '/api/oauth/revoke') return Promise.resolve({ status: 200, body: {} });
      return Promise.reject(new Error(`Unexpected request: ${request.path}`));
    };
    const engine = createAuthEngine(CONFIG, ports);
    await engine.restore();
    await engine.nativeSignIn({ kind: 'start', flow: 'signIn' });
    const pending = engine.nativeSignIn({
      kind: 'password',
      email: 'person@example.test',
      password: 'temporary-secret',
    });
    await exchangeStarted.promise;

    engine.dispose();
    tokenAnswer.resolve({
      status: 200,
      body: {
        access_token: 'late-access',
        token_type: 'Bearer',
        expires_in: 300,
        refresh_token: 'late-refresh',
        scope: 'api',
      },
    });
    await revokeStarted.promise;

    expect((await pending).kind).toBe('disposed');
    expect(revokedTokens(transport)).toEqual(['late-refresh']);
    expect(ports.credentials.value).toBeUndefined();
  });
});
