import { REFRESH_NEW_TOKEN } from '../support/token-values';
import { describe, expect, it } from 'vitest';
import { HTTP_METHOD, TransportError, TRANSPORT_FAILURE } from '@app/sdk';
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

describe('sign-in eligibility', () => {
  it('allows a new authorization after refresh requires reauthentication', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);
    ports.clock.advance(270_000);
    transport.enqueue(new TransportError(TRANSPORT_FAILURE.NO_RESPONSE));
    await expect(
      engine.transport.request({ method: HTTP_METHOD.GET, path: '/api/user/profile' }),
    ).rejects.toBeInstanceOf(TransportError);
    acceptCode(ports.authBrowser, 'new-code');
    transport.enqueue(
      { status: 200, body: {} },
      oauthTokenReply('access-new', REFRESH_NEW_TOKEN),
      successUserReply(),
    );

    await expect(engine.signIn()).resolves.toMatchObject({ kind: 'signedIn' });

    expect(engine.snapshot.status).toBe('signedIn');
    expect(ports.authBrowser.opened).toHaveLength(2);
  });

  it('does not open a second browser from signed-in state', async () => {
    const transport = new ScriptedTransport();
    const ports = testPorts(transport);
    const engine = createAuthEngine(CONFIG, ports);
    await establishSession(engine, ports, transport);

    await expect(engine.signIn()).resolves.toEqual({ kind: 'alreadySignedIn' });

    expect(ports.authBrowser.opened).toHaveLength(1);
  });
});
