import { REFRESH_NEW_TOKEN } from '../support/token-values';
import { describe, expect, it } from 'vitest';
import { HTTP_METHOD } from '@app/sdk';
import { createAuthEngine } from '../support/engine';
import {
  CONFIG,
  ScriptedTransport,
  acceptCode,
  establishSession,
  oauthTokenReply,
  successUserReply,
  testPorts,
} from '../support/support';

describe('an owed credential deletion after a later session write', () => {
  it('does not delete the new session during a later restore', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.credentials.beforeDelete = () => Promise.reject(new Error('keychain unavailable'));
    transport.enqueue({ status: 200, body: {} });

    await expect(engine.signOut()).resolves.toMatchObject({ kind: 'signedOut' });
    ports.credentials.beforeDelete = undefined;
    transport.enqueue(oauthTokenReply('access-new', REFRESH_NEW_TOKEN), successUserReply());
    acceptCode(ports.authBrowser);
    await expect(engine.signIn()).resolves.toMatchObject({ kind: 'signedIn' });

    ports.clock.advance(270_000);
    transport.enqueue({ status: 502, body: undefined });
    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toThrow();
    expect(engine.snapshot.status).toBe('reauthRequired');
    expect(ports.credentials.value).toContain(REFRESH_NEW_TOKEN);

    await expect(engine.restore()).resolves.toMatchObject({
      kind: 'restored',
      status: 'reauthRequired',
    });
    expect(ports.credentials.value).toContain(REFRESH_NEW_TOKEN);
    expect(ports.credentials.value).toContain('"refreshInFlight":true');
  });
});
